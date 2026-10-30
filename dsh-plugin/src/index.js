import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export const name = 'gemini-dsh-bridge'
export const inject = ['sessionController', 'webServer', 'workspaceRegistry', 'sessionQuery', 'agents']

const PREFIX = '/gemini-bridge'

/**
 * Clean thinking/reasoning metadata, signature blocks, and unclosed tags,
 * matching DeepSeek Harness v0.2.1-rc.5 reasoning-text engine specification.
 * @param {string} rawText
 * @returns {string}
 */
export function cleanReasoningAndSignatures(rawText) {
  if (!rawText || typeof rawText !== 'string') return ''
  // 1. Strip closed <signature>...</signature> tags and any following newlines
  let cleaned = rawText.replace(/<signature>[\s\S]*?<\/signature>\r?\n?/g, '')
  // 2. Stream guard: if an unclosed <signature> tag appears (in-flight streaming), drop trailing signature fragment
  cleaned = cleaned.replace(/<signature>[\s\S]*$/g, '')
  return cleaned
}

/** @param {any} ctx @param {any} config */
export function apply(ctx, config = {}) {
  const cfg = {
    maxConcurrent: Number(config.maxConcurrent ?? 3),
    endpointPath: String(config.endpointPath ?? join(homedir(), '.dsh', 'bridge', 'endpoint.json')),
    sessionsPath: String(config.sessionsPath ?? join(homedir(), '.dsh', 'bridge', 'sessions.json')),
    tokenOverride: config.token,
  }
  const token = cfg.tokenOverride || randomBytes(32).toString('base64url')
  const log = (...a) => console.log('[gemini-dsh-bridge]', ...a)

  /** @type {Map<string, any>} */
  const sessions = new Map()
  const stats = { startedAt: Date.now(), requests: 0, errors: 0 }

  // 1. Session persistence
  const loadSessions = () => {
    try {
      if (existsSync(cfg.sessionsPath)) {
        const raw = readFileSync(cfg.sessionsPath, 'utf8')
        const list = JSON.parse(raw)
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && item.sessionId) {
              const live = ctx.agents?.get?.(item.sessionId)
              sessions.set(item.sessionId, {
                ...item,
                state: live ? (item.state === 'running' ? 'running' : item.state) : (item.state === 'running' ? 'cold' : item.state),
                live: live !== undefined,
              })
            }
          }
          log('loaded', sessions.size, 'sessions from', cfg.sessionsPath)
        }
      }
    } catch (e) {
      log('failed to load sessions from', cfg.sessionsPath, String(e))
    }
  }

  let saveTimer = null
  const saveSessions = (immediate = false) => {
    const doSave = () => {
      saveTimer = null
      try {
        const dir = join(cfg.sessionsPath, '..')
        mkdirSync(dir, { recursive: true })
        const data = [...sessions.values()].map((s) => ({
          sessionId: s.sessionId,
          workspaceId: s.workspaceId,
          cwd: s.cwd,
          title: s.title,
          state: s.state,
          lastText: (s.lastText ?? '').slice(-4000),
          lastError: s.lastError ?? null,
          filesChanged: s.filesChanged ?? [],
          tokenUsage: s.tokenUsage ?? null,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        }))
        const tmp = cfg.sessionsPath + '.tmp.' + Date.now()
        writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
        renameSync(tmp, cfg.sessionsPath)
      } catch (e) {
        log('failed to save sessions', String(e))
      }
    }

    if (immediate) {
      if (saveTimer) clearTimeout(saveTimer)
      doSave()
    } else {
      if (!saveTimer) {
        saveTimer = setTimeout(doSave, 150)
      }
    }
  }

  loadSessions()

  const writeEndpoint = () => {
    try {
      const dir = join(cfg.endpointPath, '..')
      mkdirSync(dir, { recursive: true })
      const origin = ctx.webServer.getOrigin()
      const payload = { version: 1, origin, token, pid: process.pid, updatedAt: new Date().toISOString() }
      writeFileSync(cfg.endpointPath, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
      log('endpoint written', cfg.endpointPath, origin)
    } catch (e) {
      log('failed to write endpoint file', String(e))
    }
  }
  writeEndpoint()

  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) return resolve({})
      try { resolve(JSON.parse(raw)) } catch (e) { reject(Object.assign(new Error('invalid JSON body'), { code: 'BAD_REQUEST' })) }
    })
    req.on('error', reject)
  })

  const send = (res, status, obj) => {
    const body = JSON.stringify(obj)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
    res.end(body)
  }

  const fail = (res, status, code, message, detail) => send(res, status, { error: { code, message, detail } })

  const activeCount = () => [...sessions.values()].filter((s) => s.state === 'running').length

  const lastAssistantText = async (sessionId) => {
    try {
      const surface = await ctx.sessionQuery.readSurface(sessionId)
      const events = surface?.events ?? []
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const e = events[i]
        const role = e?.data?.message?.role ?? e?.message?.role
        if (role !== 'assistant') continue
        const content = e?.data?.message?.content ?? e?.message?.content ?? []
        const text = (Array.isArray(content) ? content : [])
          .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text)
          .join('')
        if (text) {
          const cleaned = cleanReasoningAndSignatures(text)
          if (cleaned) return cleaned
        }
      }
    } catch (e) {
      log('lastAssistantText failed', String(e))
    }
    return ''
  }

  const lastEvents = async (sessionId, limit = 20) => {
    try {
      const records = await ctx.sessionQuery.listEvents(sessionId)
      return Array.isArray(records) ? records.slice(-limit) : []
    } catch (e) {
      log('lastEvents failed', String(e))
      return []
    }
  }

  const checkApproval = (events) => {
    let asked = 0
    let decided = 0
    let lastAsked = null
    for (const item of events) {
      const e = item?.event || item?.data || item
      const type = item?.type ?? e?.type
      if (type === 'approval/asked') {
        asked += 1
        lastAsked = e
      } else if (type === 'approval/decided') {
        decided += 1
      }
    }
    const pending = asked > decided
    return {
      pending,
      approvalItem: pending && lastAsked ? {
        type: lastAsked.type || 'approval/asked',
        tool: lastAsked.tool || lastAsked.name || null,
        command: lastAsked.command || lastAsked.input?.command || null,
        description: lastAsked.description || lastAsked.reason || null,
      } : null,
    }
  }

  const extractSessionMetrics = async (sessionId) => {
    const files = new Set()
    let promptTokens = 0
    let completionTokens = 0
    let totalTokens = 0

    try {
      const [surface, events] = await Promise.all([
        ctx.sessionQuery.readSurface(sessionId).catch(() => ({ events: [] })),
        ctx.sessionQuery.listEvents(sessionId).catch(() => []),
      ])

      const all = [...(events || []), ...(surface?.events || [])]
      for (const item of all) {
        if (!item) continue
        const e = item.event || item.data || item

        // Token usage
        const usage = e.usage || e.message?.usage || item.usage || item.data?.message?.usage
        if (usage && typeof usage === 'object') {
          const pt = Number(usage.promptTokens ?? usage.prompt_tokens ?? usage.input_tokens ?? 0)
          const ct = Number(usage.completionTokens ?? usage.completion_tokens ?? usage.output_tokens ?? 0)
          const tt = Number(usage.totalTokens ?? usage.total_tokens ?? (pt + ct))
          if (pt > promptTokens) promptTokens = pt
          if (ct > completionTokens) completionTokens = ct
          if (tt > totalTokens) totalTokens = tt
        }

        // File modifications from content tool_use / tool_call
        const content = e.content || e.message?.content || []
        if (Array.isArray(content)) {
          for (const part of content) {
            if (!part) continue
            if (part.type === 'tool_use' || part.type === 'tool_call') {
              const name = String(part.name || part.tool || '')
              const input = part.input || part.arguments || {}
              if (/file|patch|write|edit/i.test(name)) {
                const p = input.path || input.filePath || input.file || input.targetFile
                if (p && typeof p === 'string') files.add(p)
              }
            }
          }
        }

        // File modifications from events
        const type = String(item.type || e.type || '')
        if (type.includes('file') || type.includes('patch') || type.includes('edit')) {
          const p = e.path || e.filePath || e.file || e.targetPath
          if (p && typeof p === 'string') files.add(p)
        }
        if (type === 'tool/call' || type === 'tool/execution' || type === 'tool_call') {
          const name = String(e.name || e.tool || '')
          const args = e.args || e.arguments || e.input || {}
          if (/file|patch|write|edit/i.test(name)) {
            const p = args.path || args.filePath || args.file
            if (p && typeof p === 'string') files.add(p)
          }
        }
      }
    } catch (e) {
      log('extractSessionMetrics error', String(e))
    }

    return {
      filesChanged: [...files],
      tokenUsage: {
        promptTokens,
        completionTokens,
        totalTokens: totalTokens || (promptTokens + completionTokens),
      },
    }
  }

  const deriveState = async (record, live) => {
    if (live === undefined) return record.state === 'done' ? 'done' : 'cold'
    const status = String(live.status ?? '')
    if (status === 'running') {
      const events = await lastEvents(record.sessionId)
      const approval = checkApproval(events)
      if (approval.pending) {
        record.approvalItem = approval.approvalItem
        return 'waiting-approval'
      }
      record.approvalItem = null
      return 'running'
    }
    record.approvalItem = null
    if (status === 'idle') return 'idle'
    return status || 'unknown'
  }

  const describe = async (record) => {
    const live = ctx.agents?.get ? ctx.agents.get(record.sessionId) : undefined
    const state = await deriveState(record, live)
    record.state = state === 'cold' ? 'done' : state
    const text = await lastAssistantText(record.sessionId)
    if (text) record.lastText = text

    const metrics = await extractSessionMetrics(record.sessionId)
    if (metrics.filesChanged.length) record.filesChanged = metrics.filesChanged
    if (metrics.tokenUsage.totalTokens > 0) record.tokenUsage = metrics.tokenUsage

    const finished = state !== 'running' && state !== 'waiting-approval'
    record.updatedAt = Date.now()

    const result = {
      sessionId: record.sessionId,
      workspaceId: record.workspaceId,
      title: record.title,
      cwd: record.cwd,
      state,
      finished,
      live: live !== undefined,
      agentStatus: live?.status === undefined ? null : String(live.status),
      lastText: (record.lastText ?? '').slice(-4000),
      lastError: record.lastError ?? null,
      filesChanged: record.filesChanged ?? [],
      tokenUsage: record.tokenUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      approvalItem: record.approvalItem ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }

    saveSessions()
    return result
  }

  const start = async (body) => {
    const cwd = String(body.cwd ?? '')
    const prompt = String(body.prompt ?? '')
    if (!cwd || !isAbsolute(cwd)) throw Object.assign(new Error('cwd must be an absolute path'), { code: 'BAD_CWD' })
    if (!prompt.trim()) throw Object.assign(new Error('prompt must not be empty'), { code: 'BAD_PROMPT' })
    if (activeCount() >= cfg.maxConcurrent) throw Object.assign(new Error('too many running sessions'), { code: 'LIMIT_EXCEEDED' })
    const title = body.title === undefined ? undefined : String(body.title)
    const project = await ctx.workspaceRegistry.create(cwd, title ?? 'Gemini Bridge')
    const created = await ctx.sessionController.create({ workspaceId: project.id })
    const record = {
      sessionId: created.sessionId,
      workspaceId: project.id,
      cwd,
      title: title ?? project.title,
      state: 'running',
      lastText: '',
      lastError: null,
      filesChanged: [],
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      approvalItem: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    sessions.set(record.sessionId, record)
    saveSessions()

    const requestId = randomUUID()
    const ac = new AbortController()
    await ctx.sessionController.prompt({
      sessionId: record.sessionId,
      content: [{ type: 'text', text: prompt }],
      requestId,
    }, ac.signal)
    log('started', record.sessionId, 'workspace', project.id)
    return describe(record)
  }

  const route = async (req, res) => {
    stats.requests += 1
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const sub = url.pathname.slice(PREFIX.length) || '/'
    if (sub === '/health') {
      return send(res, 200, {
        ok: true,
        plugin: name,
        pid: process.pid,
        origin: ctx.webServer.getOrigin(),
        active: activeCount(),
        totalKnown: sessions.size,
        maxConcurrent: cfg.maxConcurrent,
        requests: stats.requests,
        errors: stats.errors,
        startedAt: stats.startedAt,
      })
    }
    const provided = req.headers['x-bridge-token'] ?? url.searchParams.get('token')
    if (provided !== token) return fail(res, 401, 'UNAUTHORIZED', 'missing or invalid x-bridge-token')
    try {
      if (sub === '/list') {
        return send(res, 200, { sessions: await Promise.all([...sessions.values()].map(describe)) })
      }
      if (req.method !== 'POST') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'POST required')
      const body = await readBody(req)
      if (sub === '/start') return send(res, 200, { ok: true, ...(await start(body)) })
      if (sub === '/status' || sub === '/result') {
        const rec = sessions.get(String(body.sessionId ?? ''))
        if (!rec) return fail(res, 404, 'SESSION_NOT_FOUND', 'unknown sessionId')
        const info = await describe(rec)
        return send(res, 200, { ok: true, ...info })
      }
      if (sub === '/send') {
        const rec = sessions.get(String(body.sessionId ?? ''))
        if (!rec) return fail(res, 404, 'SESSION_NOT_FOUND', 'unknown sessionId')
        const text = String(body.message ?? '')
        if (!text.trim()) return fail(res, 400, 'BAD_MESSAGE', 'message must not be empty')
        const requestId = randomUUID()
        const ac = new AbortController()
        await ctx.sessionController.prompt({ sessionId: rec.sessionId, content: [{ type: 'text', text }], requestId }, ac.signal)
        rec.state = 'running'
        rec.updatedAt = Date.now()
        saveSessions()
        return send(res, 200, { ok: true, accepted: true })
      }
      if (sub === '/cancel') {
        const rec = sessions.get(String(body.sessionId ?? ''))
        if (!rec) return fail(res, 404, 'SESSION_NOT_FOUND', 'unknown sessionId')
        ctx.sessionController.cancel({ sessionId: rec.sessionId })
        rec.state = 'cancelled'
        rec.updatedAt = Date.now()
        saveSessions()
        return send(res, 200, { ok: true, accepted: true })
      }
      return fail(res, 404, 'NOT_FOUND', 'unknown endpoint ' + sub)
    } catch (e) {
      stats.errors += 1
      const code = e?.code ?? e?.remoteCode ?? 'INTERNAL'
      log('request failed', sub, String(e))
      return fail(res, 500, String(code), String(e?.message ?? e))
    }
  }

  ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: route })
  log('bridge mounted on', PREFIX, '| endpoint file', cfg.endpointPath, '| sessions file', cfg.sessionsPath)
}

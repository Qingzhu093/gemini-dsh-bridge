import { randomUUID } from 'node:crypto'

export const name = 'gemini-dsh-bridge-spike'
export const inject = ['sessionController', 'webServer', 'workspaceRegistry']

export function apply(ctx, config = {}) {
  const cfg = {
    cwd: config.cwd,
    title: config.title ?? 'DSH Bridge Spike',
    prompt: config.prompt ?? 'Reply with exactly: PONG',
    delayMs: Number(config.delayMs ?? 3000),
  }
  const log = (...a) => console.log('[gemini-bridge-spike]', ...a)
  const state = { sessionId: null, workspaceId: null, lastError: null, attempts: 0 }

  const send = (res, code, obj) => {
    const body = JSON.stringify(obj)
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
    res.end(body)
  }

  ctx.webServer.register({
    kind: 'exact',
    path: '/gemini-bridge/ping',
    handler: async (req, res) => {
      send(res, 200, { ok: true, plugin: name, ...state, origin: ctx.webServer.getOrigin() })
    },
  })
  log('ping route registered at /gemini-bridge/ping')

  async function startTask() {
    state.attempts += 1
    try {
      if (!cfg.cwd) throw new Error('config.cwd is required')
      const project = await ctx.workspaceRegistry.create(cfg.cwd, cfg.title)
      state.workspaceId = project.id
      log('workspace ready', project.id, project.path)
      const created = await ctx.sessionController.create({ workspaceId: project.id })
      state.sessionId = created.sessionId
      log('created session', created.sessionId)
      const requestId = randomUUID()
      const ac = new AbortController()
      await ctx.sessionController.prompt(
        { sessionId: created.sessionId, content: [{ type: 'text', text: cfg.prompt }], requestId },
        ac.signal,
      )
      log('prompt accepted for', created.sessionId)
    } catch (e) {
      state.lastError = String((e && e.stack) || e)
      log('start failed:', state.lastError)
    }
  }

  setTimeout(() => { void startTask() }, cfg.delayMs)
}

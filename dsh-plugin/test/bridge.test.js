import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, name, cleanReasoningAndSignatures } from '../src/index.js'

function createMockCtx() {
  const routes = new Map()
  const origin = 'http://127.0.0.1:49999'

  const workspaces = new Map()
  const sessions = new Map()
  const agents = new Map()
  const events = new Map()
  const surfaces = new Map()

  return {
    state: { workspaces, sessions, agents, events, surfaces },
    webServer: {
      getOrigin: () => origin,
      register: ({ path, handler }) => {
        routes.set(path, handler)
      },
      // test helper to simulate requests
      dispatch: async (urlPath, options = {}) => {
        const handler = routes.get('/gemini-bridge')
        if (!handler) throw new Error('bridge not mounted')

        const method = options.method || 'GET'
        const headers = { ...options.headers }
        const bodyObj = options.body
        const bodyStr = bodyObj !== undefined ? (typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj)) : ''

        const req = {
          url: urlPath,
          method,
          headers: {
            ...headers,
            'content-type': 'application/json',
          },
          on: (event, cb) => {
            if (event === 'data' && bodyStr) {
              cb(Buffer.from(bodyStr, 'utf8'))
            }
            if (event === 'end') {
              cb()
            }
            return req
          },
        }

        let statusCode = 200
        let responseHeaders = {}
        let responseBody = ''

        const res = {
          writeHead: (status, hdrs) => {
            statusCode = status
            responseHeaders = hdrs
          },
          end: (chunk) => {
            if (chunk) responseBody += chunk
          },
        }

        await handler(req, res)
        let json = null
        try {
          if (responseBody) json = JSON.parse(responseBody)
        } catch {
          // non-JSON
        }
        return { status: statusCode, headers: responseHeaders, body: json, text: responseBody }
      },
    },
    workspaceRegistry: {
      create: async (cwd, title) => {
        const id = 'ws-' + Math.random().toString(36).slice(2, 8)
        const ws = { id, cwd, title }
        workspaces.set(id, ws)
        return ws
      },
    },
    sessionController: {
      create: async ({ workspaceId }) => {
        const sessionId = 'session-' + Math.random().toString(36).slice(2, 8)
        sessions.set(sessionId, { workspaceId, prompts: [] })
        agents.set(sessionId, { status: 'idle' })
        return { sessionId }
      },
      prompt: async ({ sessionId, content, requestId }) => {
        const sess = sessions.get(sessionId)
        if (!sess) throw new Error('session not found')
        sess.prompts.push({ content, requestId })
        agents.set(sessionId, { status: 'running' })
      },
      cancel: ({ sessionId }) => {
        agents.set(sessionId, { status: 'idle' })
      },
    },
    sessionQuery: {
      readSurface: async (sessionId) => surfaces.get(sessionId) || { events: [] },
      listEvents: async (sessionId) => events.get(sessionId) || [],
    },
    agents: {
      get: (sessionId) => agents.get(sessionId),
    },
  }
}

test('gemini-dsh-bridge unit tests', async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'dsh-bridge-test-'))
  const endpointPath = join(tempDir, 'endpoint.json')
  const sessionsPath = join(tempDir, 'sessions.json')

  t.after(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  const ctx = createMockCtx()
  const token = 'test-secret-token-12345'
  apply(ctx, {
    endpointPath,
    sessionsPath,
    token,
    maxConcurrent: 2,
  })

  // 1. Check endpoint was written
  await t.test('writes endpoint.json with correct format', () => {
    const epRaw = readFileSync(endpointPath, 'utf8')
    const ep = JSON.parse(epRaw)
    assert.equal(ep.version, 1)
    assert.equal(ep.origin, 'http://127.0.0.1:49999')
    assert.equal(ep.token, token)
    assert.equal(typeof ep.pid, 'number')
  })

  // 2. Health endpoint check without token
  await t.test('/health returns 200 without token', async () => {
    const res = await ctx.webServer.dispatch('/gemini-bridge/health')
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.plugin, name)
    assert.equal(res.body.active, 0)
    assert.equal(res.body.maxConcurrent, 2)
  })

  // 3. Authentication
  await t.test('requires x-bridge-token for protected endpoints', async () => {
    const res = await ctx.webServer.dispatch('/gemini-bridge/list')
    assert.equal(res.status, 401)
    assert.equal(res.body.error.code, 'UNAUTHORIZED')

    const resWrong = await ctx.webServer.dispatch('/gemini-bridge/list', {
      headers: { 'x-bridge-token': 'wrong-token' },
    })
    assert.equal(resWrong.status, 401)

    const resOk = await ctx.webServer.dispatch('/gemini-bridge/list', {
      headers: { 'x-bridge-token': token },
    })
    assert.equal(resOk.status, 200)
    assert.deepEqual(resOk.body.sessions, [])
  })

  // 4. Start validation
  await t.test('/start validates cwd and prompt', async () => {
    // Relative cwd fails
    const relRes = await ctx.webServer.dispatch('/gemini-bridge/start', {
      method: 'POST',
      headers: { 'x-bridge-token': token },
      body: { cwd: './relative/path', prompt: 'test' },
    })
    assert.equal(relRes.status, 500)
    assert.equal(relRes.body.error.code, 'BAD_CWD')

    // Empty prompt fails
    const emptyRes = await ctx.webServer.dispatch('/gemini-bridge/start', {
      method: 'POST',
      headers: { 'x-bridge-token': token },
      body: { cwd: 'C:\\valid\\path', prompt: '   ' },
    })
    assert.equal(emptyRes.status, 500)
    assert.equal(emptyRes.body.error.code, 'BAD_PROMPT')
  })

  let createdSessionId = null

  // 5. Normal start flow
  await t.test('/start starts a session and returns running state', async () => {
    const res = await ctx.webServer.dispatch('/gemini-bridge/start', {
      method: 'POST',
      headers: { 'x-bridge-token': token },
      body: {
        cwd: 'C:\\Users\\test\\project',
        prompt: 'Do something awesome',
        title: 'Awesome Session',
      },
    })

    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.ok(res.body.sessionId)
    assert.equal(res.body.title, 'Awesome Session')
    assert.equal(res.body.cwd, 'C:\\Users\\test\\project')
    assert.equal(res.body.state, 'running')
    assert.equal(res.body.finished, false)
    createdSessionId = res.body.sessionId
  })

  // 6. Concurrency limit
  await t.test('enforces maxConcurrent limit', async () => {
    // Start second session
    const res2 = await ctx.webServer.dispatch('/gemini-bridge/start', {
      method: 'POST',
      headers: { 'x-bridge-token': token },
      body: { cwd: 'C:\\Users\\test\\p2', prompt: 'Task 2' },
    })
    assert.equal(res2.status, 200)

    // Third should fail since limit is 2
    const res3 = await ctx.webServer.dispatch('/gemini-bridge/start', {
      method: 'POST',
      headers: { 'x-bridge-token': token },
      body: { cwd: 'C:\\Users\\test\\p3', prompt: 'Task 3' },
    })
    assert.equal(res3.status, 500)
    assert.equal(res3.body.error.code, 'LIMIT_EXCEEDED')

    // Finish second session to free slot
    ctx.state.agents.set(res2.body.sessionId, { status: 'idle' })
  })

  // 7. Status and result checking
  await t.test('/status and /result reflect session progress and text', async () => {
    // Mock surface with assistant message
    ctx.state.surfaces.set(createdSessionId, {
      events: [
        {
          data: {
            message: {
              role: 'assistant',
              content: [
                { type: 'text', text: 'Task completed successfully!' },
                {
                  type: 'tool_use',
                  name: 'write_file',
                  input: { path: 'C:\\Users\\test\\project\\output.txt' },
                },
              ],
              usage: { promptTokens: 120, completionTokens: 45, totalTokens: 165 },
            },
          },
        },
      ],
    })

    // Set agent to idle
    ctx.state.agents.set(createdSessionId, { status: 'idle' })

    const res = await ctx.webServer.dispatch('/gemini-bridge/result', {
      method: 'POST',
      headers: { 'x-bridge-token': token },
      body: { sessionId: createdSessionId },
    })

    assert.equal(res.status, 200)
    assert.equal(res.body.finished, true)
    assert.equal(res.body.state, 'idle')
    assert.match(res.body.lastText, /Task completed successfully!/)
    assert.ok(Array.isArray(res.body.filesChanged))
    assert.ok(res.body.filesChanged.includes('C:\\Users\\test\\project\\output.txt'))
    assert.equal(res.body.tokenUsage.totalTokens, 165)
  })

  // 8. Follow-up send and cancel
  await t.test('/send wakes up session, /cancel stops it', async () => {
    const sendRes = await ctx.webServer.dispatch('/gemini-bridge/send', {
      method: 'POST',
      headers: { 'x-bridge-token': token },
      body: { sessionId: createdSessionId, message: 'Follow up question' },
    })
    assert.equal(sendRes.status, 200)
    assert.equal(sendRes.body.accepted, true)

    const cancelRes = await ctx.webServer.dispatch('/gemini-bridge/cancel', {
      method: 'POST',
      headers: { 'x-bridge-token': token },
      body: { sessionId: createdSessionId },
    })
    assert.equal(cancelRes.status, 200)
    assert.equal(cancelRes.body.accepted, true)
  })

  // 9. Approval detection
  await t.test('detects waiting-approval state and approval details', async () => {
    const appRes = await ctx.webServer.dispatch('/gemini-bridge/start', {
      method: 'POST',
      headers: { 'x-bridge-token': token },
      body: { cwd: 'C:\\Users\\test\\p_app', prompt: 'Run risky command' },
    })
    const appSid = appRes.body.sessionId

    // Set mock events with approval/asked
    ctx.state.events.set(appSid, [
      {
        type: 'approval/asked',
        data: {
          tool: 'execute_command',
          command: 'rm -rf something',
        },
      },
    ])
    ctx.state.agents.set(appSid, { status: 'running' })

    const statusRes = await ctx.webServer.dispatch('/gemini-bridge/status', {
      method: 'POST',
      headers: { 'x-bridge-token': token },
      body: { sessionId: appSid },
    })

    assert.equal(statusRes.status, 200)
    assert.equal(statusRes.body.state, 'waiting-approval')
    assert.equal(statusRes.body.finished, false)
    assert.ok(statusRes.body.approvalItem)
    assert.equal(statusRes.body.approvalItem.command, 'rm -rf something')

    // Now simulate approval/decided
    ctx.state.events.set(appSid, [
      { type: 'approval/asked', data: { command: 'rm -rf something' } },
      { type: 'approval/decided', data: { approved: true } },
    ])

    const statusAfter = await ctx.webServer.dispatch('/gemini-bridge/status', {
      method: 'POST',
      headers: { 'x-bridge-token': token },
      body: { sessionId: appSid },
    })
    assert.equal(statusAfter.body.state, 'running')
  })

  // 10. Persistence and cold recovery
  await t.test('persists sessions to disk and restores on cold reboot', async () => {
    // Wait slightly to let save debouncer flush
    await new Promise((r) => setTimeout(r, 250))

    // Check sessions.json was written
    const raw = readFileSync(sessionsPath, 'utf8')
    const list = JSON.parse(raw)
    assert.ok(Array.isArray(list))
    assert.ok(list.length >= 2)

    // Simulate reboot: create a brand new ctx
    const newCtx = createMockCtx()
    const newToken = 'test-token-after-reboot'
    apply(newCtx, {
      endpointPath,
      sessionsPath,
      token: newToken,
      maxConcurrent: 3,
    })

    // Query list on newCtx
    const listRes = await newCtx.webServer.dispatch('/gemini-bridge/list', {
      headers: { 'x-bridge-token': newToken },
    })

    assert.equal(listRes.status, 200)
    assert.ok(listRes.body.sessions.length >= 2)

    // The created session should be restored
    const restored = listRes.body.sessions.find((s) => s.sessionId === createdSessionId)
    assert.ok(restored, 'restored session exists')
    assert.equal(restored.title, 'Awesome Session')
    assert.ok(restored.filesChanged.includes('C:\\Users\\test\\project\\output.txt'))
  })

  // 11. DSH v0.2.1-rc.5 reasoning-text signature stripping
  await t.test('cleanReasoningAndSignatures strips signatures and protects streaming', () => {
    // 1. Closed signature with trailing newline
    const closed = 'Thinking process done.\n<signature>payload_hash_12345</signature>\nHere is the real answer.'
    assert.equal(cleanReasoningAndSignatures(closed), 'Thinking process done.\nHere is the real answer.')

    // 2. In-flight streaming with unclosed signature
    const unclosed = 'Step 1 complete.<signature>partial_stream_payload'
    assert.equal(cleanReasoningAndSignatures(unclosed), 'Step 1 complete.')

    // 3. Normal text without signatures
    const normal = 'Normal output text without any tags.'
    assert.equal(cleanReasoningAndSignatures(normal), normal)
  })
})

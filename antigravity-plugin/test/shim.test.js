const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const path = require('node:path')

const shimPath = path.resolve(__dirname, '../bin/shim.cjs')

function createShimProcess() {
  const p = spawn(process.execPath, [shimPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
  })

  let buffer = ''
  const pending = new Map()

  p.stdout.setEncoding('utf8')
  p.stdout.on('data', (chunk) => {
    buffer += chunk
    let nl
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line)
        if (msg.id && pending.has(msg.id)) {
          const { resolve } = pending.get(msg.id)
          pending.delete(msg.id)
          resolve(msg)
        }
      } catch (e) {
        // ignore
      }
    }
  })

  let idCounter = 1
  const send = (method, params) => {
    const id = idCounter++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  const notify = (method, params) => {
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  const close = () => {
    p.stdin.end()
    p.kill()
  }

  return { send, notify, close }
}

test('MCP shim unit tests', async (t) => {
  const client = createShimProcess()
  t.after(() => client.close())

  await t.test('handles initialize handshake', async () => {
    const res = await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0' },
    })

    assert.equal(res.jsonrpc, '2.0')
    assert.ok(res.result)
    assert.equal(res.result.serverInfo.name, 'dsh-bridge')
    assert.equal(res.result.serverInfo.version, '0.3.0')
    assert.ok(res.result.capabilities.tools)
  })

  await t.test('handles ping', async () => {
    const res = await client.send('ping')
    assert.equal(res.jsonrpc, '2.0')
    assert.deepEqual(res.result, {})
  })

  await t.test('lists all 7 required tools with schemas', async () => {
    const res = await client.send('tools/list')
    assert.ok(res.result)
    const { tools } = res.result
    assert.equal(tools.length, 7)

    const names = tools.map((t) => t.name).sort()
    assert.deepEqual(names, [
      'dsh_cancel',
      'dsh_list',
      'dsh_result',
      'dsh_send',
      'dsh_start',
      'dsh_status',
      'dsh_wait',
    ])

    for (const tool of tools) {
      assert.ok(tool.description, `tool ${tool.name} must have description`)
      assert.ok(tool.inputSchema, `tool ${tool.name} must have inputSchema`)
      assert.equal(tool.inputSchema.type, 'object')
    }

    const waitTool = tools.find((t) => t.name === 'dsh_wait')
    assert.equal(waitTool.inputSchema.properties.timeoutSeconds.default, 30)
  })

  await t.test('returns error for unknown tool call', async () => {
    const res = await client.send('tools/call', {
      name: 'non_existent_tool',
      arguments: {},
    })

    assert.ok(res.result)
    assert.equal(res.result.isError, true)
    assert.match(res.result.content[0].text, /unknown tool non_existent_tool/)
  })

  await t.test('returns method not found for unknown RPC method', async () => {
    const res = await client.send('unknown/method', {})
    assert.ok(res.error)
    assert.equal(res.error.code, -32601)
  })
})

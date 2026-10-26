'use strict';
/**
 * End-to-end integration test against the live DeepSeek Harness instance.
 * Verifies full protocol handshake, session execution, result retrieval,
 * and listing through the MCP shim.
 */
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');

const shim = path.resolve(__dirname, '../antigravity-plugin/bin/shim.cjs');
const cwd = path.resolve(__dirname, 'work');

const p = spawn(process.execPath, [shim], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
let sid = null;

const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');

p.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    if (msg.id === 1) {
      console.log('✔ initialize: ok');
      assert.equal(msg.result.serverInfo.name, 'dsh-bridge');
    }

    if (msg.id === 2) {
      const count = msg.result.tools.length;
      console.log('✔ tools/list: ' + count + ' tools');
      assert.equal(count, 7);
    }

    if (msg.id === 3) {
      const sc = msg.result.structuredContent || {};
      sid = sc.sessionId;
      console.log('✔ dsh_start: ' + (sc.title || '') + ' -> ' + sid + ' state=' + sc.state);
      assert.ok(sid, 'sessionId must be present');
      assert.equal(sc.state, 'running');

      send({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'dsh_wait', arguments: { sessionId: sid, timeoutSeconds: 60 } },
      });
    }

    if (msg.id === 4) {
      const sc = msg.result.structuredContent || {};
      console.log('✔ dsh_wait: state=' + sc.state + ' finished=' + sc.finished);
      assert.equal(sc.finished, true, 'session must be finished');

      send({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'dsh_result', arguments: { sessionId: sid } },
      });
    }

    if (msg.id === 5) {
      const sc = msg.result.structuredContent || {};
      console.log('✔ dsh_result: textLength=' + (sc.lastText ? sc.lastText.length : 0));
      assert.ok(sc.lastText, 'lastText should not be empty');

      send({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'dsh_list', arguments: {} },
      });
    }

    if (msg.id === 6) {
      const sc = msg.result.structuredContent || {};
      const sessions = sc.sessions || [];
      console.log('✔ dsh_list: found ' + sessions.length + ' sessions');
      assert.ok(sessions.length >= 1, 'must have at least one session in list');
      assert.ok(sessions.some((s) => s.sessionId === sid), 'created session must be present in dsh_list');

      console.log('🎉 All integration assertions passed successfully!');
      setTimeout(() => process.exit(0), 100);
    }
  }
});

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'integration-test', version: '1.0' } },
});
send({ jsonrpc: '2.0', method: 'notifications/initialized' });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

setTimeout(() => {
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'dsh_start',
      arguments: {
        cwd,
        prompt: 'Reply with exactly: INTEGRATION-PASS',
        title: 'Integration Probe',
      },
    },
  });
}, 300);

const timeout = setTimeout(() => {
  console.error('❌ Integration test timed out after 90 seconds');
  process.exit(1);
}, 90000);
timeout.unref();

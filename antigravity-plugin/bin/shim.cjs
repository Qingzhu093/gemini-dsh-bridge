#!/usr/bin/env node
/**
 * MCP stdio shim for the DSH gemini-bridge.
 * Reads the loopback endpoint + token written by the DSH plugin and forwards
 * tool calls over plain JSON HTTP. No dependencies.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ENDPOINT = path.join(os.homedir(), '.dsh', 'bridge', 'endpoint.json');
const PROTOCOL = '2024-11-05';

function readEndpoint() {
  let raw;
  try { raw = fs.readFileSync(ENDPOINT, 'utf8'); } catch (e) {
    throw new Error('DSH bridge is not running: cannot read ' + ENDPOINT + '. Start DeepSeek Harness with the dsh-plugin-gemini-bridge plugin enabled.');
  }
  const ep = JSON.parse(raw);
  if (!ep || !ep.origin || !ep.token) throw new Error('DSH bridge endpoint file is malformed: ' + ENDPOINT);
  return ep;
}

function request(ep, method, route, body, timeoutMs) {
  const payload = Buffer.from(JSON.stringify(body ?? {}), 'utf8');
  const url = new URL(ep.origin + '/gemini-bridge/' + route);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'content-type': 'application/json', 'content-length': payload.length, 'x-bridge-token': ep.token },
      timeout: timeoutMs ?? 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = text ? JSON.parse(text) : {}; } catch { reject(new Error('bridge returned non-JSON: ' + text.slice(0, 200))); return; }
        if (res.statusCode && res.statusCode >= 400) {
          const msg = json && json.error ? json.error.code + ': ' + json.error.message : 'HTTP ' + res.statusCode;
          reject(new Error(msg));
          return;
        }
        resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new Error('bridge request timed out after ' + (timeoutMs ?? 30000) + 'ms')));
    req.on('error', (e) => reject(new Error('cannot reach DSH bridge at ' + ep.origin + ': ' + e.message)));
    req.end(payload);
  });
}

const tools = [
  { name: 'dsh_start', description: 'Start a DeepSeek Flash session inside DeepSeek Harness and send the first task. Returns a sessionId immediately; the user can watch it live in the DSH UI.', inputSchema: { type: 'object', properties: { cwd: { type: 'string', description: 'Absolute working directory for the task.' }, prompt: { type: 'string', description: 'Self-contained task brief.' }, title: { type: 'string', description: 'Optional session title shown in the DSH sidebar.' } }, required: ['cwd', 'prompt'], additionalProperties: false } },
  { name: 'dsh_status', description: 'Read one DSH session state plus the tail of its latest assistant text.', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'], additionalProperties: false } },
  { name: 'dsh_wait', description: 'Wait up to timeoutSeconds for a DSH session to leave the running state. Returns as soon as it finishes, needs approval, or the timeout elapses.', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, timeoutSeconds: { type: 'number', default: 60 } }, required: ['sessionId'], additionalProperties: false } },
  { name: 'dsh_result', description: 'Read the final assistant text, touched files, and token usage of a DSH session. finished=false means it is still working.', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'], additionalProperties: false } },
  { name: 'dsh_send', description: 'Send a follow-up message to an existing DSH session (wake it up and keep its context).', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, message: { type: 'string' } }, required: ['sessionId', 'message'], additionalProperties: false } },
  { name: 'dsh_cancel', description: 'Cancel the current turn of a DSH session without destroying its history.', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'], additionalProperties: false } },
  { name: 'dsh_list', description: 'List the DSH sessions this bridge knows about.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callTool(name, args) {
  const ep = readEndpoint();
  switch (name) {
    case 'dsh_start': return post(ep, 'start', { cwd: args.cwd, prompt: args.prompt, title: args.title }, 60000);
    case 'dsh_status': return post(ep, 'status', { sessionId: args.sessionId });
    case 'dsh_result': return post(ep, 'result', { sessionId: args.sessionId });
    case 'dsh_send': return post(ep, 'send', { sessionId: args.sessionId, message: args.message }, 60000);
    case 'dsh_cancel': return post(ep, 'cancel', { sessionId: args.sessionId });
    case 'dsh_list': {
      try { return await get(ep, 'list'); }
      catch { return await post(ep, 'list', {}); }
    }
    case 'dsh_wait': {
      const deadline = Date.now() + Math.min(Math.max(Number(args.timeoutSeconds ?? 60), 1), 120) * 1000;
      let last = null;
      while (Date.now() < deadline) {
        last = await post(ep, 'status', { sessionId: args.sessionId });
        if (last.finished || last.state === 'waiting-approval') {
          if (last.state === 'waiting-approval') {
            const toolDesc = last.approvalItem?.command || last.approvalItem?.tool || 'a tool or command';
            last.note = `Waiting for user approval in DeepSeek Harness UI (${toolDesc}).`;
          }
          return last;
        }
        await sleep(1500);
      }
      return { ...last, waited: true, note: 'still running when the wait window elapsed' };
    }
    default: throw new Error('unknown tool ' + name);
  }
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function result(id, payload) { send({ jsonrpc: '2.0', id, result: payload }); }
function error(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});

async function handle(msg) {
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      return result(id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'dsh-bridge', version: '0.1.0' } });
    }
    if (method === 'notifications/initialized' || method === 'initialized') return;
    if (method === 'ping') return result(id, {});
    if (method === 'tools/list') return result(id, { tools });
    if (method === 'tools/call') {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      try {
        const out = await callTool(name, args);
        return result(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out });
      } catch (e) {
        return result(id, { content: [{ type: 'text', text: 'DSH bridge error: ' + e.message }], isError: true });
      }
    }
    return error(id, -32601, 'method not found: ' + method);
  } catch (e) {
    return error(id, -32603, String(e && e.message || e));
  }
}
process.stdin.on('end', () => process.exit(0));

function post(ep, route, body, timeoutMs) { return request(ep, 'POST', route, body, timeoutMs); }
function get(ep, route, timeoutMs) { return request(ep, 'GET', route, undefined, timeoutMs); }

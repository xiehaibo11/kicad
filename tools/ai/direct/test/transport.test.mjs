// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { NngClient } from '../nng.mjs';
async function fixture(mode, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kicad-sp-')), socket = path.join(dir, 'api.sock'), peers = new Set(); let connections = 0, requests = 0;
  const server = net.createServer(peer => {
    peers.add(peer); connections++; let buffer = Buffer.alloc(0), hello = false;
    peer.on('error', () => {}); peer.on('close', () => peers.delete(peer));
    peer.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!hello && buffer.length >= 8) { buffer = buffer.subarray(8); hello = true; peer.write(Buffer.from([0, 83, 80, 0, 0, mode === 'bad-handshake' ? 48 : 49, 0, 0])); }
      if (buffer.length < 13) return;
      const size = Number(buffer.readBigUInt64BE(1)); if (buffer.length < size + 9) return;
      const frame = Buffer.from(buffer.subarray(0, size + 9)); buffer = buffer.subarray(size + 9); requests++;
      if (mode === 'silent') return;
      if (mode === 'wrong-id') frame[12] ^= 1;
      if (mode === 'oversize') frame.writeBigUInt64BE(100000000n, 1);
      if (mode === 'fragment') { peer.write(frame.subarray(0, 6)); setImmediate(() => peer.write(frame.subarray(6, 11))); setImmediate(() => peer.write(frame.subarray(11))); }
      else peer.write(frame);
    });
  });
  server.listen(socket); await once(server, 'listening'); const client = new NngClient(socket);
  try { await fn(client, () => ({ connections, requests })); } finally { client.close(); for (const p of peers) p.destroy(); await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
}
test('fragmented IPC frames preserve UTF8, reuse a single socket and serialize requests', () => fixture('fragment', async (client, counts) => {
  const data = await Promise.all(['嘉立创', 'KiCad', '测试'].map(s => client.request(Buffer.from(s), { timeoutMs: 1000 })));
  assert.deepEqual(data.map(b => b.toString()), ['嘉立创', 'KiCad', '测试']); assert.deepEqual(counts(), { connections: 1, requests: 3 });
}));
for (const mode of ['wrong-id', 'oversize', 'bad-handshake']) test('rejects malformed ' + mode, () => fixture(mode, async client => {
  await assert.rejects(client.request(Buffer.from('a'), { timeoutMs: 1000 }), e => e.code === 'IPC_BAD_RESPONSE');
}));
test('deadline and cancellation do not replay a submitted edit', () => fixture('silent', async (client, counts) => {
  await assert.rejects(client.request(Buffer.from('edit'), { timeoutMs: 20 }), e => e.code === 'TIMEOUT');
  const controller = new AbortController(), pending = client.request(Buffer.from('edit2'), { timeoutMs: 1000, signal: controller.signal }); setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, e => e.code === 'CANCELLED'); assert.equal(counts().requests, 2);
  // A runtime deadline arrives as an aborted signal; it is reported as a timeout, not a user cancellation.
  await assert.rejects(client.request(Buffer.from('edit3'), { timeoutMs: 1000, signal: AbortSignal.timeout(20) }), e => e.code === 'TIMEOUT' && !/cancel/i.test(e.message)); assert.equal(counts().requests, 3);
  await assert.rejects(client.request(Buffer.from('x'), { timeoutMs: -1 }), e => e.code === 'BAD_INPUT');
}));

// SPDX-License-Identifier: GPL-3.0-or-later
// SP/IPC + REQ0 framing, matching NNG src/sp/transport/ipc and protocol/reqrep0.
// No native addon, helper process, retry of submitted writes, or Go dependency.
import net from 'node:net';
import { randomBytes } from 'node:crypto';

export class DirectError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const MAX_FRAME = 64 * 1024 * 1024;
const HELLO = Buffer.from([0, 0x53, 0x50, 0, 0, 0x30, 0, 0]);

export class NngClient {
  constructor(socketPath) {
    this.path = socketPath.replace(/^ipc:\/\//, '');
    if (this.path.includes('://')) throw new DirectError('BAD_INPUT', 'Only local KiCad IPC sockets are supported');
    this.tail = Promise.resolve();
  }

  request(payload, { timeoutMs = 30000, signal } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new DirectError('BAD_INPUT', 'timeoutMs must be positive and finite'));
    const queuedAt = Date.now();
    const run = () => this.exchange(payload, { timeoutMs: timeoutMs - (Date.now() - queuedAt), signal });
    const pending = this.tail.then(run, run);
    this.tail = pending.catch(() => {});
    return pending;
  }

  exchange(payload, { timeoutMs, signal }) {
    if (signal?.aborted) return Promise.reject(new DirectError('CANCELLED', 'IPC request cancelled'));
    if (timeoutMs <= 0) return Promise.reject(new DirectError('TIMEOUT', 'Deadline expired while waiting for KiCad'));
    if (payload.length + 4 > MAX_FRAME) return Promise.reject(new DirectError('BAD_INPUT', 'IPC request exceeds size limit'));
    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = Buffer.alloc(0);
      let ready = Boolean(this.socket && !this.socket.destroyed && this.ready);
      const socket = ready ? this.socket : net.createConnection({ path: this.path });
      this.socket = socket;
      // Keep an error listener between requests; a closed idle peer is normal.
      if (!ready) socket.on('error', () => {});
      const requestId = (randomBytes(4).readUInt32BE() | 0x80000000) >>> 0;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        socket.removeListener('data', data);
        socket.removeListener('error', error);
        socket.removeListener('close', close);
      };
      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) {
          this.ready = false;
          socket.destroy();
          reject(err);
        } else resolve(value);
      };
      const error = err => finish(new DirectError('IPC_UNAVAILABLE', err.message, this.path));
      const close = () => finish(new DirectError('IPC_UNAVAILABLE', 'KiCad closed the connection', this.path));
      // A caller deadline (AbortSignal.timeout) is a timeout, not a user cancellation.
      const abort = () => finish(signal?.reason?.name === 'TimeoutError'
        ? new DirectError('TIMEOUT', 'KiCad IPC deadline exceeded; if this was an edit, inspect before retrying')
        : new DirectError('CANCELLED', 'IPC request cancelled; if this was an edit, it may already have executed'));
      const timer = setTimeout(() => finish(new DirectError('TIMEOUT', 'KiCad IPC deadline exceeded; inspect before retrying an edit')), timeoutMs);
      const send = () => {
        const header = Buffer.alloc(13);
        header[0] = 1;
        header.writeBigUInt64BE(BigInt(payload.length + 4), 1);
        header.writeUInt32BE(requestId, 9);
        socket.write(Buffer.concat([header, payload]));
      };
      const data = chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > MAX_FRAME + 17) {
          finish(new DirectError('IPC_BAD_RESPONSE', 'KiCad IPC response exceeds size limit'));
          return;
        }
        if (!ready) {
          if (buffer.length < 8) return;
          if (!buffer.subarray(0, 4).equals(HELLO.subarray(0, 4)) ||
              buffer.readUInt16BE(4) !== 0x31 || buffer.readUInt16BE(6) !== 0) {
            finish(new DirectError('IPC_BAD_RESPONSE', 'Peer is not an SP/IPC REP0 server'));
            return;
          }
          buffer = buffer.subarray(8);
          ready = this.ready = true;
          send();
        }
        if (buffer.length < 9) return;
        const size = buffer.readBigUInt64BE(1);
        if (buffer[0] !== 1 || size < 4n || size > BigInt(MAX_FRAME)) {
          finish(new DirectError('IPC_BAD_RESPONSE', 'Invalid SP/IPC frame'));
          return;
        }
        const length = Number(size);
        if (buffer.length < length + 9) return;
        if (buffer.length !== length + 9 || buffer.readUInt32BE(9) !== requestId) {
          finish(new DirectError('IPC_BAD_RESPONSE', 'Unexpected REQ0 response identifier or extra frame'));
          return;
        }
        finish(undefined, buffer.subarray(13));
      };
      socket.on('data', data);
      socket.on('error', error);
      socket.on('close', close);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      else if (ready) send();
      else socket.once('connect', () => { if (!settled) socket.write(HELLO); });
    });
  }

  close() {
    this.ready = false;
    this.socket?.destroy();
  }
}

// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DirectError } from './nng.mjs';

export { DirectError };
export const bad = message => { throw new DirectError('BAD_INPUT', message); };
export const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const array = v => Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [];
export const nm = mm => Math.round(number(mm) * 1e6);
export const number = (value, fallback = 0) => {
  if (value === undefined || value === null) return fallback;
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value))) bad('Expected a finite number');
  return Number(value);
};
export const positive = (value, fallback) => { const n = number(value, fallback); if (n <= 0) bad('Expected a positive number'); return n; };
export const required = (p, key) => { if (p[key] === undefined || p[key] === null || p[key] === '' || (Array.isArray(p[key]) && !p[key].length)) bad(key + ' is required'); return p[key]; };
export const ok = (action, data, artifacts) => ({ ok: true, action, data, ...(artifacts?.length ? { artifacts } : {}) });
export const fail = (action, code, message, data, artifacts) => ({ ok: false, action, error: { code, message }, ...(data !== undefined ? { data } : {}), ...(artifacts?.length ? { artifacts } : {}) });
export const errorResult = (action, err) => ({ ok: false, action, error: { code: err.code ?? 'ACTION_FAILED', message: err.message, ...(err.detail !== undefined ? { detail: err.detail } : {}) } });
export function unwrap(result) {
  if (!result?.ok) throw new DirectError(result?.error?.code ?? 'ACTION_FAILED', result?.error?.message ?? 'Missing or failed action result', result?.data ?? result?.error?.detail);
  return result.data;
}
export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const hashFile = file => sha256(fs.readFileSync(file));
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function writeJSON(file, value, { exclusive = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = JSON.stringify(value, null, 2) + '\n';
  if (exclusive) fs.writeFileSync(file, raw, { flag: 'wx', mode: 0o600 });
  else {
    const temp = file + '.' + process.pid + '.' + Math.random().toString(16).slice(2) + '.tmp';
    try { fs.writeFileSync(temp, raw, { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); }
    finally { fs.rmSync(temp, { force: true }); }
  }
  return file;
}
export const tempDir = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
export function executable(value) {
  if (!value) return undefined;
  const expanded = value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  const candidates = expanded.includes(path.sep) ? [expanded] : (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, expanded));
  return candidates.find(file => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } });
}
export function execute(binary, args, { timeoutMs = 1800000, signal, directory, env = process.env, maxBytes = 16 * 1024 * 1024 } = {}) {
  if (!Array.isArray(args) || args.some(v => typeof v !== 'string' || v.includes('\0'))) bad('Process args must be strings without NUL');
  timeoutMs = positive(timeoutMs);
  maxBytes = positive(maxBytes);
  if (signal?.aborted) return Promise.reject(new DirectError('CANCELLED', 'Operation cancelled'));
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd:directory, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const stdout = [], stderr = [];
    let bytes = 0, failure;
    const stop = err => { failure ??= err; child.kill('SIGTERM'); killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1000); };
    let killTimer;
    const timer = setTimeout(() => stop(new DirectError('TIMEOUT', 'Process deadline exceeded')), positive(timeoutMs));
    const abort = () => stop(new DirectError('CANCELLED', 'Operation cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const collect = kind => chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) { stop(new DirectError('OUTPUT_LIMIT', 'Process output exceeds limit')); return; }
      (kind === 'stdout' ? stdout : stderr).push(chunk);
    };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort); };
    child.once('error', err => { cleanup(); reject(new DirectError('EXEC_FAILED', err.message)); });
    child.once('close', (exitCode, signalName) => {
      cleanup();
      if (failure) reject(failure);
      else resolve({ exitCode: exitCode ?? -1, signal: signalName, stdout: Buffer.concat(stdout).toString('utf8').trim(), stderr: Buffer.concat(stderr).toString('utf8').trim() });
    });
  });
}

export function resolvePaths(input, directory, action = input.action) {
  if (!directory) return input;
  const args = structuredClone(input), payload = args.payload ?? args;
  const file = value => typeof value === 'string' && value && !/^[a-z][\w+.-]*:\/\//i.test(value) ? path.resolve(directory,value) : value;
  for (const key of ['document','input','output','outputDir','file','project','directory','settings','spec','jar','heights','page','parent','imageFile','schematic','configDirectory']) {
    if (action === 'project.jobset.run' && key === 'output') continue;
    if (payload[key] && typeof payload[key] === 'object' && key === 'document') {
      if (payload[key].path) payload[key].path = file(payload[key].path);
      if (payload[key].project?.path) payload[key].project.path = file(payload[key].project.path);
    } else if (typeof payload[key] === 'string') payload[key] = file(payload[key]);
  }
  return args;
}

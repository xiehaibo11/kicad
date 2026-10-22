#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Runtime, byName, listActions } from './runtime.mjs';
import { ai } from './ai.mjs';
import { bad, errorResult } from './utils.mjs';
export { Runtime, listActions } from './runtime.mjs';
export { toolsList, callTool } from './tools.mjs';
export { bindTools, resolvePaths, callAction, callMutates } from './bindings.mjs';
export { ai } from './ai.mjs';
export { isLegacyKiCadServer, withoutLegacyKiCadServers } from './legacy.mjs';
export async function main(argv = process.argv.slice(2)) {
  const config = {}, payload = {}, words = []; let jsonPayload;
  const value = text => { if (text === undefined) return true; try { return JSON.parse(text); } catch { return text; } };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { words.push(argv[i]); continue; }
    const [name, ...equal] = argv[i].slice(2).split('='), key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const text = equal.length ? equal.join('=') : argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : undefined;
    if (key === 'cli') config.binary = text;
    else if (key === 'socket') config.socket = text;
    else if (['json', 'quiet'].includes(key)) continue;
    else if (key === 'payload') jsonPayload = JSON.parse(text);
    else if (key === 'payloadFile') jsonPayload = JSON.parse(fs.readFileSync(text, 'utf8'));
    else payload[key] = value(text);
  }
  const runtime = new Runtime(config);
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    let result;
    if (words[0] === 'ai') { const result = await ai(payload, runtime, {signal:controller.signal}, payload.stream ? event => process.stdout.write(JSON.stringify(event) + '\n') : undefined); if (payload.stream) { if (!result.ok) process.exitCode = 1; return; } return result; }
    if (words[0] === 'actions') result = { ok: true, data: { actions: listActions(payload), count: listActions(payload).length } };
    else {
      const aliases = { health: 'system.health', version: 'system.version', manifest: 'system.manifest' };
      let action = aliases[words[0]], rest = [];
      if (words[0] === 'call') { action = words[1]; rest = words.slice(2); }
      else if (!action) {
        if (words[0] === 'native-tools') words.splice(0, 1, 'editor', 'native');
        if (words[0] === 'blocks' && words[1] === 'ls') words[1] = 'list';
        for (let n = words.length; n > 0; n--) { const candidate = words.slice(0, n).join('.'); if (byName.has(candidate)) { action = candidate; rest = words.slice(n); break; } }
      }
      if (!action) { if (!words.length || ['help', '-h', '--help'].includes(words[0])) return { ok: true, data: { usage: 'kicad-direct actions | call <action> --payload <JSON> | health | manifest', runtime: 'Node.js >=22 shared native CLI/IPC wrapper' } }; bad('Unknown command: ' + words.join(' ')); }
      const p = { ...payload, ...jsonPayload };
      if (rest.length) { const key = action === 'spec.validate' ? 'input' : action.endsWith('.show') || action === 'reference.get' ? action.startsWith('editor.') ? 'name' : 'id' : action.endsWith('.search') ? 'query' : ['project.open', 'project.switch', 'project.resolve'].includes(action) ? 'project' : action.startsWith('workflow.') || action.startsWith('pipeline.') ? 'project' : 'input'; p[key] ??= rest.join(' '); }
      result = await runtime.dispatch(action, p, {signal:controller.signal});
    }
    return result;
  } finally { process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop); runtime.close(); }
}
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]); }
  catch { return false; }
}
if (isEntryPoint()) {
  try { const result = await main(); if (result !== undefined) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); if (!result.ok) process.exitCode = 1; } }
  catch (err) { process.stdout.write(JSON.stringify(errorResult('command', err)) + '\n'); process.exitCode = 1; }
}

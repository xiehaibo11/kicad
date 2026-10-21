// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const terminal = path.resolve(root, '..');
const repo = path.resolve(terminal, '../../..');
const upstream = process.env.KICAD_TERMINAL_SOURCE || path.join(terminal, 'cache/Kicad');
const agent = process.env.KICAD_AGENT_BINARY || path.join(repo, 'build/bin/kicad-agent');
const nngSource = process.env.NNG_SOURCE || path.join(process.env.HOME, 'kicad-deps/nng-1.12.4');
execFileSync('python3', [path.join(repo, 'tools/ai/build-manifest.py'), 'verify', terminal], { stdio: 'inherit' });
if (!execFileSync('file', [agent], { encoding: 'utf8' }).includes('arm64')) throw new Error('Expected native arm64 kicad-agent');
if (!execFileSync('go', ['version', '-m', agent], { encoding: 'utf8' }).includes('-tags=nng')) throw new Error('kicad-agent must include the full NNG IPC backend');
for (const name of ['vendor', 'resources', 'licenses']) fs.rmSync(path.join(root, name), { recursive: true, force: true });
function copy(from, to) {
  const dest = path.join(root, to); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(from, dest);
}
for (const name of ['kicad-terminal']) copy(path.join(terminal, 'dist', name), 'vendor/darwin-arm64/' + name);
copy(agent, 'vendor/darwin-arm64/kicad-agent');
for (const name of ['kicad-terminal', 'kicad-agent']) fs.chmodSync(path.join(root, 'vendor/darwin-arm64', name), 0o755);
fs.chmodSync(path.join(root, 'bin/Kicad.mjs'), 0o755);
for (const name of ['eda-agent-instructions.md', 'session-runtime.mjs', 'easyeda-mcp.mjs', 'upstream.json', 'branding.json', 'composer.json', 'waiting.json', 'build-manifest.json']) copy(path.join(terminal, 'dist', name), 'resources/' + name);
for (const skill of fs.readdirSync(path.join(repo, '.claude/skills')).filter((name) => name.startsWith('kicad-'))) {
  fs.cpSync(path.join(repo, '.claude/skills', skill), path.join(root, 'resources/skills', skill), { recursive: true });
}
copy(path.join(repo, 'LICENSE'), 'LICENSE');
copy(path.join(terminal, 'dist/LICENSE-OpenCode.txt'), 'licenses/OpenCode-MIT.txt');
copy(path.join(repo, 'tools/ai/upstream/easyeda-agent/LICENSE'), 'licenses/easyeda-agent-MIT.txt');
copy(path.join(nngSource, 'LICENSE.txt'), 'licenses/NNG-MIT.txt');
// Retain the licenses/notices of Go modules and bundled JS dependencies.
const modules = execFileSync('go', ['list', '-m', '-json', 'all'], { cwd: path.join(repo, 'tools/ai/kicad-agent'), encoding: 'utf8' });
for (const match of modules.matchAll(/"Dir": "([^"]+)"/g)) {
  const dir = JSON.parse('"' + match[1] + '"');
  for (const name of fs.readdirSync(dir).filter((name) => /^(license|copying|notice)(\.|$)/i.test(name))) {
    if (fs.statSync(path.join(dir, name)).isFile()) copy(path.join(dir, name), 'licenses/go/' + path.basename(dir) + '/' + name);
  }
}
const seen = new Set();
function licenses(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const source = path.join(dir, entry.name);
    if (entry.isDirectory()) licenses(source);
    else if (/^(license|copying|notice)(\.|$)/i.test(entry.name)) {
      const data = fs.readFileSync(source), sha = createHash('sha256').update(data).digest('hex');
      if (!seen.has(sha)) {
        seen.add(sha); copy(source, 'licenses/js/' + sha + '-' + entry.name.replace(/[^a-zA-Z0-9._-]/g, '_'));
      }
    }
  }
}
if (!fs.existsSync(path.join(upstream, 'LICENSE'))) throw new Error('Set KICAD_TERMINAL_SOURCE to the pinned full OpenCode build source');
licenses(path.join(upstream, 'node_modules'));
const files = {};
function inventory(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) inventory(file);
    else files[path.relative(root, file)] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
}
for (const name of ['bin', 'lib', 'vendor', 'resources', 'licenses']) inventory(path.join(root, name));
for (const name of ['package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'scripts/link-bin.mjs']) files[name] = createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
const build = JSON.parse(fs.readFileSync(path.join(terminal, 'dist/build-manifest.json'), 'utf8'));
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 1, version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, platform: 'darwin-arm64', nativeVersion: build.version, upstreamCommit: build.upstreamCommit, sourceSha256: build.sourceSha256, backend: 'NNG IPC + CLI + native actions + design audit + web', files }, null, 2) + '\n');
console.log('Prepared native runtime + full NNG agent, skills, plugins and third-party licenses.');

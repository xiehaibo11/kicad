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
const entry = path.join(repo, 'tools/ai/direct/dist/kicad-direct.mjs');
execFileSync('python3', [path.join(repo, 'tools/ai/build-manifest.py'), 'verify', terminal], { stdio: 'inherit' });
const capabilities = JSON.parse(execFileSync(process.execPath, [entry, 'manifest'], { encoding: 'utf8' })).data;
if (capabilities.actionCount !== 333 || capabilities.runtime !== 'shared-js') throw new Error('Shared runtime is stale');
for (const name of ['vendor', 'resources', 'licenses']) fs.rmSync(path.join(root, name), { recursive: true, force: true });
function copy(from, to) {
  const dest = path.join(root, to); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(from, dest);
}
for (const name of ['kicad-terminal']) copy(path.join(terminal, 'dist', name), 'vendor/darwin-arm64/' + name);
copy(entry, 'resources/kicad-direct.mjs');
copy(path.join(repo, 'tools/ai/direct/dist/LICENSE-protobufjs.txt'), 'licenses/protobufjs-BSD.txt');
for (const name of ['kicad-terminal']) fs.chmodSync(path.join(root, 'vendor/darwin-arm64', name), 0o755);
// The runtime reports the Kicad version it was built for; it must match this package or updates misbehave.
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const runtimeVersion = execFileSync(path.join(root, 'vendor/darwin-arm64/kicad-terminal'), ['--version'], { encoding: 'utf8' }).trim();
if (runtimeVersion !== packageVersion) throw new Error(`Runtime reports ${runtimeVersion}, package.json is ${packageVersion}: rebuild tools/ai/Kicad-terminal`);
fs.chmodSync(path.join(root, 'bin/Kicad.mjs'), 0o755);
for (const name of ['eda-agent-instructions.md', 'session-runtime.mjs', 'upstream.json', 'branding.json', 'composer.json', 'waiting.json', 'build-manifest.json']) copy(path.join(terminal, 'dist', name), 'resources/' + name);
// Standalone installations update themselves from this package, including their launcher.
copy(path.join(terminal, 'launcher.sh'), 'resources/launcher.sh');
fs.chmodSync(path.join(root, 'resources/launcher.sh'), 0o755);
for (const skill of fs.readdirSync(path.join(repo, '.claude/skills')).filter((name) => name.startsWith('kicad-'))) {
  fs.cpSync(path.join(repo, '.claude/skills', skill), path.join(root, 'resources/skills', skill), { recursive: true });
}
copy(path.join(repo, 'LICENSE'), 'LICENSE');
copy(path.join(terminal, 'dist/LICENSE-OpenCode.txt'), 'licenses/OpenCode-MIT.txt');
copy(path.join(repo,'tools/ai/direct/LICENSE-blocks-MIT.txt'),'licenses/circuit-blocks-MIT.txt');
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
for (const name of ['package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md']) files[name] = createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
const build = JSON.parse(fs.readFileSync(path.join(terminal, 'dist/build-manifest.json'), 'utf8'));
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 1, version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, platform: 'darwin-arm64', nativeVersion: build.version, upstreamCommit: build.upstreamCommit, sourceSha256: build.sourceSha256, backend: 'JavaScript native IPC + CLI + native actions + design audit + engineering references + release evidence + web', capabilities, files }, null, 2) + '\n');
console.log('Prepared native runtime + shared JavaScript runtime, skills, plugins and third-party licenses.');

// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = path.dirname(fileURLToPath(import.meta.url)), output = path.resolve(process.argv[2] ?? path.join(root, 'dist/kicad-direct.mjs'));
fs.mkdirSync(path.dirname(output), { recursive: true });
const bun = process.env.BUN ?? (fs.existsSync(path.join(process.env.HOME ?? '', '.bun/bin/bun')) ? path.join(process.env.HOME, '.bun/bin/bun') : 'bun');
execFileSync(bun, ['build', path.join(root, 'main.mjs'), '--target=node', '--format=esm', '--outfile=' + output], { stdio: 'inherit', cwd:root });
fs.chmodSync(output, 0o755);
const license = fs.readFileSync(path.join(root, 'node_modules/protobufjs/LICENSE'), 'utf8');
fs.writeFileSync(path.join(path.dirname(output), 'LICENSE-protobufjs.txt'), license);
fs.copyFileSync(path.join(root,'LICENSE-blocks-MIT.txt'),path.join(path.dirname(output),'LICENSE-blocks-MIT.txt'));
const files = {};
for (const dir of ['', 'data', 'generated']) for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) if (entry.isFile() && /\.(mjs|json)$/.test(entry.name)) { const name = path.join(dir, entry.name); files[name] = createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex'); }
fs.writeFileSync(path.join(path.dirname(output), 'direct-manifest.json'), JSON.stringify({ runtime: 'shared-js', node: '>=22', bundleSha256: createHash('sha256').update(fs.readFileSync(output)).digest('hex'), sources: files }, null, 2) + '\n');

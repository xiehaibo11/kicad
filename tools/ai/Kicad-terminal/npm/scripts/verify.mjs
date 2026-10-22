// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
for (const [name, expected] of Object.entries(manifest.files)) {
  const actual = createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
  if (actual !== expected) throw new Error('Package payload changed: ' + name + '. Run npm run build.');
}
for (const name of ['kicad-terminal']) fs.accessSync(path.join(root, 'vendor/darwin-arm64', name), fs.constants.X_OK);
console.log('Verified complete Kicad package payload (' + Object.keys(manifest.files).length + ' files).');

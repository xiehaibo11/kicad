// SPDX-License-Identifier: GPL-3.0-or-later
// npm links aliases concurrently. On a case-insensitive volume that races into
// EEXIST. Seed the canonical link first so every spelling is already satisfied.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
let modules = path.dirname(root);
while (path.basename(modules) !== 'node_modules') {
  const parent = path.dirname(modules);
  if (parent === modules) process.exit(0); // A source checkout has no npm bin directory.
  modules = parent;
}
const global = process.env.npm_config_global === 'true';
const bins = global ? path.resolve(modules, '../../bin') : path.join(modules, '.bin');
const command = path.join(bins, 'Kicad');
const target = path.relative(bins, path.join(root, 'bin/Kicad.mjs'));
fs.mkdirSync(bins, { recursive: true });
try {
  fs.symlinkSync(target, command);
} catch (error) {
  // Leave an existing command alone. npm will check ownership before linking.
  if (error.code !== 'EEXIST') throw error;
}

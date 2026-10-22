// SPDX-License-Identifier: GPL-3.0-or-later
// Derive request schemas from KiCad's own protobufs and registered C++ handlers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import protobuf from 'protobufjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const protoDir = path.join(repo, 'api/proto');
function files(dir, suffix) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(path.join(dir, entry.name), suffix) :
      entry.name.endsWith(suffix) ? [path.join(dir, entry.name)] : []);
}
const root = new protobuf.Root();
root.resolvePath = (origin, target) => target.startsWith('google/protobuf/')
  ? protobuf.util.path.resolve(path.join(here, 'node_modules/protobufjs/'), target)
  : path.join(protoDir, target);
// protobufjs ships the well-known types; loadSync resolves these itself.
root.loadSync(files(protoDir, '.proto').map(file => path.relative(protoDir, file)), { keepCase: true });
root.loadSync('google/protobuf/empty.proto', { keepCase: true });
root.resolveAll();
const types = [];
function visit(namespace) {
  for (const item of namespace.nestedArray ?? []) {
    if (item instanceof protobuf.Type) types.push(item);
    visit(item);
  }
}
visit(root);
const sources = ['common/api', 'pcbnew/api', 'eeschema/api'].flatMap(dir => files(path.join(repo, dir), '.cpp'));
const commands = new Map();
const find = value => {
  const name = value.trim().split('::').at(-1);
  const matches = types.filter(type => type.name === name);
  if (matches.length !== 1) throw new Error(`Ambiguous protobuf handler type ${value}: ${matches.map(t => t.fullName)}`);
  return matches[0].fullName.slice(1);
};
for (const file of sources) {
  const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const match of source.matchAll(/registerHandler\s*<\s*([\w:]+)\s*,\s*([\w:]+)\s*>/g)) {
    const request = find(match[1]), response = find(match[2]);
    const previous = commands.get(request);
    if (previous && previous.response !== response) throw new Error(`Conflicting response types for ${request}`);
    const mutates = !/^(Get|List|Query|Search|Check|Ping|Prove|Verify|Calculate|Compute)/.test(request.split('.').at(-1));
    commands.set(request, { request, response, mutates });
  }
}
const generated = path.join(here, 'generated');
fs.mkdirSync(generated, { recursive: true });
fs.writeFileSync(path.join(generated, 'schema.json'), JSON.stringify(root.toJSON()) + '\n');
fs.writeFileSync(path.join(generated, 'commands.json'), JSON.stringify([...commands.values()].sort((a, b) => a.request.localeCompare(b.request)), null, 2) + '\n');
const inputs = [...files(protoDir, '.proto'), ...sources].sort();
fs.writeFileSync(path.join(generated, 'inputs.json'), JSON.stringify(Object.fromEntries(inputs.map(file => [
  path.relative(repo, file), createHash('sha256').update(fs.readFileSync(file)).digest('hex')
])), null, 2) + '\n');
console.log(`Generated ${commands.size} native request definitions directly from KiCad sources`);

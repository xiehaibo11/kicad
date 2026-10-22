// Evaluate the delivered extension entry, including bundled dependencies.
// Source-only checks cannot detect unresolved indirect UMD require calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const entry = path.resolve(process.argv[2], 'dist/extension.cjs');
const require = createRequire(entry);
const module = { exports: {} };
const api = new Proxy(function () {}, {
  get(target, key) {
    if (key === 'then') return undefined;
    if (key === Symbol.toPrimitive) return () => '';
    if (key === 'prototype') return target.prototype;
    return api;
  },
  apply: () => api,
  construct: () => api
});
vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {
  module, exports: module.exports,
  require: name => name === 'vscode' ? api : require(name),
  __filename: entry, __dirname: path.dirname(entry),
  process, Buffer, console, URL, TextEncoder, TextDecoder,
  setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate,
}, { filename: entry });
assert.equal(typeof module.exports.activate, 'function');
console.log('Packaged extension entry and bundled dependencies load successfully.');

#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runtimeEnvironment } from '../lib/config.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  console.error('Kicad: this package currently supports macOS Apple Silicon (darwin-arm64).');
  process.exit(1);
}
const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const child = spawn(path.join(root, 'vendor/darwin-arm64/kicad-terminal'), process.argv.slice(2), {
    env: runtimeEnvironment(root), stdio: 'inherit',
  });
  // Terminal-generated SIGINT reaches both processes. Forward only signals
  // delivered to the launcher itself, without interrupting native TUI handling.
  const handlers = new Map();
  for (const signal of ['SIGTERM', 'SIGHUP']) {
    const handler = () => child.kill(signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  process.on('SIGINT', () => {});
  child.once('error', (error) => {
    console.error('Kicad: cannot start native runtime: ' + error.message);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    for (const [name, handler] of handlers) process.off(name, handler);
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
  });
} catch (error) {
  console.error('Kicad: ' + error.message);
  process.exitCode = 1;
}

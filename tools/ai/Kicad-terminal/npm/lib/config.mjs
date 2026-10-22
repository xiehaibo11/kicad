// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, printParseErrorCode } from 'jsonc-parser';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function record(parent, key) {
  if (parent[key] === undefined) parent[key] = {};
  if (!object(parent[key])) throw new Error(key + ' must be an object');
  return parent[key];
}
function append(parent, key, value) {
  if (parent[key] === undefined) parent[key] = [];
  if (!Array.isArray(parent[key])) throw new Error(key + ' must be an array');
  if (!parent[key].includes(value)) parent[key].push(value);
}
function executable(file) {
  if (!file) return false;
  try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); }
  catch { return false; }
}
function find(command, env, fallbacks = []) {
  return [...(env.PATH || '').split(path.delimiter).filter(Boolean).map((dir) => path.resolve(dir, command)), ...fallbacks].find(executable);
}

// How this package was installed decides how /update and `Kicad upgrade` install a new release.
export function installMethod(root) {
  const where = path.resolve(root).replaceAll('\\', '/');
  if (where.includes('/_npx/')) return 'npx';
  if (where.includes('/.bun/install/global/')) return 'bun';
  if (where.includes('/.pnpm/') || where.includes('/pnpm/global/')) return 'pnpm';
  return 'npm';
}

export function runtimeEnvironment(root, env = process.env, home = env.HOME || os.homedir()) {
  const errors = [];
  const config = env.OPENCODE_CONFIG_CONTENT?.trim()
    ? parse(env.OPENCODE_CONFIG_CONTENT, errors, { allowTrailingComma: true, disallowComments: false }) : {};
  if (errors.length) throw new Error('invalid inherited JSONC config: ' + printParseErrorCode(errors[0].error));
  if (!object(config)) throw new Error('inherited config must be an object');
  const cli = env.KICAD_CLI || find('kicad-cli', env, [
    path.join(home, '.local/bin/kicad-cli'),
    '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli',
    '/Applications/KiCad/kicad-cli',
    '/opt/homebrew/bin/kicad-cli',
  ]);
  const mcp = record(config, 'mcp');
  delete mcp.easyeda;
  delete mcp.kicad; // Built-in tools run in the terminal process.
  append(config, 'instructions', path.join(root, 'resources/eda-agent-instructions.md'));
  append(config, 'plugin', pathToFileURL(path.join(root, 'resources/session-runtime.mjs')).href);
  append(record(config, 'skills'), 'paths', path.join(root, 'resources/skills'));
  let credentials = {};
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(home, '.kicad-agent/deepseek.json'), 'utf8'));
    if (object(saved)) credentials = saved;
  }
  catch { /* Optional local credentials are never bundled or rewritten. */ }
  const apiKey = env.DEEPSEEK_API_KEY || (typeof credentials.apiKey === 'string' ? credentials.apiKey : undefined);
  if (apiKey) {
    const providers = record(config, 'provider');
    providers['kicad-deepseek'] ??= {
      npm: '@ai-sdk/anthropic', name: 'DeepSeek',
      options: { apiKey, baseURL: (typeof credentials.baseUrl === 'string' && credentials.baseUrl.trim() || 'https://api.deepseek.com/anthropic').trim().replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1' },
      models: Object.fromEntries([['deepseek-flash', 'DeepSeek Flash'], ['deepseek-v4-pro', 'DeepSeek V4 Pro']].map(([id, name]) => [id, {
        name, reasoning: true, limit: { context: 200000, output: 16000 },
        variants: { off: { thinking: { type: 'disabled' } }, ...Object.fromEntries(['low', 'high', 'max'].map((effort) => [effort, { thinking: { type: 'enabled', budgetTokens: 1024 }, effort }])) },
      }])),
    };
  }
  return {
    ...env,
    ...(cli ? { KICAD_CLI: cli } : {}),
    KICAD_INSTALL_METHOD: installMethod(root),
    KICAD_PACKAGE_ROOT: path.resolve(root),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
  };
}

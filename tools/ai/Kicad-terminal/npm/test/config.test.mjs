import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMethod, runtimeEnvironment } from '../lib/config.mjs';

test('declares the installation method so updates use the same package manager', () => {
  assert.equal(installMethod('/opt/homebrew/lib/node_modules/@-kicadai/kicad-code'), 'npm');
  assert.equal(installMethod('/Users/a/.npm/_npx/0f1e/node_modules/@-kicadai/kicad-code'), 'npx');
  assert.equal(installMethod('/Users/a/Library/pnpm/global/5/.pnpm/x/node_modules/@-kicadai/kicad-code'), 'pnpm');
  assert.equal(installMethod('/Users/a/.bun/install/global/node_modules/@-kicadai/kicad-code'), 'bun');
  const env = runtimeEnvironment('/Users/a/.npm/_npx/0f1e/node_modules/@-kicadai/kicad-code', { PATH: '', HOME: '/nonexistent' });
  assert.equal(env.KICAD_INSTALL_METHOD, 'npx');
  assert.equal(env.KICAD_PACKAGE_ROOT, '/Users/a/.npm/_npx/0f1e/node_modules/@-kicadai/kicad-code');
});

test('JSONC retains model, provider, MCP, plugin, skills and compaction choices', () => {
  const raw = '{/*keep*/"model":"custom/selected","mcp":{"kicad":{"enabled":false},"other":{"type":"remote","url":"https://example.invalid"}},"provider":{"custom":{"name":"keep"}},"plugin":["custom-plugin"],"skills":{"paths":["/custom"]},"compaction":{"auto":false},}';
  const env = { PATH: '', HOME: '/nonexistent', OPENCODE_CONFIG_CONTENT: raw };
  const result = runtimeEnvironment('/npm package', env);
  const config = JSON.parse(result.OPENCODE_CONFIG_CONTENT);
  assert.equal(env.OPENCODE_CONFIG_CONTENT, raw);
  assert.equal(config.model, 'custom/selected');
  assert.equal(config.mcp.kicad, undefined);
  assert.equal(config.mcp.other.url, 'https://example.invalid');
  assert.equal(config.provider.custom.name, 'keep');
  assert.deepEqual(config.skills.paths, ['/custom', '/npm package/resources/skills']);
  assert.equal(config.plugin[0], 'custom-plugin');
  assert.match(config.plugin[1], /^file:.*npm%20package/);
  assert.equal(config.compaction.auto, false);
});
test('malformed inherited settings fail without silently dropping user data', () => {
  for (const raw of ['{"model":', '[]', '{"mcp":[]}', '{"plugin":"wrong"}', '{"skills":[]}']) {
    assert.throws(() => runtimeEnvironment('/package', { PATH: '', HOME: '/nonexistent', OPENCODE_CONFIG_CONTENT: raw }));
  }
});
test('bundle carries full backend; optional credentials are read only; override wins', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'Kicad-npm-test-'));
  try {
    fs.mkdirSync(path.join(home, '.kicad-agent'));
    const file = path.join(home, '.kicad-agent/deepseek.json');
    const raw = JSON.stringify({ apiKey: 'fixture-only', baseUrl: 'https://example.invalid/v1/' });
    fs.writeFileSync(file, raw);
    const config = JSON.parse(runtimeEnvironment('/package', { PATH: '', HOME: home, KICAD_CLI: '/native cli', KICAD_DIRECT: '/custom runtime.mjs' }).OPENCODE_CONFIG_CONTENT);
    assert.equal(config.mcp.kicad, undefined);
    assert.ok(config.plugin.some(p => p.endsWith('/resources/session-runtime.mjs')));
    assert.equal(config.provider['kicad-deepseek'].options.baseURL, 'https://example.invalid/v1');
    assert.equal(fs.readFileSync(file, 'utf8'), raw);
    assert.equal(config.mcp.easyeda, undefined);
  } finally { fs.rmSync(home, { recursive: true }); }
});

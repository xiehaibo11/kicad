import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimeEnvironment } from '../lib/config.mjs';

test('JSONC retains model, provider, MCP, plugin, skills and compaction choices', () => {
  const raw = '{/*keep*/"model":"custom/selected","mcp":{"kicad":{"enabled":false},"other":{"type":"remote","url":"https://example.invalid"}},"provider":{"custom":{"name":"keep"}},"plugin":["custom-plugin"],"skills":{"paths":["/custom"]},"compaction":{"auto":false},}';
  const env = { PATH: '', HOME: '/nonexistent', OPENCODE_CONFIG_CONTENT: raw };
  const result = runtimeEnvironment('/npm package', env);
  const config = JSON.parse(result.OPENCODE_CONFIG_CONTENT);
  assert.equal(env.OPENCODE_CONFIG_CONTENT, raw);
  assert.equal(config.model, 'custom/selected');
  assert.deepEqual(config.mcp.kicad, { enabled: false });
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
    const config = JSON.parse(runtimeEnvironment('/package', { PATH: '', HOME: home, KICAD_CLI: '/native cli', KICAD_AGENT: '/custom agent' }).OPENCODE_CONFIG_CONTENT);
    assert.deepEqual(config.mcp.kicad.command, ['/custom agent', 'mcp']);
    assert.equal(config.mcp.kicad.environment.KICAD_CLI, '/native cli');
    assert.equal(config.provider['kicad-deepseek'].options.baseURL, 'https://example.invalid/v1');
    assert.equal(fs.readFileSync(file, 'utf8'), raw);
    assert.equal(config.mcp.easyeda, undefined);
  } finally { fs.rmSync(home, { recursive: true }); }
});

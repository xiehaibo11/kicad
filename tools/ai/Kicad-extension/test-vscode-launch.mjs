import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import host from './vscode-test-host.cjs';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kicad-launch-contract-'));
try {
  const launch = host.launchOptions(['--wait', '--user-data-dir', profile], {env: {
    PATH: '/usr/bin', HOME: '/real-home', DEEPSEEK_API_KEY: 'fixture-secret',
    ANTHROPIC_API_KEY: 'fixture-secret', VSCODE_IPC_HOOK: '/real-editor',
    ELECTRON_RUN_AS_NODE: '1', OPENCODE_CONFIG_CONTENT: '{"provider":"private"}',
    KICAD_REASONING_URL: 'http://127.0.0.1:1234'
  }});
  assert.ok(launch.args.includes('--use-inmemory-secretstorage'));
  assert.equal(launch.args.includes('--wait'), false);
  assert.equal(launch.options.detached, true);
  assert.equal(launch.options.env.HOME, path.join(profile, 'home'));
  for (const key of ['DEEPSEEK_API_KEY','ANTHROPIC_API_KEY','VSCODE_IPC_HOOK','ELECTRON_RUN_AS_NODE','OPENCODE_CONFIG_CONTENT']) {
    assert.equal(launch.options.env[key], undefined, key + ' must not leak into the test host');
  }
  assert.equal(launch.options.env.KICAD_REASONING_URL, 'http://127.0.0.1:1234');
  assert.ok(fs.statSync(launch.options.env.HOME).isDirectory());
  assert.throws(() => host.launchOptions([]), /isolated/);
  console.log('VS Code launch isolation passed: memory secrets, credential exclusion, own app process group.');
} finally {fs.rmSync(profile, {recursive: true, force: true});}

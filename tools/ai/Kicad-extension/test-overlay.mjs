// Validate the patched sources and exercise terminal/config boundaries without
// launching an AI session, changing user configuration, or touching a PCB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const root = process.argv[2];
if (!root) throw new Error('usage: node test-overlay.mjs <patched-source-directory>');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.displayName, 'Kicad');
assert.equal(manifest.contributes.views['kicad-sidebar'][0].id, 'kicad.chatView');
assert.ok(!manifest.contributes.views['claudix-chat-sidebar']);
assert.ok(manifest.contributes.commands.some(command => command.command === 'kicad.showChat'));
const handlers = new Map();
const terminals = [];
const errors = [];
let uriHandler;
const folders = [{ uri: { fsPath: '/tmp/first board' } }, { uri: { fsPath: '/tmp/second board' } }];
const settings = {
  path: process.execPath,
  kicadCli: '/tmp/KiCad Test.app/kicad-cli',
  socket: '/tmp/custom.sock',
  'openCode.path': process.execPath,
  'openCode.args': ['--continue', '--model', 'test/model;literal'],
  'openCode.injectMcp': true,
  'deepseek.apiKey': 'test-deepseek-key',
  'deepseek.baseUrl': 'https://example.test/anthropic'
};
// Tests never consume a developer's real inline provider configuration or keys.
delete process.env.OPENCODE_CONFIG_CONTENT;
delete process.env.DEEPSEEK_API_KEY;
const vscode = {
  Uri: { file: fsPath => ({ fsPath }) },
  workspace: {
    isTrusted: true,
    workspaceFolders: folders,
    getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }),
    openTextDocument: async options => options
  },
  commands: {
    registerCommand: (name, handler) => { handlers.set(name, handler); return { dispose() {} }; },
    executeCommand: async name => handlers.get(name)?.()
  },
  window: {
    registerUriHandler: handler => { uriHandler = handler; return { dispose() {} }; },
    showErrorMessage: message => { errors.push(message); },
    showWorkspaceFolderPick: async () => folders[1],
    createTerminal: options => { terminals.push(options); return { show() {} }; },
    showTextDocument: async () => {}
  }
};

function load(relative, overrides = {}) {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
  });
  const diagnostics = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n'
  }));
  const module = { exports: {} };
  vm.runInNewContext(result.outputText, {
    module, exports: module.exports, process, console, Buffer, URL,
    require: name => name === 'vscode' ? vscode : overrides[name] ?? require(name)
  }, { filename: file });
  return module.exports;
}

const runtime = load('src/kicadRuntime.ts');
const server = runtime.getKiCadMcpServer('/tmp/second board');
assert.equal(server.command, process.execPath);
assert.equal(server.env.KICAD_CLI, settings.kicadCli);
assert.equal(server.env.KICAD_API_SOCKET, settings.socket);
const inherited = '{/* keep config */ "model":"provider/model", "plugin":["example"], "mcp":{"other":{"enabled":false}},}';
const merged = JSON.parse(runtime.openCodeConfig(server, inherited));
assert.equal(merged.model, 'provider/model');
assert.deepEqual(merged.plugin, ['example']);
assert.equal(merged.mcp.other.enabled, false);
assert.deepEqual(merged.mcp.kicad.command, [process.execPath, 'mcp']);
assert.equal(merged.permission, undefined);
assert.equal(JSON.parse(runtime.openCodeConfig(server, '{"mcp":{"kicad":{"enabled":false}}}')).mcp.kicad.enabled, false);
for (const invalid of ['null', '[]', '{broken', '{"mcp":[]}']) {
  assert.throws(() => runtime.openCodeConfig(server, invalid));
}
const providerConfig = JSON.parse(runtime.openCodeConfig(server, inherited, {apiKey:'test-only',baseUrl:'https://example.test/anthropic/'}));
assert.equal(providerConfig.provider['kicad-deepseek'].options.baseURL, 'https://example.test/anthropic/v1');
assert.equal(providerConfig.model, 'provider/model');
assert.ok(providerConfig.provider['kicad-deepseek'].models['deepseek-flash']);
assert.deepEqual(JSON.parse(runtime.openCodeConfig(server, '{"provider":{"kicad-deepseek":{"name":"custom"}}}', {apiKey:'test-only',baseUrl:'https://example.test'})).provider['kicad-deepseek'], {name:'custom'});
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kicad-executable-test-'));
try {
  const executable = path.join(temporary, 'tool with spaces');
  fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal(runtime.findExecutable(executable), executable);
  assert.equal(runtime.findExecutable(temporary), undefined);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

load('src/kicadIntegration.ts', { './kicadRuntime': runtime, './kicadProviders': { resolveDeepSeekCredentials: async()=>undefined } }).registerKiCadIntegration({ subscriptions: [] });
const start = handlers.get('kicadAgent.startOpenCode');
await start();
assert.equal(terminals.length, 1);
assert.equal(terminals[0].cwd.fsPath, folders[1].uri.fsPath);
assert.equal(terminals[0].shellPath, process.execPath);
assert.deepEqual(Array.from(terminals[0].shellArgs), settings['openCode.args']);
assert.equal(JSON.parse(terminals[0].env.OPENCODE_CONFIG_CONTENT).mcp.kicad.type, 'local');
vscode.workspace.isTrusted = false;
await start();
assert.equal(terminals.length, 1);
vscode.workspace.isTrusted = true;
settings['openCode.path'] = '/nonexistent/kicad-opencode-test';
await start();
assert.equal(terminals.length, 1);
assert.ok(errors.some(message => message.includes('Kicad terminal executable not found')));
settings['openCode.path'] = process.execPath;
settings['openCode.injectMcp'] = false;
settings.path = '/nonexistent/kicad-agent-test';
await start();
assert.equal(terminals.length, 2);
vscode.workspace.workspaceFolders = folders;
settings.path = process.execPath;
await uriHandler.handleUri({ path: '/unrecognized' });
assert.equal(terminals.length, 2);
await uriHandler.handleUri({ path: '/terminal' });
assert.equal(terminals.length, 3);
assert.equal(terminals[2].name, 'Kicad 终端');
assert.equal(terminals[2].env.OPENCODE_DISABLE_TERMINAL_TITLE, 'true');
assert.equal(terminals[1].env.OPENCODE_CONFIG_CONTENT, undefined);
assert.equal(terminals[1].env.OPENCODE_PERMISSION, undefined);
vscode.workspace.workspaceFolders = [];
await start();
assert.equal(terminals.length, 3);

// Third-party provider routing: a DeepSeek model gets the provider endpoint,
// credentials and model name; a Claude model is left untouched.  A temporary
// home directory keeps the developer's real key file out of the test.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kicad-provider-test-'));
const providers = load('src/kicadProviders.ts', { 'node:os': { homedir: () => fakeHome } });
const providerEnv = {};
assert.equal(await providers.applyProviderEnvironment(undefined, providerEnv, 'deepseek-flash'), true);
assert.equal(providerEnv.ANTHROPIC_BASE_URL, 'https://example.test/anthropic');
assert.equal(providerEnv.ANTHROPIC_AUTH_TOKEN, 'test-deepseek-key');
assert.equal(providerEnv.ANTHROPIC_API_KEY, 'test-deepseek-key');
assert.equal(providerEnv.ANTHROPIC_MODEL, 'deepseek-flash');
assert.equal(providerEnv.ANTHROPIC_SMALL_FAST_MODEL, 'deepseek-flash');
const claudeEnv = {};
assert.equal(await providers.applyProviderEnvironment(undefined, claudeEnv, 'sonnet'), true);
assert.deepEqual(claudeEnv, {});
delete settings['deepseek.apiKey'];
assert.equal(await providers.applyProviderEnvironment(undefined, {}, 'deepseek-flash'), false);
settings['deepseek.apiKey'] = 'test-deepseek-key';
fs.rmSync(fakeHome, { recursive: true, force: true });

// Parse the two upstream integration points as well as the newly added files.
load('src/extension.ts', new Proxy({}, { get: () => ({}) }));
// SDK imports require real extension services, so syntax-check without running.
const sdk = fs.readFileSync(path.join(root, 'src/services/claude/ClaudeSdkService.ts'), 'utf8');
const parsed = ts.createSourceFile('ClaudeSdkService.ts', sdk, ts.ScriptTarget.Latest, true);
assert.equal(parsed.parseDiagnostics.length, 0);
assert.match(sdk, /mcpServers:\s*\{\s*kicad: getKiCadMcpServer\(cwdParam\)/);
assert.match(sdk, /applyProviderEnvironment\(this\.context, env, modelParam\)/);
assert.match(sdk, /# KiCad Context/);
assert.match(sdk, /easyeda: getEasyEdaMcpServer\(cwdParam\)!/);
assert.match(sdk, /allowedTools: READ_ONLY_EDA_TOOLS/);
assert.match(sdk, /Kicad EDA agent — understand the request, then use tools/, 'shared intent-first routing is in the system prompt');
assert.match(sdk,/granting tool permission does not create a user task/);
assert.ok(!/\/kicad-(check|drc|fab|route|schematic|step)\b/.test(sdk.split('# KiCad Context')[1]), 'routing never requires slash commands');
const extras = JSON.parse(runtime.openCodeConfig(server, '{"instructions":["AGENTS.md"]}', undefined,
  {easyeda:{command:'node',args:['/x/easyeda-mcp.mjs'],env:{EASYEDA_BIN:'/x/easyeda'}}, instructions:'/x/eda-agent-instructions.md'}));
assert.deepEqual(extras.instructions, ['AGENTS.md', '/x/eda-agent-instructions.md']);
assert.deepEqual(extras.mcp.easyeda.command, ['node', '/x/easyeda-mcp.mjs']);
assert.equal(extras.mcp.easyeda.environment.EASYEDA_BIN, '/x/easyeda');
assert.equal(JSON.parse(runtime.openCodeConfig(server, '{"mcp":{"easyeda":{"enabled":false}}}', undefined,
  {easyeda:{command:'node',args:['a'],env:{}}})).mcp.easyeda.enabled, false, 'explicit inherited easyeda wins');
assert.ok(runtime.READ_ONLY_EDA_TOOLS.every(name => /^mcp__(kicad|easyeda)__/.test(name)));
assert.ok(!runtime.READ_ONLY_EDA_TOOLS.some(name => /kicad_call|kicad_board|easyeda_pcb/.test(name)), 'mutating tools still prompt');
console.log('Overlay checks passed: native terminal, workspace selection, MCP config preservation, trust, paths, provider routing, SDK syntax.');

assert.ok(fs.readFileSync(path.join(root,'src/services/logService.ts'),'utf8').includes("createOutputChannel('Kicad'"));
assert.ok(fs.readFileSync(path.join(root,'src/webview/src/core/SessionStore.ts'),'utf8').includes("const defaultTitle = 'Kicad'"));
const terminalHandler=fs.readFileSync(path.join(root,'src/services/claude/handlers/handlers.ts'),'utf8');
assert.ok(terminalHandler.includes("await vscode.commands.executeCommand('kicadAgent.startOpenCode')"));
assert.ok(!terminalHandler.includes('terminal.sendText("claude --help")'));

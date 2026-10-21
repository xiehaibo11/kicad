// SPDX-License-Identifier: AGPL-3.0-only
// Runtime shared by the Claudix chat and the native OpenCode terminal.
import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { parse, ParseError } from 'jsonc-parser';

export function findExecutable(value: string): string | undefined {
  const expanded = value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  const names = process.platform === 'win32' && !path.extname(expanded)
    ? [expanded + '.exe', expanded] : [expanded];
  const dirs = path.isAbsolute(expanded) ? [''] : [
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.opencode', 'bin'),
    '/opt/homebrew/bin', '/usr/local/bin'
  ];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.resolve(dir, name);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch { /* Try the next path. */ }
    }
  }
  return undefined;
}

export function getKiCadMcpServer(cwd?: string) {
  const cfg = vscode.workspace.getConfiguration('kicadAgent', cwd ? vscode.Uri.file(cwd) : undefined);
  const configured = cfg.get<string>('path', 'kicad-agent');
  const env: Record<string, string> = {};
  const cli = cfg.get<string>('kicadCli', '');
  const socket = cfg.get<string>('socket', '');
  if (cli) env.KICAD_CLI = cli;
  if (socket) env.KICAD_API_SOCKET = socket;
  return { command: findExecutable(configured) ?? configured, args: ['mcp'], env };
}

// Files shipped in the VSIX under resources/kicad (see build.sh).
function extensionResource(name: string): string | undefined {
  const roots = [vscode.extensions?.getExtension?.('kicad-agent.kicad')?.extensionPath,
    typeof __dirname === 'string' ? path.join(__dirname, '..') : undefined];
  for (const root of roots) {
    if (!root) continue;
    const candidate = path.join(root, 'resources', 'kicad', name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

// EDA Agent Connector: the upstream easyeda-agent stdio MCP adapter, bundled in
// the VSIX. Registered only when its CLI and node exist; easyeda_health then
// reports whether the daemon and an EasyEDA Pro window are connected.
export function getEasyEdaMcpServer(cwd?: string): { command: string; args: string[]; env: Record<string, string> } | undefined {
  const cfg = vscode.workspace.getConfiguration('kicadAgent', cwd ? vscode.Uri.file(cwd) : undefined);
  if (!cfg.get<boolean>('easyeda.enabled', true)) return undefined;
  const easyeda = findExecutable(cfg.get<string>('easyeda.path', 'easyeda'));
  const node = findExecutable('node');
  const bundle = extensionResource('easyeda-mcp.mjs');
  if (!easyeda || !node || !bundle) return undefined;
  return { command: node, args: [bundle], env: { EASYEDA_BIN: easyeda } };
}

// Always-on routing from plain requests to EDA tools; no slash commands needed.
export function getAgentInstructionsPath(): string | undefined {
  return extensionResource('eda-agent-instructions.md');
}

// Read-only tools that run without a permission prompt. Mutating domain tools
// (kicad_board, kicad_call, easyeda_pcb, ...) keep the selected permission mode.
export const READ_ONLY_EDA_TOOLS = [
  'mcp__kicad__kicad_health', 'mcp__kicad__kicad_actions', 'mcp__kicad__kicad_native_tools',
  'mcp__kicad__kicad_spec_validate', 'mcp__kicad__kicad_blocks', 'mcp__kicad__kicad_library',
  'mcp__kicad__kicad_system',
  'mcp__easyeda__easyeda_health', 'mcp__easyeda__easyeda_actions', 'mcp__easyeda__easyeda_blocks'
];

// Inline config is merged by OpenCode with its normal global/project config.
// Preserve inherited inline settings, including an explicitly configured kicad.
export function openCodeConfig(server: ReturnType<typeof getKiCadMcpServer>, inherited?: string, deepseek?: {apiKey: string; baseUrl: string},
  extras?: {easyeda?: ReturnType<typeof getEasyEdaMcpServer>; instructions?: string}): string {
  const errors: ParseError[] = [];
  const existing = inherited ? parse(inherited, errors, { allowTrailingComma: true }) : {};
  if (errors.length || !existing || typeof existing !== 'object' || Array.isArray(existing)) {
    throw new Error('OPENCODE_CONFIG_CONTENT must contain a JSON/JSONC object.');
  }
  if (existing.mcp !== undefined &&
      (!existing.mcp || typeof existing.mcp !== 'object' || Array.isArray(existing.mcp))) {
    throw new Error('OPENCODE_CONFIG_CONTENT.mcp must be an object.');
  }
  if (existing.provider !== undefined &&
      (!existing.provider || typeof existing.provider !== 'object' || Array.isArray(existing.provider))) {
    throw new Error('OPENCODE_CONFIG_CONTENT.provider must be an object.');
  }
  const provider = deepseek ? {
    'kicad-deepseek': {
      npm: '@ai-sdk/anthropic', name: 'DeepSeek',
      options: {apiKey: deepseek.apiKey, baseURL: deepseek.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1'},
      models: Object.fromEntries(['deepseek-flash','deepseek-v4-pro'].map(id=>[id,{
        name: id === 'deepseek-flash' ? 'DeepSeek Flash' : 'DeepSeek V4 Pro',
        reasoning: true,
        limit: {context: 200000, output: 16000},
        variants: {
          off: {thinking:{type:'disabled'}},
          low: {thinking:{type:'enabled',budgetTokens:1024},effort:'low'},
          high: {thinking:{type:'enabled',budgetTokens:1024},effort:'high'},
          max: {thinking:{type:'enabled',budgetTokens:1024},effort:'max'}
        }
      }]))
    }
  } : {};
  if (existing.instructions !== undefined && !Array.isArray(existing.instructions)) {
    throw new Error('OPENCODE_CONFIG_CONTENT.instructions must be an array.');
  }
  const instructions = extras?.instructions && !(existing.instructions ?? []).includes(extras.instructions)
    ? [...(existing.instructions ?? []), extras.instructions] : existing.instructions;
  const runtime=extensionResource('session-runtime.mjs');
  if(existing.plugin!==undefined&&!Array.isArray(existing.plugin))throw new Error('OPENCODE_CONFIG_CONTENT.plugin must be an array.');
  const plugin=runtime?Array.from(new Set([...(existing.plugin??[]),vscode.Uri.file(runtime).toString()])):existing.plugin;
  return JSON.stringify({
    ...existing,
    ...(plugin?{plugin}:{}),
    ...(deepseek ? {provider: {...provider, ...existing.provider}} : {}),
    ...(instructions ? {instructions} : {}),
    mcp: {
      kicad: { type: 'local', command: [server.command, ...server.args], environment: server.env, enabled: true },
      ...(extras?.easyeda ? {easyeda: { type: 'local', command: [extras.easyeda.command, ...extras.easyeda.args], environment: extras.easyeda.env, enabled: true }} : {}),
      ...existing.mcp
    }
  });
}

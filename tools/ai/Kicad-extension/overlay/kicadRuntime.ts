// SPDX-License-Identifier: AGPL-3.0-only
// Runtime shared by the Claudix chat and the native OpenCode terminal.
import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { parse, ParseError } from 'jsonc-parser';
import { KICAD_LOAD_TOOL, KICAD_LOAD_DESCRIPTION, needsKiCadTools } from './kicadToolsPolicy';

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

export function getKiCadRuntimeConfig(cwd?: string) {
  const cfg = vscode.workspace.getConfiguration('kicadAgent', cwd ? vscode.Uri.file(cwd) : undefined);
  const entry = cfg.get<string>('directPath', '') || extensionResource('kicad-direct.mjs');
  if (!entry) throw new Error('Bundled KiCad JavaScript runtime is missing. Rebuild the extension.');
  const env: Record<string, string> = {};
  const cli = cfg.get<string>('kicadCli', '');
  const socket = cfg.get<string>('socket', '');
  if (cli) env.KICAD_CLI = cli;
  if (socket) env.KICAD_API_SOCKET = socket;
  return { entry, env };
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

// Always-on routing from plain requests to EDA tools; no slash commands needed.
export function getAgentInstructionsPath(): string | undefined {
  return extensionResource('eda-agent-instructions.md');
}

// Read-only tools that run without a permission prompt: every action only reads and stays local
// (the shared definitions' readOnlyHint without openWorldHint). kicad_web reaches the network and
// kicad_gerber writes converted images, so they ask like mutating domain tools (kicad_board,
// kicad_call, ...), which keep the selected permission mode.
export const READ_ONLY_EDA_TOOLS = [
  'mcp__kicad__kicad_load', 'mcp__kicad__kicad_health', 'mcp__kicad__kicad_actions', 'mcp__kicad__kicad_native_tools',
  'mcp__kicad__kicad_spec_validate', 'mcp__kicad__kicad_blocks', 'mcp__kicad__kicad_reference', 'mcp__kicad__kicad_audit'
];

// KiCad tools load on demand. A chat process starts with only kicad_load; the agent service relaunches
// the conversation with the full tools (and their guidance) when a message is about KiCad work, when
// kicad_load was called, or when the stored conversation already used them. Tools can't be added to a
// running SDK process, so loading takes effect with the next message.
const kicadSessions = new Set<string>();
export function rememberKiCadSession(sessionId: string | null | undefined) {
  if (sessionId) kicadSessions.add(sessionId);
}

/** Text the user actually sent: plain content, text blocks and IDE selections; never tool results. */
export function messageText(message: any): string {
  const content = message?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block: any) => block?.type === 'text' && typeof block.text === 'string' ? block.text : '').join('\n');
}

export function wantsKiCadTools(message: any): boolean {
  return needsKiCadTools(messageText(message));
}

/** Whether a stored conversation already worked with KiCad: KiCad tool use or a KiCad request. */
export async function sessionUsedKiCad(sessionId: string | null | undefined, cwd: string): Promise<boolean> {
  if (!sessionId) return false;
  if (kicadSessions.has(sessionId)) return true;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return false;
  // The CLI stores conversations under the project's real path (not macOS /var aliases).
  const projects = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects');
  const real = await fs.promises.realpath(cwd).catch(() => cwd);
  let raw: string | undefined;
  for (const dir of new Set([real, cwd])) {
    try { raw = await fs.promises.readFile(path.join(projects, dir.replace(/[^a-zA-Z0-9]/g, '-'), sessionId + '.jsonl'), 'utf8'); break; }
    catch { /* not stored under this name */ }
  }
  if (raw === undefined) return false;
  let used = /"name":"mcp__kicad__kicad_(?!load")/.test(raw);
  if (!used) {
    for (const line of raw.split('\n')) {
      if (!line.includes('"type":"user"')) continue;
      try {
        const entry = JSON.parse(line);
        if (entry?.type === 'user' && !entry.isMeta && wantsKiCadTools(entry)) { used = true; break; }
      } catch { /* A partial last line is ignored. */ }
    }
  }
  if (used) kicadSessions.add(sessionId);
  return used;
}

export type KiCadToolsOptions = { tools: boolean; onLoad?: () => void };

// Inline config is merged by OpenCode with its normal global/project config.
// Preserve inherited settings; built-in tools replace old connector entries.
export function openCodeConfig(inherited?: string, deepseek?: {apiKey: string; baseUrl: string},
  extras?: {instructions?: string}): string {
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
  const mcp = {...existing.mcp}; delete mcp.easyeda; delete mcp.kicad;
  return JSON.stringify({
    ...existing,
    ...(plugin?{plugin}:{}),
    ...(deepseek ? {provider: {...provider, ...existing.provider}} : {}),
    ...(instructions ? {instructions} : {}),
    mcp
  });
}

const nativeRuntimes = new Map<string, any>();
export function closeKiCadRuntimes() { for(const runtime of nativeRuntimes.values()) runtime.close(); nativeRuntimes.clear(); }
export async function getKiCadNativeTools(cwd?: string) {
  const server = getKiCadRuntimeConfig(cwd), key = JSON.stringify({cwd,entry:server.entry,env:server.env});
  const direct = await import(pathToFileURL(server.entry).href);
  const runtime = nativeRuntimes.get(key) ?? new direct.Runtime({notify:async(message:string,level:string)=>{if(level==='error')void vscode.window.showErrorMessage(message);else if(level==='warning')void vscode.window.showWarningMessage(message);else void vscode.window.showInformationMessage(message);},...(server.env.KICAD_CLI ? {binary:server.env.KICAD_CLI} : {}), ...(server.env.KICAD_API_SOCKET ? {socket:server.env.KICAD_API_SOCKET} : {})});
  nativeRuntimes.set(key,runtime);
  return direct.bindTools(runtime, z);
}
export async function getKiCadSdkServer(cwd?: string, options: KiCadToolsOptions = { tools: true }) {
  const reply = (data: Record<string, unknown>) => ({content:[{type:'text' as const,text:JSON.stringify({ok:true,action:'tools.load',data})}]});
  const loader = tool(KICAD_LOAD_TOOL, KICAD_LOAD_DESCRIPTION, {}, async () => {
    if (options.tools) return reply({note:'The KiCad tools are already loaded in this conversation.'});
    options.onLoad?.();
    return reply({pending:true,note:'KiCad tools are enabled for this conversation and are attached when the user sends the next message; they cannot be called in this reply. Tell the user in one sentence, and ask them to send the request again (for example: 继续).'});
  });
  if (!options.tools) return createSdkMcpServer({name:'kicad',version:'0.1.0',tools:[loader]});
  const tools = (await getKiCadNativeTools(cwd)).map((binding:any) => tool(binding.name, binding.description, binding.args,
    async (args:any,extra:any) => { const result = await binding.execute(args, {signal:extra?.signal,directory:cwd}); return {content:[{type:'text' as const,text:JSON.stringify(result)}],isError:!result.ok}; }));
  return createSdkMcpServer({name:'kicad',version:'0.1.0',tools:[loader,...tools]});
}

export async function getKiCadSdkServers(cwd: string | undefined, configured: Record<string, unknown> = {}, options: KiCadToolsOptions = { tools: true }) {
  const {entry}=getKiCadRuntimeConfig(cwd), direct=await import(pathToFileURL(entry).href);
  return {...direct.withoutLegacyKiCadServers(configured), kicad:await getKiCadSdkServer(cwd, options)};
}

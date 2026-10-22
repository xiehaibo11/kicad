import {DemandCatalog, demandDefinitions, mcpConnector} from './shared/kicadDemand';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {localToolBindings,localToolDefinitions} from './shared/kicadLocalTools';
// SPDX-License-Identifier: AGPL-3.0-only
// Runtime shared by the Claudix chat and the native OpenCode terminal.
import {diagnosticReport} from './shared/kicadDiagnostics';
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
  'mcp__kicad__session_history', 'mcp__kicad__runtime_diagnostics', 'mcp__kicad__kicad_load', 'mcp__kicad__kicad_health', 'mcp__kicad__kicad_actions', 'mcp__kicad__kicad_native_tools',
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
export function closeKiCadRuntimes() { for(const catalog of demandCatalogs)void catalog.close(); demandCatalogs.clear(); for(const runtime of nativeRuntimes.values()) runtime.close(); nativeRuntimes.clear(); }
export async function getKiCadNativeTools(cwd?: string) {
  const server = getKiCadRuntimeConfig(cwd), key = JSON.stringify({cwd,entry:server.entry,env:server.env});
  const direct = await import(pathToFileURL(server.entry).href);
  const runtime = nativeRuntimes.get(key) ?? new direct.Runtime({notify:async(message:string,level:string)=>{if(level==='error')void vscode.window.showErrorMessage(message);else if(level==='warning')void vscode.window.showWarningMessage(message);else void vscode.window.showInformationMessage(message);},...(server.env.KICAD_CLI ? {binary:server.env.KICAD_CLI} : {}), ...(server.env.KICAD_API_SOCKET ? {socket:server.env.KICAD_API_SOCKET} : {})});
  nativeRuntimes.set(key,runtime);
  return direct.bindTools(runtime, z);
}
const demandCatalogs=new Set<DemandCatalog>();
export function createDemandCatalog(cwd=process.cwd(),configured:Record<string,any>={},skillFiles:string[]=[],disabledSkills:string[]=[]) {
  const servers=Object.fromEntries(Object.entries(configured).filter(([name])=>!['kicad','easyeda'].includes(name)));
  const catalog=new DemandCatalog({cwd,servers,skillFiles,disabledSkills,connect:mcpConnector({Client,StdioClientTransport,SSEClientTransport,StreamableHTTPClientTransport},cwd),builtins:async()=>{
    const {entry}=getKiCadRuntimeConfig(cwd),direct=await import(pathToFileURL(entry).href);
    const native=await getKiCadNativeTools(cwd);
    return [...native,...localToolBindings(z,cwd),{name:'runtime_diagnostics',description:'Read local runtime diagnostics and error analysis. 日志 报错 运行诊断',args:{sessionId:z.string().optional()},execute:(args:any)=>diagnosticReport(cwd,args.sessionId)}].map((b:any)=>({name:b.name,description:b.description,inputSchema:direct.toolsList().find((d:any)=>d.name===b.name)?.inputSchema || (b.name==='runtime_diagnostics'?{type:'object',properties:{sessionId:{type:'string'}}}:localToolDefinitions.find(d=>d.name===b.name)?.inputSchema),execute:(args:any,ctx:any)=>b.execute(z.object(b.args).parse(args),{...ctx,directory:cwd})}));
  }});
  const close=catalog.close.bind(catalog);catalog.close=async()=>{demandCatalogs.delete(catalog);await close();};
  demandCatalogs.add(catalog);return catalog;
}
export async function getKiCadSdkServer(cwd?:string,_options:KiCadToolsOptions={tools:false},configured:Record<string,any>={}) {
  const catalog=createDemandCatalog(cwd,configured);
  const reply=(result:any)=>({content:[{type:'text' as const,text:JSON.stringify(result)}],isError:result?.ok===false||!!result?.isError});
  const server=createSdkMcpServer({name:'kicad',version:'0.2.0',tools:[
    tool('capability_search',demandDefinitions[0].description,{query:z.string(),kind:z.enum(['tool','skill','server']),server:z.string().optional(),offset:z.number().int().min(0).optional()},async args=>reply(await catalog.search(args))),
    tool('capability_call',demandDefinitions[1].description,{id:z.string(),arguments:z.record(z.unknown())},async(args,extra:any)=>reply(await catalog.call(args.id,args.arguments,{signal:extra?.signal})))
  ]});
  server.instance.server.onclose=()=>{void catalog.close();demandCatalogs.delete(catalog);};
  return server;
}
export async function getKiCadSdkServers(cwd:string|undefined,configured:Record<string,unknown>={},options:KiCadToolsOptions={tools:false}) {
  return {kicad:await getKiCadSdkServer(cwd,options,configured)};
}

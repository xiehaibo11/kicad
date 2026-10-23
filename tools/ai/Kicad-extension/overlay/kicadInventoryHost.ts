import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import {settingsFiles,settingsInventory} from './shared/kicadInventory';
import {kicadAgents,kicadToolSettings} from './kicadRuntime';
import {MCP_SOURCES,DEFAULT_MCP_SYNC} from './shared/kicadMcpSync';

// Settings pages read configuration from disk. Nothing here connects an MCP
// server, runs a hook or starts the CLI; toggles only edit the Kicad settings
// that the capability catalog already obeys.
const BUILTIN_HOOKS=[
  {event:'SessionStart',description:'Kicad: restores the task checkpoint after compaction.'},
  {event:'UserPromptSubmit',description:'Kicad: records the request and adds task-continuity guidance.'},
  {event:'PreToolUse',description:'Kicad: journals each call; refuses sub-agents the user did not ask for.'},
  {event:'PostToolUse',description:'Kicad: journals results and archives large tool output.'},
  {event:'PostToolUseFailure',description:'Kicad: adds a short failure note so a repeated failure changes approach.'},
  {event:'PreCompact',description:'Kicad: saves a task checkpoint before the context is compacted.'},
];
const folder=()=>vscode.workspace.workspaceFolders?.[0]?.uri.fsPath||process.cwd();

export async function kicadInventory(){
  const cwd=folder(),settings=kicadToolSettings(cwd);
  const agents=Object.entries(kicadAgents(settings)??{}).map(([name,agent])=>({name,description:agent.description}));
  return settingsInventory({cwd,disabledSkills:settings.disabledSkills,disabledServers:settings.disabledServers,mcpSync:settings.mcpSync,skillsMode:settings.skillsMode,mcpMode:settings.mcpMode,
    builtins:{tools:['capability_search','capability_call',...(settings.subagents?['capability_inspect']:[])],agents,hooks:BUILTIN_HOOKS}});
}

/** Adds or removes a skill or MCP server name in the Kicad disable lists. */
export async function setKicadEnabled(kind:'skill'|'server',name:string,enabled:boolean){
  if(!name||typeof name!=='string')throw new Error('A name is required.');
  const key=kind==='skill'?'skills.disabled':'mcp.disabledServers',cfg=vscode.workspace.getConfiguration('kicadAgent',vscode.Uri.file(folder()));
  // Write where the list is already defined, so a workspace value is not shadowed by a user one.
  const info=cfg.inspect<string[]>(key);
  const target=info?.workspaceFolderValue!==undefined?vscode.ConfigurationTarget.WorkspaceFolder:info?.workspaceValue!==undefined?vscode.ConfigurationTarget.Workspace:vscode.ConfigurationTarget.Global;
  const current=(target===vscode.ConfigurationTarget.WorkspaceFolder?info?.workspaceFolderValue:target===vscode.ConfigurationTarget.Workspace?info?.workspaceValue:info?.globalValue)??[];
  const next=enabled?current.filter(item=>item!==name):Array.from(new Set([...current,name]));
  await cfg.update(key,next.length?next:undefined,target);
  return {enabled,applies:'next conversation'};
}

/** Turns syncing of one tool's MCP configuration on or off (kicadAgent.mcp.sync). */
export async function setKicadSync(source:string,enabled:boolean){
  if(!MCP_SOURCES.some(item=>item.id===source))throw new Error('Unknown MCP source: '+source);
  const cfg=vscode.workspace.getConfiguration('kicadAgent',vscode.Uri.file(folder())),info=cfg.inspect<string[]>('mcp.sync');
  const target=info?.workspaceFolderValue!==undefined?vscode.ConfigurationTarget.WorkspaceFolder:info?.workspaceValue!==undefined?vscode.ConfigurationTarget.Workspace:vscode.ConfigurationTarget.Global;
  const current=kicadToolSettings(folder()).mcpSync;
  const next=enabled?Array.from(new Set([...current,source])):current.filter(item=>item!==source);
  // Keep canonical order. Plugin sources are opt-in, separate from the defaults.
  const ordered=MCP_SOURCES.map(item=>item.id).filter(id=>next.includes(id));
  await cfg.update('mcp.sync',JSON.stringify(ordered)===JSON.stringify(DEFAULT_MCP_SYNC)?undefined:ordered,target);
  return {enabled,applies:'next conversation'};
}

type RuleRef={scope:'user'|'project'|'local';list:'allow'|'deny'|'ask';rule:string};
const TARGET={user:'global',project:'shared',local:'local'} as const;
/**
 * Removes the listed permission rules through the settings service, then reads
 * each file back to confirm. Only rules the inventory reported can be removed.
 */
export async function cleanKicadPermissions(config:{activeProfile:string|null;updateSetting(key:string,value:any,target:'local'|'shared'|'global'):Promise<void>},rules:RuleRef[]){
  const cwd=folder(),known=(await kicadInventory()).permissions;
  const wanted=(Array.isArray(rules)?rules:[]).filter(ref=>known.some(issue=>issue.scope===ref.scope&&issue.list===ref.list&&issue.rule===ref.rule));
  const removed:RuleRef[]=[],skipped:(RuleRef&{reason:string})[]=[];
  for(const {scope,file} of settingsFiles(cwd)){
    const mine=wanted.filter(ref=>ref.scope===scope);if(!mine.length)continue;
    // With a profile active the "global" target is the profile file, not settings.json.
    if(scope==='user'&&config.activeProfile){skipped.push(...mine.map(ref=>({...ref,reason:'A settings profile is active.'})));continue;}
    const data=JSON.parse(await fs.readFile(file,'utf8')),permissions={...(data.permissions||{})};
    for(const list of ['allow','deny','ask'] as const){
      const drop=new Set(mine.filter(ref=>ref.list===list).map(ref=>ref.rule));
      if(!drop.size||!Array.isArray(permissions[list]))continue;
      const kept=permissions[list].filter((rule:string)=>!drop.has(rule));
      if(kept.length)permissions[list]=kept;else delete permissions[list];
    }
    await config.updateSetting('permissions',Object.keys(permissions).length?permissions:undefined,TARGET[scope]);
    const after=JSON.parse(await fs.readFile(file,'utf8')).permissions||{};
    for(const ref of mine)(Array.isArray(after[ref.list])&&after[ref.list].includes(ref.rule)?skipped.push({...ref,reason:'Still present after writing.'}):removed.push(ref));
  }
  return {removed,skipped,inventory:await kicadInventory()};
}

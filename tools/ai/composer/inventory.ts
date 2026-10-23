// Read-only inventory of agent configuration for the settings UI: skills, slash
// commands, sub-agents, hooks, plugins, MCP servers and permission rules. It reads
// files only: no MCP server is connected, no hook runs, and environment values or
// request headers of servers are never returned. Skill discovery reuses the
// capability catalog's roots and parser, so the list matches what the agent loads.
import * as fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as path from 'node:path';
import * as os from 'node:os';
import {defaultSkillRoots,frontmatter} from './demand.ts';
import {DEFAULT_MCP_SYNC,MCP_SOURCES,claudeMcpApproval,readMcpSources,syncedMcpServers} from './mcp-sync.ts';

export type Scope='user'|'project'|'local'|'plugin'|'builtin';
export type FlagKind='duplicate'|'conflict'|'stale'|'disabled'|'manual'|'oneoff'|'ignored'|'unusable';
export type Flag={kind:FlagKind;message:string};
export type Entry={name:string;description:string;scope:Scope;file?:string;root?:string;flags:Flag[]};
export type HookEntry={event:string;matcher:string;command:string;scope:Scope;file?:string;flags:Flag[]};
export type ServerEntry={name:string;scope:Scope;source?:string;transport:string;target:string;file?:string;tools?:string[];flags:Flag[]};
export type PermissionIssue={scope:'user'|'project'|'local';list:'allow'|'deny'|'ask';rule:string;kind:'stale'|'oneoff';message:string};
export type Builtins={tools:string[];agents:{name:string;description:string}[];hooks:{event:string;description:string}[]};
export type InventoryOptions={cwd:string;home?:string;disabledSkills?:string[];disabledServers?:string[];mcpSync?:readonly string[];skillsMode?:string;mcpMode?:string;builtins?:Builtins;skillRoots?:{path:string;scope:Scope}[]};

/** References to components this project removed; files that still use them no longer work. */
export const STALE_REFERENCES:[RegExp,string][]=[
  [/build\/bin\/kicad-agent|\bkicad-agent\s+(?:call|health|actions|manifest|serve)\b/,'Uses the removed Go kicad-agent CLI; the built-in kicad tools replace it.'],
  [/\bmcp__kicad__kicad_[a-z_]+/,'Names a retired KiCad MCP tool; the current entry points are capability_search and capability_call.'],
  [/\bkicad_load\b/,'Uses the retired kicad_load tool; capabilities now load through capability_search.'],
];
// Built-in tools replace these server names; configured entries with them are skipped.
const REPLACED_SERVERS=new Set(['kicad','easyeda']);
const SKILL_LIMIT=256*1024;

const exists=async(file:string)=>{try{await fs.access(file);return true;}catch{return false;}};
const json=async(file:string):Promise<any>=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return undefined;}};
const text=async(file:string,limit=SKILL_LIMIT)=>{try{const stat=await fs.stat(file);return stat.size>limit?'':await fs.readFile(file,'utf8');}catch{return '';}};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const stale=(content:string):Flag[]=>STALE_REFERENCES.filter(([pattern])=>pattern.test(content)).map(([,message])=>({kind:'stale',message}));
const scopeLabel=(scope:Scope)=>({user:'user',project:'project',local:'local project',plugin:'plugin',builtin:'built-in'})[scope];

/** Settings files in precedence order (later wins), as the CLI layers them. */
export function settingsFiles(cwd:string,home=os.homedir()):{scope:'user'|'project'|'local';file:string}[]{
  return [{scope:'user',file:path.join(home,'.claude','settings.json')},{scope:'project',file:path.join(cwd,'.claude','settings.json')},{scope:'local',file:path.join(cwd,'.claude','settings.local.json')}];
}

// Overridden copies are marked on the lower-precedence entry; identical copies are only duplicates.
function markOverrides<T extends {name:string;scope:Scope;flags:Flag[]}>(items:(T&{hash:string})[]){
  const byName=new Map<string,(T&{hash:string})[]>();
  for(const item of items)byName.set(item.name,[...(byName.get(item.name)||[]),item]);
  for(const group of byName.values()){
    const winner=group.at(-1)!;
    for(const item of group.slice(0,-1))item.flags.push(item.hash===winner.hash
      ?{kind:'duplicate',message:'Identical copy of the '+scopeLabel(winner.scope)+' version, which is the one used.'}
      :{kind:'conflict',message:'Overridden by a different '+scopeLabel(winner.scope)+' version with the same name.'});
  }
}

async function skills(options:InventoryOptions):Promise<Entry[]>{
  const roots=options.skillRoots||defaultSkillRoots(options.cwd);
  const found:(Entry&{hash:string})[]=[],seen=new Set<string>();
  const walk=async(root:string,scope:Scope,depth:number,top:string,ancestors=new Set<string>()):Promise<void>=>{
    let entries,real;
    try{real=await fs.realpath(root);if(ancestors.has(real))return;entries=(await fs.readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));}catch{return;}
    if(entries.some(e=>e.name==='SKILL.md')){
      const file=path.join(root,'SKILL.md'),key=await fs.realpath(file).catch(()=>file);
      if(seen.has(key))return;seen.add(key);
      const meta=await frontmatter(file).catch(()=>undefined);if(!meta)return;
      const content=await text(file),flags:Flag[]=stale(content);
      if(!meta.modelInvocable)flags.push({kind:'manual',message:'disable-model-invocation: the model never loads it; run it as /'+meta.name+'.'});
      if(options.disabledSkills?.includes(meta.name))flags.push({kind:'disabled',message:'Turned off in Kicad settings (kicadAgent.skills.disabled).'});
      found.push({name:meta.name,description:meta.description||'',scope,file,root:top,flags,hash:digest(content)});
      return;
    }
    if(depth<=0)return;
    const branch=new Set(ancestors);branch.add(real);
    for(const entry of entries)if(!['node_modules','.git','dist'].includes(entry.name)&&(entry.isDirectory()||entry.isSymbolicLink()))await walk(path.join(root,entry.name),scope,depth-1,top,branch);
  };
  for(const root of roots)await walk(root.path,root.scope,root.path.endsWith('plugins/cache')?6:3,root.path);
  markOverrides(found);
  return found.map(({hash,...entry})=>entry);
}

// Commands are Markdown files; nested folders give namespaced names (frontend/build.md → frontend:build).
async function commands(cwd:string,home:string):Promise<Entry[]>{
  const found:(Entry&{hash:string})[]=[];
  const walk=async(root:string,dir:string,scope:Scope,depth:number):Promise<void>=>{
    let entries;try{entries=(await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));}catch{return;}
    for(const entry of entries){
      const file=path.join(dir,entry.name);
      if(entry.isDirectory()&&depth>0)await walk(root,file,scope,depth-1);
      else if(entry.isFile()&&entry.name.endsWith('.md')){
        const content=await text(file,64*1024),name=path.relative(root,file).replace(/\.md$/,'').split(path.sep).join(':');
        const head=/^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1]||'';
        const described=/^description:\s*["']?(.+?)["']?\s*$/m.exec(head)?.[1];
        const firstLine=content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/,'').split('\n').map(line=>line.trim()).find(Boolean)||'';
        found.push({name,description:described||firstLine.slice(0,160),scope,file,flags:stale(content),hash:digest(content)});
      }
    }
  };
  const user=path.join(process.env.CLAUDE_CONFIG_DIR||path.join(home,'.claude'),'commands'),project=path.join(cwd,'.claude','commands');
  await walk(user,user,'user',3);await walk(project,project,'project',3);
  markOverrides(found);
  return found.map(({hash,...entry})=>entry);
}

async function agents(cwd:string,home:string,builtins:Builtins['agents']):Promise<Entry[]>{
  const found:Entry[]=builtins.map(agent=>({name:agent.name,description:agent.description,scope:'builtin' as Scope,flags:[]}));
  for(const [dir,scope] of [[path.join(home,'.claude','agents'),'user'],[path.join(cwd,'.claude','agents'),'project']] as [string,Scope][]){
    let entries:string[]=[];try{entries=(await fs.readdir(dir)).filter(name=>name.endsWith('.md')).sort();}catch{continue;}
    for(const name of entries){
      const file=path.join(dir,name),content=await text(file,64*1024),head=/^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1]||'';
      found.push({name:/^name:\s*["']?(.+?)["']?\s*$/m.exec(head)?.[1]||name.replace(/\.md$/,''),description:/^description:\s*["']?(.+?)["']?\s*$/m.exec(head)?.[1]||'',scope,file,flags:stale(content)});
    }
  }
  return found;
}

// A hook or server that starts a missing script cannot work.
async function missingProgram(command:string,cwd:string,home:string){
  const program=/^\s*(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(command);const value=program?.[1]||program?.[2]||program?.[3]||'';
  if(!/^(?:\/|\.{1,2}\/|~\/)/.test(value)||value.includes('$'))return false;
  return !await exists(path.resolve(cwd,value.replace(/^~(?=\/)/,home)));
}

async function hooks(cwd:string,home:string,builtins:Builtins['hooks']):Promise<HookEntry[]>{
  const found:HookEntry[]=builtins.map(hook=>({event:hook.event,matcher:'*',command:hook.description,scope:'builtin' as Scope,flags:[]}));
  for(const {scope,file} of settingsFiles(cwd,home)){
    const config=(await json(file))?.hooks;if(!config||typeof config!=='object')continue;
    for(const [event,groups] of Object.entries<any>(config))for(const group of Array.isArray(groups)?groups:[])for(const hook of Array.isArray(group?.hooks)?group.hooks:[]){
      const command=String(hook?.command??hook?.prompt??hook?.type??'');
      const flags:Flag[]=[...stale(command),...(await missingProgram(command,cwd,home)?[{kind:'stale' as const,message:'The program this hook starts does not exist.'}]:[])];
      found.push({event,matcher:String(group?.matcher||'*'),command,scope,file,flags});
    }
  }
  return found;
}

async function plugins(cwd:string,home:string){
  const enabled:Record<string,{value:boolean;scope:Scope;file:string}>={};
  for(const {scope,file} of settingsFiles(cwd,home)){const value=(await json(file))?.enabledPlugins;if(value&&typeof value==='object')for(const [id,on] of Object.entries(value))enabled[id]={value:on!==false,scope,file};}
  const root=path.join(home,'.claude','plugins'),installedFile=await json(path.join(root,'installed_plugins.json'));
  const installed=Object.entries<any>(installedFile?.plugins||{}).map(([id,versions])=>{const latest=Array.isArray(versions)?versions.at(-1):versions;return {id,version:String(latest?.version||''),path:String(latest?.installPath||''),enabled:enabled[id]?.value??false,scope:enabled[id]?.scope};});
  for(const [id,state] of Object.entries(enabled))if(!installed.some(item=>item.id===id))installed.push({id,version:'',path:'',enabled:state.value,scope:state.scope});
  const marketplaces:{name:string;location:string;updated:string;available:{name:string;description:string;category:string}[]}[]=[];
  for(const [name,entry] of Object.entries<any>(await json(path.join(root,'known_marketplaces.json'))||{})){
    const location=String(entry?.installLocation||path.join(root,'marketplaces',name)),manifest=await json(path.join(location,'.claude-plugin','marketplace.json'));
    const available=(Array.isArray(manifest?.plugins)?manifest.plugins:[]).map((plugin:any)=>({name:String(plugin?.name||''),description:String(plugin?.description||'').slice(0,300),category:String(plugin?.category||'')})).filter((plugin:{name:string})=>plugin.name);
    marketplaces.push({name,location,updated:String(entry?.lastUpdated||''),available});
  }
  return {installed,marketplaces};
}

function describeServer(config:any){
  const transport=String(config?.type||(config?.url?'http':'stdio'));
  // Commands and URLs only: env values and headers can hold credentials.
  const target=config?.url?String(config.url).replace(/([?&](?:key|token|api[_-]?key|secret)=)[^&]*/gi,'$1…'):[config?.command,...(Array.isArray(config?.args)?config.args:[])].filter(Boolean).join(' ');
  return {transport,target};
}

async function servers(options:InventoryOptions,home:string){
  const {cwd}=options,found:ServerEntry[]=[];
  if(options.builtins)found.push({name:'kicad',scope:'builtin',transport:'in-process',target:'Kicad extension (shared KiCad runtime)',tools:options.builtins.tools,flags:[]});
  const common=async(name:string,config:any,flags:Flag[])=>{
    if(options.disabledServers?.includes(name))flags.push({kind:'disabled',message:'Turned off in Kicad settings (kicadAgent.mcp.disabledServers).'});
    if(options.mcpMode==='off')flags.push({kind:'disabled',message:'External MCP servers are turned off (kicadAgent.mcp.mode).'});
    if(typeof config?.command==='string'&&await missingProgram(config.command,cwd,home))flags.push({kind:'stale',message:'The server command does not exist.'});
  };
  // Kicad's own configuration (mcpServers in the settings files) is passed to the runtime as is.
  const own:Record<string,unknown>={};
  for(const {scope,file} of settingsFiles(cwd,home))for(const [name,value] of Object.entries<any>((await json(file))?.mcpServers||{})){
    const flags:Flag[]=[];
    if(REPLACED_SERVERS.has(name))flags.push({kind:'ignored',message:'Replaced by the built-in kicad tools; this entry is not used.'});
    else own[name]=value;
    if(value?.disabled===true||value?.enabled===false)flags.push({kind:'disabled',message:'Disabled in its configuration file.'});
    await common(name,value,flags);
    found.push({name,scope,source:'Kicad settings',...describeServer(value),file,flags});
  }
  // Other tools' configuration files, read live through the same sync the agent uses.
  const enabled=options.mcpSync??DEFAULT_MCP_SYNC,reports=await readMcpSources({cwd,home,approval:await claudeMcpApproval(cwd,home)});
  const {origin,conflicts}=syncedMcpServers(reports,enabled,own);
  for(const report of reports)for(const server of report.servers){
    const flags:Flag[]=[],where=report.label+' ('+report.file.replace(/#project$/,'')+')';
    if(server.replaced)flags.push({kind:'ignored',message:'Replaced by the built-in kicad tools; this entry is not used.'});
    else if(!report.used)flags.push({kind:'ignored',message:'Repository file of '+report.label+'; it is never used automatically.'});
    else if(!enabled.includes(report.source))flags.push({kind:'disabled',message:'Sync from '+report.label+' is off.'});
    if(server.disabled)flags.push({kind:'disabled',message:'Disabled in its configuration file.'});
    if(server.pending)flags.push({kind:'manual',message:'Waiting for approval: project servers from .mcp.json run only after you approve them.'});
    if(server.issue)flags.push({kind:'unusable',message:server.issue});
    if(report.used&&enabled.includes(report.source)&&server.config&&!server.disabled&&!server.pending&&!server.replaced){
      if(Object.prototype.hasOwnProperty.call(own,server.name))flags.push({kind:'conflict',message:'Kicad settings define a server with this name; that one is used.'});
      else if(origin[server.name]!==where){const clash=conflicts.find(item=>item.name===server.name&&item.dropped===where);flags.push({kind:clash?'conflict':'duplicate',message:clash?'A different server with this name from '+clash.kept+' is used.':'Same server as the one from '+origin[server.name]+'.'});}
    }
    await common(server.name,server.config,flags);
    found.push({name:server.name,scope:report.scope==='plugin'?'plugin':report.scope==='project'?'project':report.file.endsWith('#project')?'local':'user',source:report.label,...describeServer(server.config||{}),file:report.file.replace(/#project$/,''),flags});
  }
  const sources=MCP_SOURCES.map(source=>({id:source.id,label:source.label,enabled:enabled.includes(source.id),
    files:reports.filter(report=>report.source===source.id).map(report=>({file:report.file.replace(/#project$/,''),scope:report.scope,used:report.used,servers:report.servers.length,error:report.error,...(report.file.endsWith('#project')?{section:'entries for this project'}:{})}))}));
  return {list:found,sources};
}

const ONE_OFF=160;
async function permissionIssues(options:InventoryOptions,home:string,configured:Set<string>):Promise<PermissionIssue[]>{
  const issues:PermissionIssue[]=[],tools=new Set(options.builtins?.tools||[]);
  for(const {scope,file} of settingsFiles(options.cwd,home)){
    const permissions=(await json(file))?.permissions;if(!permissions)continue;
    for(const list of ['allow','deny','ask'] as const)for(const rule of Array.isArray(permissions[list])?permissions[list]:[]){
      if(typeof rule!=='string')continue;
      const mcp=/^mcp__([^_]+(?:_[^_]+)*?)__([\w-]+)/.exec(rule);
      let message='';
      if(mcp&&mcp[1]==='kicad'&&tools.size&&!tools.has(mcp[2]))message='Tool '+mcp[2]+' no longer exists in the built-in kicad server.';
      else if(mcp&&mcp[1]==='easyeda'&&!configured.has('easyeda'))message='The EasyEDA connector was removed from this project.';
      else{
        const bash=/^Bash\((.+)\)$/s.exec(rule)?.[1];
        const program=bash?.split(/[\s:]/)[0]||'';
        if(program&&/^(?:\/|\.{1,2}\/|~\/)/.test(program)&&!await exists(path.resolve(options.cwd,program.replace(/^~(?=\/)/,home))))message='Allows a program that no longer exists: '+program;
      }
      if(!message)for(const [pattern,reason] of STALE_REFERENCES)if(pattern.test(rule)){message=reason;break;}
      if(message)issues.push({scope,list,rule,kind:'stale',message});
      else if(rule.length>ONE_OFF||/\n/.test(rule))issues.push({scope,list,rule,kind:'oneoff',message:'Approved for one exact long command; it rarely matches again.'});
    }
  }
  return issues;
}

/** Everything the settings pages show, read from disk in one pass. */
export async function settingsInventory(options:InventoryOptions){
  const home=options.home||os.homedir(),builtins=options.builtins||{tools:[],agents:[],hooks:[]};
  const [skillList,commandList,agentList,hookList,pluginState,serverState]=await Promise.all([
    skills(options),commands(options.cwd,home),agents(options.cwd,home,builtins.agents),hooks(options.cwd,home,builtins.hooks),plugins(options.cwd,home),servers(options,home)]);
  const serverList=serverState.list;
  // Entries Kicad ignores (replaced connectors) do not keep their permission rules alive.
  const configured=new Set(serverList.filter(server=>server.scope!=='builtin'&&!server.flags.some(flag=>flag.kind==='ignored')).map(server=>server.name));
  return {cwd:options.cwd,home,generatedAt:new Date().toISOString(),skillsMode:options.skillsMode||'onDemand',mcpMode:options.mcpMode||'onDemand',
    skills:skillList,commands:commandList,agents:agentList,hooks:hookList,plugins:pluginState,servers:serverList,mcpSources:serverState.sources,permissions:await permissionIssues(options,home,configured)};
}
export type SettingsInventory=Awaited<ReturnType<typeof settingsInventory>>;

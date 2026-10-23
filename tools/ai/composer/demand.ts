import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Guidance follows the host settings: a source that is off or loaded natively is
// not described as an on-demand catalog entry.
export function demandGuidance(features:{mcp?:string;skills?:string}={}){
  const skills=features.skills!=='native'&&features.skills!=='off',servers=features.mcp!=='direct'&&features.mcp!=='off';
  const kinds=['tool, the default',...(skills?['skill']:[]),...(servers?['server']:[])];
  return [
    `Tools${servers?', MCP servers':''}${skills?' and skills':''} load on demand, only when the current natural-language task needs them. Do not search or call tools for ordinary conversation or answers already supported by the available context. Do not perform discovery as a startup or per-turn ritual.`,
    `When a needed capability is unknown, capability_search takes a query and a kind (${kinds.join(', ')}); for example {"query":"drc","kind":"tool"}. Task words such as drc, stackup or 原理图 match the KiCad actions a tool runs, and results list them as matchedActions.`,
    ...(servers?['Only when an external MCP is needed and its name is unknown, use kind=server with query="" to list configured server names without connecting.']:[]),
    'Use capability_call with an exact returned id and arguments; reuse known built-in tool ids (tool:<name>) and previous results without searching again. Search results contain only matching schemas.',
    ...(skills?['Skill content loads only when called for a relevant task.']:[]),
    'Stop calling tools once the request is satisfied. No slash command or extra user turn is required.'
  ].join(' ');
}
export const DEMAND_GUIDANCE=demandGuidance();
export const demandDefinitions=[
  {name:'capability_search',description:'Find relevant built-in tools, skills or configured MCP servers (kind defaults to tool). Task words also match the KiCad actions a tool runs (matchedActions). Use kind=tool with server to connect only that server and search its tools. Use specific keywords, not a request to load everything.',inputSchema:{type:'object',properties:{query:{type:'string'},kind:{type:'string',enum:['tool','skill','server']},server:{type:'string'},offset:{type:'integer',minimum:0}},required:['query'],additionalProperties:false}},
  {name:'capability_call',description:'Call one capability returned by capability_search, using its exact id and schema. Built-in tool ids (tool:<name>) remain callable without a new search. For a skill, arguments is {}. Preserves the underlying tool permissions.',inputSchema:{type:'object',properties:{id:{type:'string'},arguments:{type:'object',additionalProperties:true}},required:['id','arguments'],additionalProperties:false}},
];
// actions: what a tool runs, matched by task words but never sent (e.g. kicad_board runs board.drc.run).
export type SearchAction={name:string;mutates?:boolean;inputs?:string[];keywords?:string[];text?:string};
export type Capability={name:string;description:string;inputSchema:any;execute:(args:any,context?:any)=>Promise<any>;actions?:SearchAction[];annotations?:{readOnlyHint?:boolean;openWorldHint?:boolean;destructiveHint?:boolean}};
// Read-only twin of capability_call for delegated reviewers: it runs only targets
// that cannot change state, so a sub-agent stays read-only in every permission mode.
export const inspectDefinition={name:'capability_inspect',description:'Run one read-only capability returned by capability_search (same id and arguments as capability_call). Refuses any tool or action that can change files, the design or external systems; read-only KiCad actions, read-only MCP tools and skill loads run.',inputSchema:{type:'object',properties:{id:{type:'string'},arguments:{type:'object',additionalProperties:true}},required:['id','arguments'],additionalProperties:false}};
export type Remote={list:()=>Promise<any[]>;call:(name:string,args:any,signal?:AbortSignal)=>Promise<any>;close:()=>Promise<void>;instructions?:string;onToolsChanged?:(listener:()=>void)=>()=>void};
// skills/mcp false: the host settings turned that source off; the catalog then
// refuses it with an actionable message instead of silently returning nothing.
export type DemandOptions={cwd:string;builtins:()=>Promise<Capability[]>;servers?:Record<string,any>;connect?:(name:string,config:any)=>Promise<Remote>;skillRoots?:string[];skillFiles?:string[];disabledSkills?:string[];maxResults?:number;skills?:boolean;mcp?:boolean;disabledServers?:string[];skillCacheMs?:number};
// Discovery results are context the model pays for on every search: cap untrusted
// server text and listing descriptions, keep full text available on load/call.
export const MAX_LISTING_DESCRIPTION=250,MAX_SERVER_TEXT=2048;
const clip=(value:unknown,limit:number)=>{const text=String(value??'').replace(/\s+/g,' ').trim();return text.length>limit?text.slice(0,limit-1)+'…':text;};
// Accept the argument shapes weaker models actually emit: object, JSON string,
// or no arguments. A bare tool name is normalized by DemandCatalog.key().
export function normalizeCapabilityCall(idInput:unknown,argsInput:unknown){
  const id=typeof idInput==='string'?idInput.trim():'';
  if(!id)throw Error('A capability id is required');
  let args=argsInput;
  if(typeof args==='string'){try{args=JSON.parse(args);}catch{throw Error('arguments must be a JSON object');}}
  if(args===undefined||args===null)args={};
  if(typeof args!=='object'||Array.isArray(args))throw Error('arguments must be an object');
  return {id,args:args as Record<string,unknown>};
}
const termsOf=(query:string)=>query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
function matches(query:string,text:string){
  const terms=termsOf(query);
  return !terms.length||terms.some(term=>text.toLocaleLowerCase().includes(term));
}
// Per term: a whole name segment or keyword (drc in board.drc.run, 叠层) outweighs a passing mention
// in a description (DRC in document.save_copy). Best action first; an exact action name wins.
function termScore(term:string,action:SearchAction){
  const name=action.name.toLocaleLowerCase(),keywords=action.keywords||[];
  if(name===term)return 10;
  if(name.split(/[._]/).includes(term)||keywords.includes(term))return 3;
  if(name.includes(term)||keywords.some(keyword=>keyword.includes(term)))return 2;
  return (action.text||'').includes(term)?1:0;
}
function actionHits(query:string,actions:SearchAction[]=[]){
  const terms=termsOf(query);if(!terms.length)return [];
  return actions.map((action,index)=>({action,index,score:terms.reduce((sum,term)=>sum+termScore(term,action),0)})).filter(hit=>hit.score).sort((a,b)=>b.score-a.score||a.index-b.index);
}
// Any term matches, so a shared word such as "kicad" hits everything; rank by name and term coverage.
function score(query:string,name:string,description:string){
  const terms=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean),lowerName=name.toLocaleLowerCase(),text=lowerName+' '+description.toLocaleLowerCase();
  const joined=terms.join('_');
  return (joined&&lowerName===joined?100:0)+terms.filter(term=>lowerName.includes(term)).length*10+terms.filter(term=>text.includes(term)).length;
}
// Long enums (kicad_call lists every action) are validated on call; send a hint instead of the full list.
function compactSchema(schema:any):any{
  if(Array.isArray(schema))return schema.map(compactSchema);
  if(!schema||typeof schema!=='object')return schema;
  const out:any={};
  for(const [key,value] of Object.entries(schema))out[key]=compactSchema(value);
  if(Array.isArray(schema.enum)&&schema.enum.length>40){delete out.enum;out.description=[schema.description,`One of ${schema.enum.length} values, e.g. ${schema.enum.slice(0,3).join(', ')}; discover exact values with kicad_actions (search/domain).`].filter(Boolean).join(' ');}
  return out;
}
// Metadata is read in bounded chunks. Never read every SKILL.md body during discovery.
/** Skill roots in load order: broad plugin catalogs first, user and project skills override them by name. */
export function defaultSkillRoots(cwd:string):{path:string;scope:'plugin'|'user'|'project'}[]{
  const home=os.homedir(),claude=process.env.CLAUDE_CONFIG_DIR||path.join(home,'.claude');
  return [
    {path:path.join(home,'.claude/plugins/cache'),scope:'plugin'},{path:path.join(home,'.codex/plugins/cache'),scope:'plugin'},
    {path:path.join(claude,'skills'),scope:'user'},{path:path.join(home,'.agents/skills'),scope:'user'},
    {path:path.join(process.env.CODEX_HOME||path.join(home,'.codex'),'skills'),scope:'user'},
    {path:path.join(process.env.XDG_CONFIG_HOME||path.join(home,'.config'),'opencode/skills'),scope:'user'},
    {path:path.join(home,'.local/share/kicad-terminal/skills'),scope:'user'},
    {path:path.join(cwd,'.claude/skills'),scope:'project'},{path:path.join(cwd,'.agents/skills'),scope:'project'},{path:path.join(cwd,'.opencode/skills'),scope:'project'},
  ];
}
export async function frontmatter(file:string){
  const handle=await fs.open(file,'r');try{const buffer=Buffer.alloc(8192);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);const head=buffer.subarray(0,bytesRead).toString();const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(head);if(!match)return;
    const name=/^name:\s*["']?(.+?)["']?\s*$/m.exec(match[1])?.[1];
    // Scalar or folded/literal block value of one top-level key.
    const field=(key:string)=>{const raw=new RegExp('^'+key+':[ \\t]*(.*)(?:\\r?\\n((?:[ \\t]+[^\\n]*\\n?)*))?','m').exec(match[1]);return raw?[raw[1].replace(/^[>|][-+]?$/,''),raw[2]||''].join(' ').trim().replace(/^["']|["']$/g,'').replace(/\s+/g,' '):'';};
    const disabled=/^disable-model-invocation:[ \t]*["']?(?:true|yes|on|1)["']?[ \t]*(?:#.*)?$/mi.test(match[1]);
    const whenToUse=field('when_to_use'),argumentHint=field('argument-hint'),allowedTools=field('allowed-tools');
    return {name:name||path.basename(path.dirname(file)),description:field('description')||'',modelInvocable:!disabled,...(whenToUse?{whenToUse}:{}),...(argumentHint?{argumentHint}:{}),...(allowedTools?{allowedTools}:{})};
  }finally{await handle.close();}
}
async function readSkill(file:string){const stat=await fs.stat(file);if(stat.size>256*1024)throw Error('Skill exceeds 256 KiB; narrow the skill content before loading');return fs.readFile(file,'utf8');}
export class DemandCatalog {
  private selected=new Map<string,{kind:string;name:string;execute:(args:any,context:any)=>Promise<any>;readOnly?:boolean;server?:string}>();
  private remotes=new Map<string,Promise<Remote>>();
  private subscriptions=new Map<string,()=>void>();
  private retiring=new Set<Promise<unknown>>();
  private revisions=new Map<string,number>();
  private closed=false;
  private closing?:Promise<void>;
  private builtins?:Promise<Capability[]>;
  private options:DemandOptions;
  constructor(options:DemandOptions){this.options=options;}
  private extraSkillRoots:string[]=[];
  // Walking every skill root (plugin caches are deep) on each search is the slow
  // path; metadata is reused briefly, bodies are always read fresh on load.
  private skillIndex?:{at:number;items:Promise<any[]>};
  // One tools/list per connection: later searches, with or without server=, reuse it.
  private remoteTools=new Map<string,Promise<any[]>>();
  setSkillRoots(roots:string[]){this.extraSkillRoots=roots.map(root=>path.resolve(this.options.cwd,root.replace(/^~(?=\/|$)/,os.homedir())));this.skillIndex=undefined;}
  setServers(servers:Record<string,any>){
    for(const [name,previous] of Object.entries(this.options.servers||{}))if(JSON.stringify(previous)!==JSON.stringify(servers[name])){
      this.invalidateRemote(name);const remote=this.remotes.get(name);this.remotes.delete(name);
      this.subscriptions.get(name)?.();this.subscriptions.delete(name);
      if(remote){const closing=remote.then(item=>item.close()).catch(()=>{});this.retiring.add(closing);void closing.finally(()=>this.retiring.delete(closing));}
    }
    this.options.servers=servers;
  }
  private assertOpen(){if(this.closed)throw Error('Capability catalog is closed; start a new session.');}
  private invalidateRemote(name:string){
    this.revisions.set(name,(this.revisions.get(name)||0)+1);this.remoteTools.delete(name);
    for(const [id,target] of this.selected)if(target.server===name)this.selected.delete(id);
  }
  setMaxResults(count:number){if(Number.isFinite(count))this.options.maxResults=Math.max(1,Math.min(10,Math.floor(count)));}
  // Built-in ids are stable. Accept the bare tool name as well, so weaker models
  // do not need to remember the `tool:` prefix.
  private key(id:string){return id.includes(':')?id:'tool:'+id;}
  target(id:string){const key=this.key(id),target=this.selected.get(key);if(target)return {kind:target.kind,name:target.name};if(key.startsWith('tool:')&&key.length>5)return {kind:'tool',name:key.slice(5)};throw Error('Search for this capability first: '+id);}
  private skills(){
    const ttl=this.options.skillCacheMs??30000;
    if(this.skillIndex&&Date.now()-this.skillIndex.at<ttl)return this.skillIndex.items;
    const items=this.scanSkills();this.skillIndex={at:Date.now(),items};
    items.catch(()=>{if(this.skillIndex?.items===items)this.skillIndex=undefined;});
    return items;
  }
  private async scanSkills(){
    // Broad plugin catalogs first; user and project skills override them by name.
    const roots=this.options.skillRoots||defaultSkillRoots(this.options.cwd).map(root=>root.path);
    const found=new Map<string,any>();
    const inspect=async(file:string)=>{try{const meta=await frontmatter(file);if(meta)found.set(meta.name,{...meta,file});}catch{}};
    const walk=async(root:string,depth:number,ancestors=new Set<string>())=>{let entries,real;try{real=await fs.realpath(root);if(ancestors.has(real))return;entries=(await fs.readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));}catch{return;}
      if(entries.some(e=>e.name==='SKILL.md')){await inspect(path.join(root,'SKILL.md'));return;}
      if(depth<=0)return;
      const branch=new Set(ancestors);branch.add(real);
      for(const entry of entries)if(!['node_modules','.git','dist'].includes(entry.name)&&(entry.isDirectory()||entry.isSymbolicLink()))await walk(path.join(root,entry.name),depth-1,branch);
    };
    for(const root of [...roots,...this.extraSkillRoots])await walk(root,root.endsWith('plugins/cache')?6:3);
    for(const file of this.options.skillFiles||[])await inspect(file);
    return [...found.values()].filter(item=>item.modelInvocable&&!this.options.disabledSkills?.includes(item.name));
  }
  async search(input:{query?:string;kind?:string;server?:string;offset?:number}){
    this.assertOpen();
    // A missing kind means tools: models most often omit it when looking for a tool.
    const kind=String(input.kind??'tool').toLowerCase();
    const query=typeof input.query==='string'?input.query:(input.query==null?'':String(input.query));
    const args={...input,query,kind};
    if(!['tool','skill','server'].includes(kind))throw Error('kind must be tool, skill or server');
    const offset=Number(input.offset??0);if(!Number.isInteger(offset)||offset<0)throw Error('Invalid offset');
    const maxResults=Math.max(1,Math.min(10,this.options.maxResults??5));
    const select=args.query.trim().toLowerCase().startsWith('select:')
      ? args.query.slice(7).split(',').map(name=>name.trim().toLowerCase()).filter(Boolean)
      : undefined;
    let items:any[]=[],instructions:string|undefined;
    if((args.kind==='server'||args.server)&&this.options.mcp===false)throw Error('External MCP servers are turned off in the Kicad settings (kicadAgent.mcp.mode).');
    if(args.kind==='skill'&&this.options.skills===false)throw Error('Skill loading through the catalog is turned off in the Kicad settings (kicadAgent.skills.mode).');
    if(args.kind==='server')items=Object.keys(this.enabledServers()).map(name=>({id:name,name,description:'Configured MCP server; connect only by searching tools with server='+name+(this.remoteTools.has(name)?' (connected)':'')}));
    else if(args.kind==='skill')items=(await this.skills()).map(item=>({...item,id:'skill:'+item.name}));
    else if(args.server){
      const remote=await this.connectServer(args.server);
      instructions=remote.instructions;
      items=await this.remoteItems(args.server,remote);
    }else{
      this.builtins??=this.options.builtins();items=(await this.builtins).map(item=>({...item,id:'tool:'+item.name}));
      // Servers connected earlier in this session are searched too, without a new connection.
      for(const [name,remote] of this.remotes){try{items.push(...await this.remoteItems(name,await remote));}catch{}}
    }
    // Another server may have changed while a later server's list was awaited.
    items=items.filter(item=>!item.server||item.serverRevision===(this.revisions.get(item.server)||0)&&!!this.enabledServers()[item.server]);
    const ranked=items.map((item,index)=>{const hits=actionHits(args.query,item.actions),direct=matches(args.query,item.name+' '+item.description+' '+(item.whenToUse||''));
      return {item,index,hits,match:direct||hits.length>0,rank:(direct?score(args.query,item.name,item.description||''):0)+(hits[0]?.score??0)*2};});
    let filtered;
    if(select){
      // ToolSearch-style exact selection: select:Read,Edit avoids a keyword round-trip.
      const order=new Map(select.map((name,index)=>[name,index]));
      filtered=ranked.filter(entry=>order.has(String(entry.item.name).toLowerCase()))
        .sort((a,b)=>(order.get(String(a.item.name).toLowerCase())??0)-(order.get(String(b.item.name).toLowerCase())??0));
    }else{
      filtered=ranked.filter(entry=>entry.match).sort((a,b)=>b.rank-a.rank||a.index-b.index);
    }
    const page=filtered.slice(offset,offset+maxResults);
    this.assertOpen();
    return {total:filtered.length,offset,nextOffset:offset+page.length<filtered.length?offset+page.length:null,...(instructions?{instructions:clip(instructions,MAX_SERVER_TEXT)}:{}),results:page.map(({item,hits})=>{
      if(args.kind==='server')return item;
      const remote=String(item.id).startsWith('mcp:');
      this.selected.set(item.id,{kind:args.kind==='skill'?'skill':remote?'mcp':'tool',name:remote?item.qualifiedName:item.name,execute:args.kind==='skill'?(input:any)=>this.loadSkill(item,input):item.execute,readOnly:args.kind==='skill'||(remote&&item.annotations?.readOnlyHint===true),...(remote?{server:item.server}:{})});
      const skill=args.kind==='skill';
      return {id:item.id,name:item.name,description:clip(item.description,skill?MAX_LISTING_DESCRIPTION:MAX_SERVER_TEXT),
        ...(skill&&item.whenToUse?{whenToUse:clip(item.whenToUse,MAX_LISTING_DESCRIPTION)}:{}),...(skill&&item.argumentHint?{argumentHint:clip(item.argumentHint,120)}:{}),
        ...(remote&&item.annotations?{readOnly:item.annotations.readOnlyHint===true,...(item.annotations.destructiveHint?{destructive:true}:{})}:{}),
        ...(hits.length?{matchedActions:hits.slice(0,5).map(({action})=>({name:action.name,...(action.mutates!==undefined?{mutates:action.mutates}:{}),...(action.inputs?.length?{inputs:action.inputs}:{})}))}:{}),...(item.inputSchema?{inputSchema:compactSchema(item.inputSchema)}:{})};
    })};
  }
  private enabledServers(){
    const disabled=new Set(this.options.disabledServers||[]);
    return Object.fromEntries(Object.entries(this.options.servers||{}).filter(([name,v])=>v&&v.enabled!==false&&!v.disabled&&!disabled.has(name)));
  }
  private connectServer(name:string){
    this.assertOpen();
    if(this.options.mcp===false)throw Error('External MCP servers are turned off in the Kicad settings (kicadAgent.mcp.mode).');
    const config=this.enabledServers()[name];if(!config)throw Error('Unknown or disabled MCP server');
    let remote=this.remotes.get(name);
    if(!remote){
      const connecting=this.options.connect?.(name,config);if(!connecting)throw Error('MCP transport unavailable');
      remote=connecting.then(async item=>{
        if(this.closed||this.remotes.get(name)!==remote){await item.close();throw Error('MCP configuration changed while connecting; search again.');}
        const off=item.onToolsChanged?.(()=>this.invalidateRemote(name));if(off)this.subscriptions.set(name,off);
        return item;
      });
      this.remotes.set(name,remote);remote.catch(()=>{if(this.remotes.get(name)===remote){this.remotes.delete(name);this.invalidateRemote(name);}});
    }
    return remote;
  }
  private async remoteItems(server:string,connected:Remote){
    const revision=this.revisions.get(server)||0;
    let tools=this.remoteTools.get(server);
    if(!tools){tools=connected.list();this.remoteTools.set(server,tools);tools.catch(()=>{if(this.remoteTools.get(server)===tools)this.remoteTools.delete(server);});}
    const listed=await tools;
    this.assertOpen();if(revision!==(this.revisions.get(server)||0))throw Error('MCP tools changed during discovery; search again.');
    return listed.map(item=>({...item,server,serverRevision:revision,id:'mcp:'+server+':'+item.name,qualifiedName:'mcp__'+server+'__'+item.name,execute:(input:any,ctx:any)=>connected.call(item.name,input,ctx?.signal||ctx?.abort)}));
  }
  // The body is read at load time (edits apply immediately). $ARGUMENTS is
  // substituted; arguments without a placeholder are appended for the model.
  private async loadSkill(item:any,input:any){
    const meta=await frontmatter(item.file);
    if(!meta?.modelInvocable)throw Error('Skill no longer permits model invocation');
    const value=typeof input?.arguments==='string'?input.arguments:typeof input?.args==='string'?input.args:'';
    let content=await readSkill(item.file);
    if(value)content=content.includes('$ARGUMENTS')?content.split('$ARGUMENTS').join(value):content+'\n\nARGUMENTS: '+value;
    return {name:item.name,baseDirectory:path.dirname(item.file),content,...(meta.allowedTools?{allowedTools:meta.allowedTools}:{}),...(meta.argumentHint?{argumentHint:meta.argumentHint}:{})};
  }
  async call(id:string,args:any,context:any={}){
    this.assertOpen();
    const parsed=normalizeCapabilityCall(id,args);
    const key=this.key(parsed.id);
    if(!this.selected.has(key)){
      if(key.startsWith('tool:')){
        this.builtins??=this.options.builtins();
        const item=(await this.builtins).find(tool=>'tool:'+tool.name===key);
        if(!item)throw Error('Unknown capability id '+parsed.id+'; search for it with capability_search');
        this.selected.set(key,{kind:'tool',name:item.name,execute:item.execute});
      }else{
        this.target(parsed.id);
      }
    }
    this.assertOpen();
    const target=this.selected.get(key)!;
    if(target.server&&(this.options.mcp===false||!this.enabledServers()[target.server]))throw Error('MCP server is disabled; search again after enabling it in settings.');
    return target.execute(parsed.args,context);
  }
  /**
   * True only when the target cannot change state: a skill load, a built-in tool
   * marked read-only and local, a typed action whose catalog entry has
   * mutates:false, or an MCP tool its server marks readOnlyHint. Unknown is false.
   */
  async isReadOnly(id:string,args:any={}){
    let key:string;try{key=this.key(normalizeCapabilityCall(id,args).id);}catch{return false;}
    if(key.startsWith('skill:'))return this.selected.has(key);
    if(key.startsWith('mcp:'))return this.selected.get(key)?.readOnly===true;
    if(!key.startsWith('tool:'))return false;
    this.builtins??=this.options.builtins();
    const item=(await this.builtins).find(tool=>'tool:'+tool.name===key);
    if(!item||item.annotations?.openWorldHint)return false;
    if(item.annotations?.readOnlyHint===true)return true;
    const action=args&&typeof args==='object'?(args as any).action:undefined;
    return typeof action==='string'&&!!item.actions?.some(entry=>entry.name===action&&entry.mutates===false);
  }
  async inspect(id:string,args:any,context:any={}){
    const parsed=normalizeCapabilityCall(id,args);
    if(!(await this.isReadOnly(parsed.id,parsed.args)))throw Error('capability_inspect runs only read-only capabilities; '+parsed.id+(typeof parsed.args.action==='string'?' '+parsed.args.action:'')+' can change state. Report it to the main agent instead of running it.');
    return this.call(parsed.id,parsed.args,context);
  }
  close(){
    if(this.closing)return this.closing;
    this.closed=true;for(const off of this.subscriptions.values())off();this.subscriptions.clear();
    this.closing=Promise.allSettled([...this.retiring,...[...this.remotes.values()].map(async item=>(await item).close())]).then(()=>{this.remotes.clear();this.remoteTools.clear();this.selected.clear();});
    return this.closing;
  }
}
// SDK constructors are injected so both frontends bundle their pinned MCP dependency.
export function mcpConnector(sdk:any,cwd:string){return async(_name:string,config:any):Promise<Remote>=>{
  const client=new sdk.Client({name:'kicad-demand',version:'1.0.0'},{capabilities:{}});
  let transport:any;
  if(config.command){const command=Array.isArray(config.command)?config.command[0]:config.command;const args=Array.isArray(config.command)?config.command.slice(1):config.args||[];transport=new sdk.StdioClientTransport({command,args,cwd:config.cwd||cwd,env:{...process.env,...config.env,...config.environment},stderr:'ignore'});}
  else if(config.url){const options={requestInit:{headers:config.headers||{}}};transport=config.type==='sse'?new sdk.SSEClientTransport(new URL(config.url),options):new sdk.StreamableHTTPClientTransport(new URL(config.url),options);}
  else throw Error('Unsupported MCP server configuration');
  try{await client.connect(transport,{timeout:config.timeout||30000});}catch(error){await client.close().catch(()=>{});throw Error('MCP connection failed; check server configuration and authentication');}
  // Server-provided usage instructions are part of the discovery result, so a
  // model can use an external MCP server correctly without a separate call.
  const instructions=typeof client.getInstructions==='function'?client.getInstructions():undefined;
  const listeners=new Set<()=>void>();
  if(sdk.ToolListChangedNotificationSchema)client.setNotificationHandler(sdk.ToolListChangedNotificationSchema,async()=>{for(const listener of listeners)listener();});
  return {async list(){const tools:any[]=[];let cursor:string|undefined;const cursors=new Set<string>();do{const page=await client.listTools(cursor?{cursor}:{});tools.push(...page.tools);cursor=page.nextCursor;if(cursor&&cursors.has(cursor))throw Error('MCP repeated pagination cursor');if(cursor)cursors.add(cursor);}while(cursor);return tools;},call:(name,args,signal)=>client.callTool({name,arguments:args},undefined,{signal,timeout:config.timeout||60000}),onToolsChanged(listener){listeners.add(listener);return ()=>{listeners.delete(listener);};},close:()=>client.close(),...(instructions?{instructions}:{})};
};}

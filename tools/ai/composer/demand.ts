import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export const DEMAND_GUIDANCE='Tools, MCP servers and skills load on demand. capability_search takes a query and a kind (tool, the default, skill or server); for example {"query":"drc","kind":"tool"}. Task words such as drc, stackup or 原理图 match the KiCad actions a tool runs, and results list them as matchedActions. Use kind=server with query="" to list configured server names without connecting. Then use capability_call with an exact returned id and arguments; built-in tool ids (tool:<name>) stay callable in later turns without searching again. Search results contain only matching schemas. Skill content loads only when called. Do not load unrelated capabilities. No slash command or extra user turn is required.';
export const demandDefinitions=[
  {name:'capability_search',description:'Find relevant built-in tools, skills or configured MCP servers (kind defaults to tool). Task words also match the KiCad actions a tool runs (matchedActions). Use kind=tool with server to connect only that server and search its tools. Use specific keywords, not a request to load everything.',inputSchema:{type:'object',properties:{query:{type:'string'},kind:{type:'string',enum:['tool','skill','server']},server:{type:'string'},offset:{type:'integer',minimum:0}},required:['query'],additionalProperties:false}},
  {name:'capability_call',description:'Call one capability returned by capability_search, using its exact id and schema. Built-in tool ids (tool:<name>) remain callable without a new search. For a skill, arguments is {}. Preserves the underlying tool permissions.',inputSchema:{type:'object',properties:{id:{type:'string'},arguments:{type:'object',additionalProperties:true}},required:['id','arguments'],additionalProperties:false}},
];
// actions: what a tool runs, matched by task words but never sent (e.g. kicad_board runs board.drc.run).
export type SearchAction={name:string;mutates?:boolean;inputs?:string[];keywords?:string[];text?:string};
export type Capability={name:string;description:string;inputSchema:any;execute:(args:any,context?:any)=>Promise<any>;actions?:SearchAction[]};
export type Remote={list:()=>Promise<any[]>;call:(name:string,args:any,signal?:AbortSignal)=>Promise<any>;close:()=>Promise<void>};
export type DemandOptions={cwd:string;builtins:()=>Promise<Capability[]>;servers?:Record<string,any>;connect?:(name:string,config:any)=>Promise<Remote>;skillRoots?:string[];skillFiles?:string[];disabledSkills?:string[]};
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
async function frontmatter(file:string){
  const handle=await fs.open(file,'r');try{const buffer=Buffer.alloc(8192);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);const head=buffer.subarray(0,bytesRead).toString();const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(head);if(!match)return;
    const name=/^name:\s*["']?(.+?)["']?\s*$/m.exec(match[1])?.[1];
    const raw=/^description:[ \t]*(.*)(?:\r?\n((?:[ \t]+[^\n]*\n?)*))?/m.exec(match[1]);
    const description=raw?([raw[1].replace(/^[>|][-+]?$/,''),raw[2]||''].join(' ').trim().replace(/^["']|["']$/g,'').replace(/\s+/g,' ')):'';
    const disabled=/^disable-model-invocation:[ \t]*["']?(?:true|yes|on|1)["']?[ \t]*(?:#.*)?$/mi.test(match[1]);
    return {name:name||path.basename(path.dirname(file)),description:description||'',modelInvocable:!disabled};
  }finally{await handle.close();}
}
async function readSkill(file:string){const stat=await fs.stat(file);if(stat.size>256*1024)throw Error('Skill exceeds 256 KiB; narrow the skill content before loading');return fs.readFile(file,'utf8');}
export class DemandCatalog {
  private selected=new Map<string,{kind:string;name:string;execute:(args:any,context:any)=>Promise<any>}>();
  private remotes=new Map<string,Promise<Remote>>();
  private builtins?:Promise<Capability[]>;
  constructor(private options:DemandOptions){}
  private extraSkillRoots:string[]=[];
  setSkillRoots(roots:string[]){this.extraSkillRoots=roots.map(root=>path.resolve(this.options.cwd,root.replace(/^~(?=\/|$)/,os.homedir())));}
  setServers(servers:Record<string,any>){this.options.servers=servers;}
  // Built-in ids are stable, so a later turn may call tool:<name> without repeating the search.
  target(id:string){const target=this.selected.get(id);if(target)return {kind:target.kind,name:target.name};if(id.startsWith('tool:')&&id.length>5)return {kind:'tool',name:id.slice(5)};throw Error('Search for this capability first: '+id);}
  private async skills(){
    const roots=this.options.skillRoots||[path.join(process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'skills'),path.join(os.homedir(),'.agents/skills'),path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'skills'),path.join(process.env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config'),'opencode/skills'),path.join(os.homedir(),'.local/share/kicad-terminal/skills'),path.join(os.homedir(),'.claude/plugins/cache'),path.join(os.homedir(),'.codex/plugins/cache'),path.join(this.options.cwd,'.claude/skills'),path.join(this.options.cwd,'.agents/skills'),path.join(this.options.cwd,'.opencode/skills')];
    const found=new Map<string,any>();
    const inspect=async(file:string)=>{try{const meta=await frontmatter(file);if(meta)found.set(meta.name,{...meta,file});}catch{}};
    const walk=async(root:string,depth:number)=>{let entries;try{entries=await fs.readdir(root,{withFileTypes:true});}catch{return;}
      if(entries.some(e=>e.name==='SKILL.md')){await inspect(path.join(root,'SKILL.md'));return;}
      if(depth<=0)return;
      for(const entry of entries)if(!['node_modules','.git','dist'].includes(entry.name)&&(entry.isDirectory()||entry.isSymbolicLink()))await walk(path.join(root,entry.name),depth-1);
    };
    for(const root of [...roots,...this.extraSkillRoots])await walk(root,root.endsWith('plugins/cache')?6:3);
    for(const file of this.options.skillFiles||[])await inspect(file);
    return [...found.values()].filter(item=>item.modelInvocable&&!this.options.disabledSkills?.includes(item.name));
  }
  async search(input:{query?:string;kind?:string;server?:string;offset?:number}){
    // A missing kind means tools: models most often omit it when looking for a tool.
    const args={...input,query:input.query??'',kind:input.kind??'tool'};
    if(typeof args.query!=='string')throw Error('Expected query: a string of keywords, or "" to list');
    if(!['tool','skill','server'].includes(args.kind))throw Error('kind must be tool, skill or server');
    const offset=args.offset??0;if(!Number.isInteger(offset)||offset<0)throw Error('Invalid offset');
    let items:any[]=[];
    if(args.kind==='server')items=Object.entries(this.options.servers||{}).filter(([,v])=>v.enabled!==false&&!v.disabled).map(([name])=>({id:name,name,description:'Configured MCP server; connect only by searching tools with server='+name}));
    else if(args.kind==='skill')items=(await this.skills()).map(item=>({...item,id:'skill:'+item.name}));
    else if(args.server){
      const config=this.options.servers?.[args.server];if(!config||config.enabled===false||config.disabled)throw Error('Unknown or disabled MCP server');
      let remote=this.remotes.get(args.server);if(!remote){remote=this.options.connect?.(args.server,config);if(!remote)throw Error('MCP transport unavailable');this.remotes.set(args.server,remote);remote.catch(()=>this.remotes.delete(args.server!));}
      const connected=await remote;
      items=(await connected.list()).map(item=>({...item,id:'mcp:'+args.server+':'+item.name,execute:(input:any,ctx:any)=>connected.call(item.name,input,ctx?.signal||ctx?.abort)}));
    }else{
      this.builtins??=this.options.builtins();items=(await this.builtins).map(item=>({...item,id:'tool:'+item.name}));
    }
    const ranked=items.map((item,index)=>{const hits=actionHits(args.query,item.actions),direct=matches(args.query,item.name+' '+item.description);
      return {item,index,hits,match:direct||hits.length>0,rank:(direct?score(args.query,item.name,item.description||''):0)+(hits[0]?.score??0)*2};});
    const filtered=ranked.filter(entry=>entry.match).sort((a,b)=>b.rank-a.rank||a.index-b.index),page=filtered.slice(offset,offset+5);
    return {total:filtered.length,offset,nextOffset:offset+page.length<filtered.length?offset+page.length:null,results:page.map(({item,hits})=>{
      if(args.kind==='server')return item;
      this.selected.set(item.id,{kind:args.kind==='skill'?'skill':args.server?'mcp':'tool',name:args.server?'mcp__'+args.server+'__'+item.name:item.name,execute:args.kind==='skill'?async()=>{if(!(await frontmatter(item.file))?.modelInvocable)throw Error('Skill no longer permits model invocation');return {name:item.name,baseDirectory:path.dirname(item.file),content:await readSkill(item.file)};}:item.execute});
      return {id:item.id,name:item.name,description:item.description,...(hits.length?{matchedActions:hits.slice(0,5).map(({action})=>({name:action.name,...(action.mutates!==undefined?{mutates:action.mutates}:{}),...(action.inputs?.length?{inputs:action.inputs}:{})}))}:{}),...(item.inputSchema?{inputSchema:compactSchema(item.inputSchema)}:{})};
    })};
  }
  async call(id:string,args:any,context:any={}){
    this.target(id);if(!args||typeof args!=='object'||Array.isArray(args))throw Error('arguments must be an object');
    if(!this.selected.has(id)){
      this.builtins??=this.options.builtins();const item=(await this.builtins).find(tool=>'tool:'+tool.name===id);
      if(!item)throw Error('Unknown capability id '+id+'; search for it with capability_search');
      this.selected.set(id,{kind:'tool',name:item.name,execute:item.execute});
    }
    return this.selected.get(id)!.execute(args,context);
  }
  async close(){await Promise.allSettled([...this.remotes.values()].map(async item=>(await item).close()));this.remotes.clear();for(const [id,target] of this.selected)if(target.kind==='mcp')this.selected.delete(id);}
}
// SDK constructors are injected so both frontends bundle their pinned MCP dependency.
export function mcpConnector(sdk:any,cwd:string){return async(_name:string,config:any):Promise<Remote>=>{
  const client=new sdk.Client({name:'kicad-demand',version:'1.0.0'},{capabilities:{}});
  let transport:any;
  if(config.command){const command=Array.isArray(config.command)?config.command[0]:config.command;const args=Array.isArray(config.command)?config.command.slice(1):config.args||[];transport=new sdk.StdioClientTransport({command,args,cwd:config.cwd||cwd,env:{...process.env,...config.env,...config.environment},stderr:'ignore'});}
  else if(config.url){const options={requestInit:{headers:config.headers||{}}};transport=config.type==='sse'?new sdk.SSEClientTransport(new URL(config.url),options):new sdk.StreamableHTTPClientTransport(new URL(config.url),options);}
  else throw Error('Unsupported MCP server configuration');
  try{await client.connect(transport,{timeout:config.timeout||30000});}catch(error){await client.close().catch(()=>{});throw Error('MCP connection failed; check server configuration and authentication');}
  return {async list(){const tools:any[]=[];let cursor:string|undefined;const cursors=new Set<string>();do{const page=await client.listTools(cursor?{cursor}:{});tools.push(...page.tools);cursor=page.nextCursor;if(cursor&&cursors.has(cursor))throw Error('MCP repeated pagination cursor');if(cursor)cursors.add(cursor);}while(cursor);return tools;},call:(name,args,signal)=>client.callTool({name,arguments:args},undefined,{signal,timeout:config.timeout||60000}),close:()=>client.close()};
};}

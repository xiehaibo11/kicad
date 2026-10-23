// MCP servers configured in other tools on this machine (Claude Code, Claude Desktop,
// Cursor, VS Code, Windsurf, Codex, OpenCode), read live from their own files and
// normalized to one shape, so a server added in any of them is available in Kicad
// without copying. Nothing is written and nothing connects here. Repository-level
// files of other tools are listed but never used: a cloned project could ship them.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export type McpSourceId='claude-code'|'claude-desktop'|'cursor'|'vscode'|'windsurf'|'codex'|'opencode';
export type McpConfig={type?:'stdio'|'http'|'sse';command?:string;args?:string[];env?:Record<string,string>;cwd?:string;url?:string;headers?:Record<string,string>;timeout?:number};
export type SyncedServer={name:string;config?:McpConfig;issue?:string;disabled?:boolean;pending?:boolean;replaced?:boolean};
export type SourceFile={source:McpSourceId;label:string;scope:'user'|'project';file:string;exists:boolean;used:boolean;servers:SyncedServer[];error?:string};

/** Precedence order: earlier sources win a name clash. */
export const MCP_SOURCES:{id:McpSourceId;label:string}[]=[
  {id:'claude-code',label:'Claude Code'},{id:'claude-desktop',label:'Claude Desktop'},{id:'cursor',label:'Cursor'},
  {id:'vscode',label:'VS Code'},{id:'windsurf',label:'Windsurf'},{id:'codex',label:'Codex'},{id:'opencode',label:'OpenCode'},
];
const label=(id:McpSourceId)=>MCP_SOURCES.find(source=>source.id===id)!.label;
// Built-in tools replace these; entries with these names are never synced.
const REPLACED=new Set(['kicad','easyeda']);

/** JSON with comments and trailing commas (VS Code, OpenCode). */
export function parseJsonc(text:string){
  let out='',i=0;
  while(i<text.length){
    const c=text[i],n=text[i+1];
    if(c==='"'){let j=i+1;while(j<text.length&&text[j]!=='"'){if(text[j]==='\\')j++;j++;}out+=text.slice(i,j+1);i=j+1;}
    else if(c==='/'&&n==='/'){while(i<text.length&&text[i]!=='\n')i++;}
    else if(c==='/'&&n==='*'){i+=2;while(i<text.length&&!(text[i]==='*'&&text[i+1]==='/'))i++;i+=2;}
    else{out+=c;i++;}
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g,'$1'));
}

/** The TOML subset Codex uses for mcp_servers: tables, strings, arrays, inline tables, numbers and booleans. */
export function parseToml(text:string):any{
  const root:any={};let table=root,i=0;
  const space=()=>{while(i<text.length){if(/[ \t\r\n]/.test(text[i]))i++;else if(text[i]==='#'){while(i<text.length&&text[i]!=='\n')i++;}else break;}};
  const inline=()=>{while(i<text.length&&/[ \t]/.test(text[i]))i++;};
  const key=():string=>{
    if(text[i]==='"'||text[i]==="'")return string();
    const start=i;while(i<text.length&&/[A-Za-z0-9_-]/.test(text[i]))i++;
    if(start===i)throw Error('TOML key expected at '+i);return text.slice(start,i);
  };
  const dotted=()=>{const parts=[key()];inline();while(text[i]==='.'){i++;inline();parts.push(key());inline();}return parts;};
  const string=():string=>{
    const quote=text[i];
    if(text.startsWith(quote.repeat(3),i)){i+=3;if(text[i]==='\n')i++;const end=text.indexOf(quote.repeat(3),i);if(end<0)throw Error('Unterminated TOML string');const raw=text.slice(i,end);i=end+3;return quote==='"'?unescape(raw):raw;}
    i++;let raw='';
    while(i<text.length&&text[i]!==quote){if(quote==='"'&&text[i]==='\\'){raw+=text[i]+text[i+1];i+=2;}else raw+=text[i++];}
    if(text[i]!==quote)throw Error('Unterminated TOML string');i++;
    return quote==='"'?unescape(raw):raw;
  };
  const unescape=(raw:string)=>raw.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g,(_,e:string)=>e[0]==='u'||e[0]==='U'?String.fromCodePoint(parseInt(e.slice(1),16)):({n:'\n',t:'\t',r:'\r','"':'"','\\':'\\',b:'\b',f:'\f'} as Record<string,string>)[e]??e);
  const value=():any=>{
    const c=text[i];
    if(c==='"'||c==="'")return string();
    if(c==='['){i++;const list=[];space();while(text[i]!==']'){list.push(value());space();if(text[i]===','){i++;space();}}i++;return list;}
    if(c==='{'){i++;const object:any={};inline();while(text[i]!=='}'){const parts=dotted();inline();if(text[i]!=='=')throw Error('TOML = expected');i++;inline();set(object,parts,value());inline();if(text[i]===','){i++;inline();}}i++;return object;}
    const start=i;while(i<text.length&&!/[,\]}\n\r#]/.test(text[i]))i++;
    const raw=text.slice(start,i).trim();
    if(raw==='true')return true;if(raw==='false')return false;
    const number=Number(raw.replace(/_/g,''));if(raw&&!Number.isNaN(number))return number;
    return raw;
  };
  const set=(target:any,parts:string[],item:any)=>{let node=target;for(const part of parts.slice(0,-1))node=node[part]??={};node[parts.at(-1)!]=item;};
  while(true){
    space();if(i>=text.length)break;
    if(text[i]==='['){
      const array=text[i+1]==='[';i+=array?2:1;inline();const parts=dotted();i+=array?2:1;
      let node=root;for(const part of parts.slice(0,-1))node=node[part]??={};
      const last=parts.at(-1)!;
      if(array){(node[last]??=[]).push(table={});}else table=node[last]??={};
      continue;
    }
    const parts=dotted();inline();if(text[i]!=='=')throw Error('TOML = expected at '+i);i++;inline();set(table,parts,value());
  }
  return root;
}

const read=async(file:string)=>{try{return await fs.readFile(file,'utf8');}catch{return undefined;}};
const strings=(value:unknown)=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):undefined;
const record=(value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).filter(([,v])=>typeof v==='string'||typeof v==='number'||typeof v==='boolean').map(([k,v])=>[k,String(v)])):undefined;
// ${env:NAME} (VS Code, Cursor) and ${NAME} resolve from this process; ${input:...} needs the other tool's prompt.
function substitute(config:McpConfig,env:NodeJS.ProcessEnv):{config?:McpConfig;issue?:string}{
  const text=JSON.stringify(config);
  if(/\$\{input:/.test(text))return {issue:'Uses ${input:…} values that only the original tool can prompt for.'};
  const missing=new Set<string>();
  const resolved=JSON.parse(text.replace(/\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g,(match,name)=>{if(env[name]===undefined){missing.add(name);return match;}return JSON.stringify(env[name]).slice(1,-1);}));
  return missing.size?{issue:'Needs environment variables that are not set here: '+[...missing].join(', ')}:{config:resolved};
}

// Each tool's entry shape → one McpConfig the shared connector accepts.
function normalize(source:McpSourceId,raw:any,env:NodeJS.ProcessEnv):{config?:McpConfig;issue?:string;disabled?:boolean}{
  if(!raw||typeof raw!=='object')return {issue:'Not a server definition.'};
  const disabled=raw.disabled===true||raw.enabled===false;
  let config:McpConfig;
  if(source==='opencode'){
    const command=strings(raw.command);
    config=raw.type==='remote'||raw.url?{type:'http',url:String(raw.url||''),headers:record(raw.headers)}:{type:'stdio',command:command?.[0],args:command?.slice(1),env:record(raw.environment)};
  }else if(source==='codex'){
    const passed=Object.fromEntries((strings(raw.env_vars)||[]).filter(name=>env[name]!==undefined).map(name=>[name,String(env[name])]));
    const headers={...record(raw.http_headers),...Object.fromEntries(Object.entries(record(raw.env_http_headers)||{}).filter(([,name])=>env[name]!==undefined).map(([header,name])=>[header,String(env[name])]))};
    if(raw.bearer_token_env_var&&env[raw.bearer_token_env_var])headers.Authorization='Bearer '+env[raw.bearer_token_env_var];
    config=raw.url?{type:'http',url:String(raw.url),headers}:{type:'stdio',command:raw.command,args:strings(raw.args),env:{...passed,...record(raw.env)},cwd:typeof raw.cwd==='string'?raw.cwd:undefined};
    if(typeof raw.startup_timeout_sec==='number')config.timeout=raw.startup_timeout_sec*1000;
  }else{
    const url=raw.url||raw.serverUrl;
    const type=raw.type==='sse'?'sse':url?'http':'stdio';
    config=url?{type,url:String(url),headers:record(raw.headers)}:{type:'stdio',command:raw.command,args:strings(raw.args),env:record(raw.env),cwd:typeof raw.cwd==='string'?raw.cwd:undefined};
  }
  if(config.type==='stdio'&&typeof config.command!=='string')return {issue:'No command or URL.',disabled};
  if(config.type!=='stdio'&&!/^https?:\/\//.test(config.url||''))return {issue:'Unsupported URL.',disabled};
  for(const key of Object.keys(config) as (keyof McpConfig)[])if(config[key]===undefined||(typeof config[key]==='object'&&!Object.keys(config[key] as object).length))delete config[key];
  return {...substitute(config,env),disabled};
}

function locations(cwd:string,home:string):{source:McpSourceId;scope:'user'|'project';file:string;format:'json'|'jsonc'|'toml';pick:(data:any)=>any}[]{
  const support=process.platform==='darwin'?path.join(home,'Library','Application Support'):process.platform==='win32'?(process.env.APPDATA||path.join(home,'AppData','Roaming')):(process.env.XDG_CONFIG_HOME||path.join(home,'.config'));
  const xdg=process.env.XDG_CONFIG_HOME||path.join(home,'.config');
  const servers=(data:any)=>data?.mcpServers,vscode=(data:any)=>data?.servers;
  return [
    {source:'claude-code',scope:'user',file:path.join(home,'.claude.json'),format:'json',pick:servers},
    {source:'claude-code',scope:'user',file:path.join(home,'.claude.json')+'#project',format:'json',pick:(data:any)=>data?.projects?.[cwd]?.mcpServers},
    {source:'claude-code',scope:'project',file:path.join(cwd,'.mcp.json'),format:'json',pick:servers},
    {source:'claude-desktop',scope:'user',file:path.join(support,'Claude','claude_desktop_config.json'),format:'json',pick:servers},
    {source:'cursor',scope:'user',file:path.join(home,'.cursor','mcp.json'),format:'json',pick:servers},
    {source:'cursor',scope:'project',file:path.join(cwd,'.cursor','mcp.json'),format:'json',pick:servers},
    {source:'vscode',scope:'user',file:path.join(support,'Code','User','mcp.json'),format:'jsonc',pick:vscode},
    {source:'vscode',scope:'user',file:path.join(support,'Code - Insiders','User','mcp.json'),format:'jsonc',pick:vscode},
    {source:'vscode',scope:'project',file:path.join(cwd,'.vscode','mcp.json'),format:'jsonc',pick:vscode},
    {source:'windsurf',scope:'user',file:path.join(home,'.codeium','windsurf','mcp_config.json'),format:'json',pick:servers},
    {source:'codex',scope:'user',file:path.join(process.env.CODEX_HOME||path.join(home,'.codex'),'config.toml'),format:'toml',pick:(data:any)=>data?.mcp_servers},
    {source:'opencode',scope:'user',file:path.join(xdg,'opencode','opencode.json'),format:'jsonc',pick:(data:any)=>data?.mcp},
    {source:'opencode',scope:'user',file:path.join(xdg,'opencode','opencode.jsonc'),format:'jsonc',pick:(data:any)=>data?.mcp},
  ];
}

export type McpSyncOptions={cwd:string;home?:string;env?:NodeJS.ProcessEnv;
  /** Claude's .mcp.json approval: approved names, rejected names and approve-all. */
  approval?:{approved?:string[];rejected?:string[];all?:boolean}};

/** Every known MCP config file, parsed; used by the settings page and by syncedMcpServers. */
export async function readMcpSources(options:McpSyncOptions):Promise<SourceFile[]>{
  const home=options.home||os.homedir(),env=options.env||process.env,cache=new Map<string,Promise<string|undefined>>();
  const reports:SourceFile[]=[];
  for(const location of locations(options.cwd,home)){
    const file=location.file.replace(/#project$/,''),text=await (cache.get(file)??(cache.set(file,read(file)),cache.get(file)!));
    // Only Claude's own repository file has an approval flow; other tools' repository files stay unused.
    const report:SourceFile={source:location.source,label:label(location.source),scope:location.scope,file:location.file,exists:text!==undefined,used:location.scope==='user'||location.source==='claude-code',servers:[]};
    if(text!==undefined){
      try{
        const data=location.format==='toml'?parseToml(text):location.format==='jsonc'?parseJsonc(text):JSON.parse(text);
        const entries=location.pick(data);
        if(entries&&typeof entries==='object')for(const [name,raw] of Object.entries<any>(entries)){
          const pending=location.source==='claude-code'&&location.scope==='project'&&!options.approval?.all&&(!!options.approval?.rejected?.includes(name)||!options.approval?.approved?.includes(name));
          report.servers.push({name,...normalize(location.source,raw,env),...(pending?{pending:true}:{}),...(REPLACED.has(name)?{replaced:true}:{})});
        }
      }catch(error){report.error='Could not read: '+(error instanceof Error?error.message:String(error)).slice(0,160);}
    }
    if(report.exists)reports.push(report);
  }
  return reports;
}

/**
 * Servers to offer, from enabled sources, in precedence order. Names already set
 * in Kicad's own configuration are never replaced; later duplicates of a name are
 * dropped (identical) or reported (different).
 */
export function syncedMcpServers(reports:SourceFile[],enabled:readonly string[],existing:Record<string,unknown>={}){
  const servers:Record<string,McpConfig>={},origin:Record<string,string>={},conflicts:{name:string;kept:string;dropped:string}[]=[];
  const order=(report:SourceFile)=>MCP_SOURCES.findIndex(source=>source.id===report.source);
  for(const report of [...reports].sort((a,b)=>order(a)-order(b))){
    if(!report.used||!enabled.includes(report.source))continue;
    for(const server of report.servers){
      if(!server.config||server.disabled||server.pending||server.replaced||Object.prototype.hasOwnProperty.call(existing,server.name))continue;
      const where=report.label+' ('+report.file.replace(/#project$/,'')+')';
      if(servers[server.name]){if(JSON.stringify(servers[server.name])!==JSON.stringify(server.config))conflicts.push({name:server.name,kept:origin[server.name],dropped:where});continue;}
      servers[server.name]=server.config;origin[server.name]=where;
    }
  }
  return {servers,origin,conflicts};
}
export const DEFAULT_MCP_SYNC=MCP_SOURCES.map(source=>source.id);
/** Claude's own approval of repository .mcp.json servers, from ~/.claude.json and the settings files. */
export async function claudeMcpApproval(cwd:string,home=os.homedir()){
  const json=async(file:string)=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return undefined;}};
  const project=(await json(path.join(home,'.claude.json')))?.projects?.[cwd]||{};
  const settings=(await Promise.all([path.join(home,'.claude','settings.json'),path.join(cwd,'.claude','settings.json'),path.join(cwd,'.claude','settings.local.json')].map(json))).filter(Boolean);
  const list=(key:string)=>[...(Array.isArray(project[key])?project[key]:[]),...settings.flatMap((item:any)=>Array.isArray(item[key])?item[key]:[])];
  return {approved:list('enabledMcpjsonServers'),rejected:list('disabledMcpjsonServers'),all:settings.some((item:any)=>item.enableAllProjectMcpServers===true)};
}

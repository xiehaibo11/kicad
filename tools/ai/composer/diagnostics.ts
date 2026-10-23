// Shared local runtime journal. Never store prompts, tool arguments, environment or response bodies.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';

export type DiagnosticSource='terminal'|'extension';
export type DiagnosticEvent={category:'tool'|'terminal'|'ai'|'connection'|'runtime';phase:string;status?:string;sessionId?:string;callId?:string;name?:string;model?:string;provider?:string;durationMs?:number;exitCode?:number;error?:unknown;tokens?:number};
const MAX_FILE=2*1024*1024,MAX_FILES=40,RETENTION=14*86400000;
const queues=new Map<string,Promise<void>>();
const processRun=randomUUID();
const writers=new Map<string,{sequence:number;bytes:number;day:string;lastCleanup:number}>();
const root=()=>process.env.KICAD_DIAGNOSTICS_DIR||path.join(process.env.XDG_STATE_HOME||path.join(os.homedir(),'.local/state'),'kicad/diagnostics');
export function redact(value:unknown,limit=1200):string {
  return String(value??'').replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,'[REDACTED KEY]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s"',;]+/gi,'[REDACTED AUTH]')
    .replace(/\b(?:ctx7sk-|sk-|sk_|ghp_|github_pat_|xox[baprs]-)[a-zA-Z0-9_-]+/g,'[REDACTED TOKEN]')
    .replace(/((?:api[_-]?key|access[_-]?token|auth[_-]?token|authorization|password|passwd|secret|token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi,'$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g,'$1[REDACTED]@')
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/g,'$1?[REDACTED QUERY]').slice(0,limit);
}
// Respect vendor severity; DEBUG text such as "Error log sink initialized" is not a failure.
export function sdkLogLevel(line:string):string {
  const explicit=line.match(/\[(DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\]/i)?.[1]?.toUpperCase();
  if(explicit)return explicit==='WARNING'?'WARN':explicit==='FATAL'?'ERROR':explicit;
  return /error|failed|exception/i.test(line)?'ERROR':/warn/i.test(line)?'WARN':'INFO';
}
export class SdkErrorLines {
  private pending='';
  push(chunk:string){this.pending+=chunk;const lines=this.pending.split('\n');this.pending=lines.pop()||'';if(this.pending.length>16384){lines.push(this.pending);this.pending='';}return lines.filter(line=>sdkLogLevel(line)==='ERROR');}
  flush(){const line=this.pending;this.pending='';return line&&sdkLogLevel(line)==='ERROR'?[line]:[];}
}
// Apple's unzip can return 50 for UTF-8 names in EPRO2 ZIPs even with free disk
// space. Do not silently rewrite shell commands; let the agent choose a supported
// extractor and a fresh destination within the user's authorized task.
export const ARCHIVE_GUIDANCE='On macOS, extract .epro2 ZIP archives using /usr/bin/ditto -x -k "source.epro2" "fresh temporary directory". System unzip can return exit 50 on Chinese member names despite free disk space. Preserve source files and verify extracted contents. Check .epru member format before treating it as JSON.';
// Bash tools run the user's shell. In zsh an unquoted glob that matches nothing aborts the whole
// command and `==` inside [ ] is an error; both kept failing in the runtime journal.
export function shellGuidance(shell=process.env.SHELL||''):string{
  return /(?:^|\/)zsh$/.test(shell)?'Shell commands run in zsh: quote glob patterns and option values containing * or ? (for example --include="*.py"), quote literal separators such as \'===BASE===\' (zsh performs = expansion on an unquoted word beginning with =), use = rather than == inside [ ], and quote paths with spaces or Chinese characters. For optional executables use `command -v tool >/dev/null 2>&1 || true` or a separate call; a missing optional tool must not make a diagnostic command look failed.':'';
}
// A multi-command line ending in `which tool` returns 1 when an optional tool is
// missing, making useful output look like a failed call. The advice is for the
// model; the UI treats the probe as expected rather than a design/tool failure.
export function optionalProbeAdvice(command?:string):string|undefined {
  if(typeof command!=='string')return;
  if(/(?:^|[;&|]\s*)(?:which|command\s+-v|type)\s+/i.test(command))
    return '可选程序探测（which / command -v / type）未命中时会让整条命令返回非零。用 `command -v tool >/dev/null 2>&1 || true` 或分开调用；不要把可选探测失败当成主任务失败。';
}
export function archiveCommandAdvice(name:string,args:any,platform=process.platform):string|undefined {
  if(platform!=='darwin'||!['bash','shell','terminal'].includes(name.toLowerCase()))return;
  const command=typeof args?.command==='string'?args.command:'';
  const commands=command.matchAll(/(?:^\s*|[;&|]\s*)(?:\/usr\/bin\/)?unzip\s+([^\n;&|]*)/g);
  for(const [,argumentsText] of commands){
    if(!/\.epro2(?:["'\s]|$)/i.test(argumentsText)||/(?:^|\s)-[^\s]*[lvtZ]/.test(argumentsText))continue;
    return 'macOS 系统 unzip 解压含中文文件名的 .epro2 可能错误返回 Exit code 50。请使用 /usr/bin/ditto -x -k "源文件.epro2" "新建临时目录"，随后核对成员名称和完整性；不要覆写源文件，也不要把 disk full? 直接认定为磁盘已满。';
  }
}
function errorText(error:any):string {
  if(error instanceof Error)return error.name+': '+error.message;
  if(typeof error==='string')return error;
  if(error&&typeof error==='object')return [error.code,error.name,error.message,error.data?.message,error.statusCode].filter(v=>typeof v==='string'||typeof v==='number').join(' ');
  return '';
}
const rules:[string,RegExp,string][]=[
  ['cancelled',/abort|cancel|interrupt|取消|中断/i,'用户取消或中断；不要自动重放写操作。'],
  ['permission',/permission|denied|reject|EACCES|EPERM/i,'核对工作区权限与用户授权，不绕过权限重试。'],
  ['authentication',/\b401\b|unauthori[sz]ed|authentication|invalid.api.key/i,'检查当前模型的认证来源；不要在日志中输出密钥。'],
  ['rate_limit',/\b429\b|rate.limit|quota|credit|balance/i,'检查额度和限流，按服务端退避要求重试。'],
  ['context_limit',/context.length|context.window|too.many.tokens|maximum.context/i,'检查上下文压缩与输出预算，保留未完成任务。'],
  ['connection',/IPC_UNAVAILABLE|NOT_READY|AMBIGUOUS_INSTANCE|GUI_NOT_FOUND|ECONN|ENOTFOUND|network|fetch failed/i,'检查原生 GUI、IPC 实例或网络地址；不要据此重放已提交编辑。'],
  ['timeout',/timeout|timed.out|deadline|超时/i,'检查耗时与取消状态，先回读执行结果再决定是否重试。'],
  ['configuration',/failed to load configuration|invalid transport/i,'检查生成的配置键和传输字段；先修正配置，再重新启动会话。'],
  ['invalid_arguments',/BAD_INPUT|INVALID_ARGUMENT|validation|not allowed|schema|Expected query|kind must be|arguments must be an object|Search for this capability first|Unknown capability id/i,'重新查询工具参数和单位，修正调用后再执行。'],
  ['search_limit',/Ripgrep JSON record exceeded/i,'搜索结果中有超长单行；缩小文件范围，或使用支持大型 JSON 记录的搜索版本。'],
  ['binary_file',/Cannot read binary file/i,'这是二进制文件；按格式使用归档或专用读取工具，不要当作文本读取。'],
  ['archive_write',/write error \(disk full\?\)|fchmod \(file attributes\) error|is probably truncated/i,'归档解压写入失败；先检查空间与成员文件名。在 macOS 上若涉及中文 .epro2 文件名，改用 ditto -x -k 解压到新临时目录并验证完整性。不要仅凭退出码 50 认定磁盘已满。'],
  ['large_file',/File content \([^)]+\) exceeds maximum allowed size|exceeds maximum allowed size \(256\s*KB\)|use offset and limit parameters to read specific portions/i,'这是 Read 工具对超过 256 KiB 文件的保护性限制，不是程序故障。先检查文件大小，再用 offset/limit 读取需要的行段，或改用内容搜索；只有用户明确要求整份文件时才考虑 allow_large。'],
  ['kicad_runtime',/kicad-direct was not found|Bundled KiCad JavaScript runtime is missing/i,'优先使用内置 mcp__kicad__ 工具，不要从 Bash 调 kicad-cli agent。若必须使用 CLI，设置 KICAD_DIRECT 指向 kicad-direct.mjs，或在构建时开启 -DKICAD_BUILD_AI_AGENT=ON。'],
  ['json_parse',/JSONDecodeError|Extra data: line \d+|Expecting value: line \d+|is not valid JSON|Unexpected non-whitespace character after JSON/i,'JSON 输入不符合单一 JSON 文档格式。先检查输入大小、格式与报错位置；.epru 可能是带分隔符的记录，不能直接 json.load。CLI 输出须先检查退出码，将 stdout 与 stderr 分开（不要 2>&1），再按工具约定解析。不要截取第一个大括号来掩盖格式问题，也不要自动重放写操作。'],
  ['script_syntax',/SyntaxError|Unexpected token|Unexpected end of JSON input|Unexpected identifier/i,'生成的脚本或 JSON 语法无效。检查引号、转义和截断位置后重写；不要把语法错误当成程序缺失。'],
  ['dependency',/ENOENT|not.found|missing.executable|command not found/i,'检查目标路径、程序安装和版本匹配。'],
  ['design_check',/CONNECTIVITY_UNPROVEN|AUDIT_NOT_PASSED|RELEASE_EVIDENCE_INCOMPLETE|DRC_FAILED|ERC_FAILED/i,'这是工程检查未通过；读取检查报告，不当作运行时崩溃。'],
  ['command_exit',/(?:Command exited with code|Exit code)\s+\d+/i,'检查命令退出码、工作目录和原始终端输出；非零退出不一定是程序缺陷。'],
  ['provider',/\b50[0234]\b|overloaded|server.error/i,'检查模型服务状态；区分服务故障与本地工具错误。'],
];
// A failed shell command's error carries its whole output: file listings, source text, logs. Broad words
// there ("schema", "reject", "not found") say nothing about the failure, so command exits are classified
// only from their first and last lines and only by unambiguous error phrases; otherwise command_exit.
const COMMAND_EXIT=/^\s*(?:Exit code|Command exited with code)\s+\d+/i;
const commandRules:[string,RegExp,string][]=[
  ['archive_write',rules.find(([kind])=>kind==='archive_write')![1],rules.find(([kind])=>kind==='archive_write')![2]],
  ['shell_syntax',/\(eval\):\d+:|zsh: (?:parse error|no matches found|bad pattern|unknown file attribute)|syntax error near unexpected token|unexpected EOF while looking for matching|bad substitution|unmatched [`'"]/i,'命令语法或引号错误（zsh 会展开未加引号的通配符、== 与以 = 开头的词）；把分隔符写成 \'===BASE===\'，修正引号或改写命令后再执行，不要据此判断程序缺失。'],
  ['search_pattern',/exceeds complexity limits|regex parse error|Invalid regular expression|unmatched \(|error at position \d+/i,'搜索正则无效或过于复杂；简化模式或改用固定字符串（-F）后再搜索。'],
  // A parser exception proves the input format failed, not why it failed.
  ['json_parse',rules.find(([kind])=>kind==='json_parse')![1],rules.find(([kind])=>kind==='json_parse')![2]],
  ['script_syntax',/SyntaxError|Unexpected token|Unexpected end of JSON input|Unexpected identifier/i,'生成的脚本或 JSON 语法无效；检查引号、转义和截断位置后重写。'],
  ['large_file',/File content \([^)]+\) exceeds maximum allowed size|exceeds maximum allowed size \(256\s*KB\)/i,'Read 工具对超过 256 KiB 的文件启用了保护；改用 offset/limit 或内容搜索，不要重试整文件读取。'],
  ['optional_probe',/(?:^|\n)(?:which|command -v|type)\b[^\n]*(?:not found|no \w+ in)/i,'可选程序探测未命中，不应让整条命令被当成任务失败；用 `|| true` 或分开调用。'],
  ['kicad_runtime',/kicad-direct was not found|Bundled KiCad JavaScript runtime is missing/i,'优先使用内置 mcp__kicad__ 工具；若必须用 kicad-cli agent，设置 KICAD_DIRECT 或开启 -DKICAD_BUILD_AI_AGENT=ON。'],
  ['permission',/Permission denied|Operation not permitted|\bEACCES\b|\bEPERM\b/,'核对工作区权限与用户授权，不绕过权限重试。'],
  ['dependency',/command not found|No such file or directory|\bENOENT\b|Cannot find module/i,'检查目标路径、程序安装和版本匹配。'],
  ['timeout',/timed out|deadline exceeded|\bETIMEDOUT\b/i,'检查耗时与取消状态，先回读执行结果再决定是否重试。'],
  ['connection',/Connection refused|Could not resolve host|\bECONNREFUSED\b|\bENOTFOUND\b|Network is unreachable|IPC_UNAVAILABLE/,'检查原生 GUI、IPC 实例或网络地址；不要据此重放已提交编辑。'],
];
const COMMAND_EXIT_RULE=rules.find(([kind])=>kind==='command_exit')!;
function commandScope(text:string){const lines=text.split('\n').map(line=>line.trim()).filter(Boolean);return lines.length<=12?lines.join('\n'):[...lines.slice(0,4),...lines.slice(-8)].join('\n');}
export function diagnose(error:unknown){
  const text=errorText(error);
  let rule=rules.find(([,pattern])=>pattern.test(text));
  if(COMMAND_EXIT.test(text)){
    // The earliest unambiguous error line explains the exit best.
    const scope=commandScope(text),found=commandRules.map(entry=>({entry,at:scope.search(entry[1])})).filter(hit=>hit.at>=0).sort((a,b)=>a.at-b.at)[0];
    rule=found?.entry??COMMAND_EXIT_RULE;
  }
  return {kind:rule?.[0]||'unknown',suggestion:rule?.[2]||'根据关联会话和调用 ID 检查原始执行记录；目前证据不足，不能认定根因。',message:redact(text)};
}
async function workspaceDir(cwd:string,base=root()){const real=await fs.realpath(cwd).catch(()=>path.resolve(cwd));return path.join(base,createHash('sha256').update(real).digest('hex').slice(0,24));}
export class RuntimeJournal {
  private pending:Promise<void>=Promise.resolve();private warning=false;private dropped=0;private queued=0;
  readonly source:DiagnosticSource;readonly cwd:string;
  // The directory is fixed when the journal is created: writes are queued and may finish
  // after a caller (or a test) has changed KICAD_DIAGNOSTICS_DIR.
  private readonly base=root();
  constructor(source:DiagnosticSource,cwd:string){this.source=source;this.cwd=cwd;}
  record(event:DiagnosticEvent):Promise<void>{
    if(this.queued>=256){this.dropped++;return Promise.resolve();}
    this.queued++;
    const work=this.pending.then(async()=>{
      const dir=await workspaceDir(this.cwd,this.base);
      const write=(queues.get(dir)||Promise.resolve()).catch(()=>{}).then(async()=>{
        await fs.mkdir(dir,{recursive:true,mode:0o700});
        const key=dir+':'+this.source;
        const writer=writers.get(key)||{sequence:0,bytes:0,day:'',lastCleanup:0};writers.set(key,writer);
        const today=new Date().toISOString().slice(0,10);
        if(today!==writer.day||writer.bytes>=MAX_FILE){writer.day=today;writer.sequence++;writer.bytes=0;}
        const diagnosis=event.error===undefined?undefined:diagnose(event.error);
        const record={schemaVersion:1,id:randomUUID(),time:new Date().toISOString(),source:this.source,category:event.category,phase:redact(event.phase),status:redact(event.status||'info'),sessionId:redact(event.sessionId),callId:redact(event.callId),name:redact(event.name),model:redact(event.model),provider:redact(event.provider),durationMs:event.durationMs,exitCode:event.exitCode,tokens:event.tokens,diagnosis,droppedEvents:this.dropped};
        const file=path.join(dir,`${today}-${this.source}-${processRun}-${writer.sequence}.jsonl`),line=JSON.stringify(record)+'\n';
        await fs.appendFile(file,line,{encoding:'utf8',mode:0o600});writer.bytes+=Buffer.byteLength(line);this.warning=false;
        if(Date.now()-writer.lastCleanup>60000){writer.lastCleanup=Date.now();await prune(dir,file);}
      });
      queues.set(dir,write);try{await write;}finally{if(queues.get(dir)===write)queues.delete(dir);}
    }).catch(()=>{this.dropped++;if(!this.warning){this.warning=true;console.warn('[Kicad diagnostics] 日志写入失败；请检查日志目录权限或磁盘空间。业务操作继续执行。');}}).finally(()=>{this.queued--;});
    this.pending=work;return work;
  }
  flush(){return this.pending;}
}
async function prune(dir:string,current:string){
  const files=await journalFiles(dir);
  for(const [i,f] of files.entries())if(f.file!==current&&(i>=MAX_FILES||Date.now()-f.mtime>RETENTION))await fs.unlink(f.file).catch(()=>{});
}
async function journalFiles(dir:string){
  const names=await fs.readdir(dir).catch((e)=>{if(e.code==='ENOENT')return [];throw e;});
  const files=await Promise.all(names.filter(n=>/^\d{4}-\d{2}-\d{2}-(terminal|extension)-[a-f0-9-]+-\d+\.jsonl$/.test(n)).map(async n=>{const file=path.join(dir,n);const s=await fs.lstat(file).catch(()=>undefined);return s?.isFile()?{file,mtime:s.mtimeMs,size:s.size}:undefined;}));
  return files.filter((f):f is {file:string;mtime:number;size:number}=>!!f).sort((a,b)=>b.mtime-a.mtime);
}
export async function diagnosticReport(cwd:string,sessionId?:string){
  const directory=await workspaceDir(cwd),files=await journalFiles(directory);let bytes=0,invalidLines=0,events=0,truncated=false;
  const categories:Record<string,number>={},groups=new Map<string,any>(),recent:any[]=[],calls=new Map<string,any>();
  for(const f of files){if(bytes+f.size>8*1024*1024){truncated=true;break;}bytes+=f.size;
    const text=await fs.readFile(f.file,'utf8').catch(()=>{invalidLines++;return '';});
    for(const line of text.split('\n')){if(!line)continue;let e:any;try{e=JSON.parse(line);}catch{invalidLines++;continue;}
      if(e.schemaVersion!==1||sessionId&&e.sessionId!==sessionId)continue;events++;categories[e.category]=(categories[e.category]||0)+1;
      if(e.callId&&['tool','terminal'].includes(e.category)){const key=e.source+':'+e.sessionId+':'+e.callId;const prior=calls.get(key);if(!prior||e.time>prior.time||e.time===prior.time&&e.phase==='end')calls.set(key,e);}
      if(!e.diagnosis)continue;
      const key=[e.source,e.category,e.name,e.diagnosis.kind].join(':'),g=groups.get(key)||{source:e.source,category:e.category,name:e.name,kind:e.diagnosis.kind,count:0,suggestion:e.diagnosis.suggestion,lastSeen:'',examples:[]};
      g.count++;if(e.time>g.lastSeen)g.lastSeen=e.time;if(g.examples.length<3)g.examples.push({id:e.id,sessionId:e.sessionId,callId:e.callId,message:clip(e.diagnosis.message,400)});groups.set(key,g);recent.push(e);
    }
  }
  // Report rows keep what locates an event; the suggestion lives once on its issue group.
  const row=(e:any)=>Object.fromEntries(Object.entries({time:e.time,source:e.source,category:e.category,phase:e.phase,status:e.status,name:e.name,model:e.model,sessionId:e.sessionId,callId:e.callId,durationMs:e.durationMs,exitCode:e.exitCode,kind:e.diagnosis?.kind,message:clip(e.diagnosis?.message,240)}).filter(([,v])=>v!==undefined&&v!==null&&v!==''));
  return {directory,scope:'本工作区保留的运行事件；规则归类是排查建议，不是已确认根因。无日志不代表无错误。',pendingCalls:[...calls.values()].filter(e=>e.phase==='start').sort((a,b)=>b.time.localeCompare(a.time)).slice(0,30).map(row),pendingNote:'仅表示保留日志中未见结束事件，可能仍在运行、被中断或超出读取范围；不认定为崩溃。',retentionDays:14,events,categories,invalidLines,truncated,issues:[...groups.values()].sort((a,b)=>b.count-a.count).slice(0,100),issueGroups:groups.size,slowCalls:slowest(calls),recent:recent.sort((a,b)=>b.time.localeCompare(a.time)).slice(0,30).map(row)};
}
// Journal messages keep up to 1200 characters; the report quotes the start, the call ID finds the rest.
const clip=(text:string|undefined,limit:number)=>text&&text.length>limit?text.slice(0,limit)+'…':text;
// Per-tool latency from finished calls, slowest first: where a session spent its time.
function slowest(calls:Map<string,any>){
  const byName=new Map<string,number[]>();
  for(const e of calls.values())if(e.phase==='end'&&typeof e.durationMs==='number'&&e.name){const list=byName.get(e.name)||[];list.push(e.durationMs);byName.set(e.name,list);}
  return [...byName.entries()].map(([name,list])=>{list.sort((a,b)=>a-b);return {name,calls:list.length,p50Ms:list[Math.floor(list.length/2)],maxMs:list[list.length-1]};}).sort((a,b)=>b.maxMs-a.maxMs).slice(0,10);
}
function unwrap(value:any):any {if(typeof value==='string'){try{return JSON.parse(value);}catch{return undefined;}}if(value?.content){for(const c of value.content)if(c.type==='text'){const parsed=unwrap(c.text);if(parsed?.ok===false)return parsed;}}return value;}
export function toolFailure(value:any,exitCode?:number):unknown {const v=unwrap(value);if(v?.ok===false)return v.error||'Tool returned ok:false';if(v?.isError||v?.is_error)return 'Tool returned an error';if(typeof exitCode==='number'&&exitCode!==0)return 'Command exited with code '+exitCode;return undefined;}
export const toolCategory=(name=''):DiagnosticEvent['category']=>/^(bash|shell|terminal)$/i.test(name)?'terminal':'tool';
// SDK hooks and OpenCode bus use the same journal schema. Only metadata is persisted.
export class DiagnosticRecorder {
  private starts=new Map<string,number>();private seen=new Set<string>();
  readonly journal:RuntimeJournal;
  constructor(journal:RuntimeJournal){this.journal=journal;}
  start(sessionId:string,callId:string,name:string){this.starts.set(sessionId+':'+callId,Date.now());if(this.starts.size>2048)this.starts.delete(this.starts.keys().next().value!);return this.journal.record({category:toolCategory(name),phase:'start',status:'running',sessionId,callId,name});}
  end(sessionId:string,callId:string,name:string,result?:unknown,error?:unknown,exitCode?:number){
    const key=sessionId+':'+callId;if(callId&&this.seen.has(key))return Promise.resolve();if(callId)this.seen.add(key);if(this.seen.size>4096)this.seen.delete(this.seen.values().next().value!);
    const began=this.starts.get(key);this.starts.delete(key);error??=toolFailure(result,exitCode);
    return this.journal.record({category:toolCategory(name),phase:'end',status:error?'error':'returned',sessionId,callId,name,exitCode,durationMs:began===undefined?undefined:Date.now()-began,error});
  }
  async terminalEvent(event:any){
    const p=event?.properties||{},part=p.part;
    if(event.type==='session.status'&&p.status?.type==='retry')await this.journal.record({category:'ai',phase:'retry',status:'retry',sessionId:p.sessionID,error:p.status.message});
    if(event.type==='session.error')await this.journal.record({category:'ai',phase:'error',status:'error',sessionId:p.sessionID,error:p.error});
    if(event.type==='message.part.updated'&&part){
      if(part.type==='tool'&&['completed','error'].includes(part.state?.status))await this.end(part.sessionID,part.callID,part.tool,part.state.output,part.state.status==='error'?part.state.error:undefined,part.state.metadata?.exit);
      if(part.type==='step-finish')await this.journal.record({category:'ai',phase:'step-finish',status:'returned',sessionId:part.sessionID,callId:part.messageID,tokens:part.tokens?.total});
      if(part.type==='retry')await this.journal.record({category:'ai',phase:'retry',status:'retry',sessionId:part.sessionID,error:part.error});
    }
  }
}

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
export function redact(value:unknown):string {
  return String(value??'').replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,'[REDACTED KEY]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s"',;]+/gi,'[REDACTED AUTH]')
    .replace(/\b(?:ctx7sk-|sk-|sk_|ghp_|github_pat_|xox[baprs]-)[a-zA-Z0-9_-]+/g,'[REDACTED TOKEN]')
    .replace(/((?:api[_-]?key|access[_-]?token|auth[_-]?token|authorization|password|passwd|secret|token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi,'$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g,'$1[REDACTED]@')
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/g,'$1?[REDACTED QUERY]').slice(0,1200);
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
  ['invalid_arguments',/BAD_INPUT|INVALID_ARGUMENT|validation|not allowed|schema|Expected query and kind|arguments must be an object|Search for this capability first/i,'重新查询工具参数和单位，修正调用后再执行。'],
  ['search_limit',/Ripgrep JSON record exceeded/i,'搜索结果中有超长单行；缩小文件范围，或使用支持大型 JSON 记录的搜索版本。'],
  ['binary_file',/Cannot read binary file/i,'这是二进制文件；按格式使用归档或专用读取工具，不要当作文本读取。'],
  ['archive_write',/write error \(disk full\?\)|fchmod \(file attributes\) error|is probably truncated/i,'归档解压写入失败；先检查空间与成员文件名。在 macOS 上若涉及中文 .epro2 文件名，改用 ditto -x -k 解压到新临时目录并验证完整性。不要仅凭退出码 50 认定磁盘已满。'],
  ['dependency',/ENOENT|not.found|missing.executable|command not found/i,'检查目标路径、程序安装和版本匹配。'],
  ['design_check',/CONNECTIVITY_UNPROVEN|AUDIT_NOT_PASSED|RELEASE_EVIDENCE_INCOMPLETE|DRC_FAILED|ERC_FAILED/i,'这是工程检查未通过；读取检查报告，不当作运行时崩溃。'],
  ['command_exit',/(?:Command exited with code|Exit code)\s+\d+/i,'检查命令退出码、工作目录和原始终端输出；非零退出不一定是程序缺陷。'],
  ['provider',/\b50[0234]\b|overloaded|server.error/i,'检查模型服务状态；区分服务故障与本地工具错误。'],
];
export function diagnose(error:unknown){const text=errorText(error);const rule=rules.find(([,pattern])=>pattern.test(text));return {kind:rule?.[0]||'unknown',suggestion:rule?.[2]||'根据关联会话和调用 ID 检查原始执行记录；目前证据不足，不能认定根因。',message:redact(text)};}
async function workspaceDir(cwd:string){const real=await fs.realpath(cwd).catch(()=>path.resolve(cwd));return path.join(root(),createHash('sha256').update(real).digest('hex').slice(0,24));}
export class RuntimeJournal {
  private pending:Promise<void>=Promise.resolve();private warning=false;private dropped=0;private queued=0;
  readonly source:DiagnosticSource;readonly cwd:string;
  constructor(source:DiagnosticSource,cwd:string){this.source=source;this.cwd=cwd;}
  record(event:DiagnosticEvent):Promise<void>{
    if(this.queued>=256){this.dropped++;return Promise.resolve();}
    this.queued++;
    const work=this.pending.then(async()=>{
      const dir=await workspaceDir(this.cwd);
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
      g.count++;if(e.time>g.lastSeen)g.lastSeen=e.time;if(g.examples.length<3)g.examples.push({id:e.id,sessionId:e.sessionId,callId:e.callId,message:e.diagnosis.message});groups.set(key,g);recent.push(e);
    }
  }
  return {directory,scope:'本工作区保留的运行事件；规则归类是排查建议，不是已确认根因。无日志不代表无错误。',pendingCalls:[...calls.values()].filter(e=>e.phase==='start').slice(0,30),pendingNote:'仅表示保留日志中未见结束事件，可能仍在运行、被中断或超出读取范围；不认定为崩溃。',retentionDays:14,events,categories,invalidLines,truncated,issues:[...groups.values()].sort((a,b)=>b.count-a.count).slice(0,100),issueGroups:groups.size,recent:recent.sort((a,b)=>b.time.localeCompare(a.time)).slice(0,30)};
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

// Local, workspace-scoped history readers. Never import one runtime's state into another.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const exec = promisify(execFile);
const queues = new Map<string,Promise<void>>();
export type HistorySource = 'extension' | 'terminal';
export type HistoryEntry = {id:string;source:HistorySource;nativeId:string;cwd:string;summary:string;lastModified:number;messageCount:number;isCurrentWorkspace:boolean};
const uuid=/^(?:codex-)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const terminalId=/^ses_[a-zA-Z0-9]+$/;
const canonical = async (cwd:string) => fs.realpath(cwd).catch(()=>path.resolve(cwd));
export const historyRoot = () => process.env.KICAD_HISTORY_DIR || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(),'.local/share'),'kicad/history');
const claudeRoot = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(),'.claude');
const textOf = (message:any) => typeof message?.content==='string' ? message.content : (Array.isArray(message?.content) ? message.content.filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('\n') : '');
async function lines(file:string):Promise<any[]> {
  try {return (await fs.readFile(file,'utf8')).split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
}
const viewable=(record:any)=>['user','assistant'].includes(record.type) && !record.isMeta && !record.isSynthetic && !record.isSidechain && !record.parent_tool_use_id;
function unique(records:any[]) {
  const result=new Map<string,any>();
  for(const record of records.filter(viewable))result.set(record.uuid || record.message?.id || randomUUID(),record);
  return [...result.values()];
}
export async function saveExtensionEvent(id:string,cwd:string,event:any) {
  if(!uuid.test(id) || !viewable(event))return;
  const directory=path.join(historyRoot(),'extension'),file=path.join(directory,id+'.jsonl');
  const operation=(queues.get(file)||Promise.resolve()).catch(()=>{}).then(async()=>{
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const record={...event,session_id:id,cwd:await canonical(cwd),timestamp:event.timestamp||new Date().toISOString()};
    await fs.appendFile(file,JSON.stringify(record)+'\n',{encoding:'utf8',mode:0o600});
  });
  queues.set(file,operation);
  try {await operation;}finally{if(queues.get(file)===operation)queues.delete(file);}
}
async function extensionRecords(id:string,cwd:string) {
  if(!uuid.test(id))throw Error('Invalid extension session ID');
  const real=await canonical(cwd),project=path.join(claudeRoot(),'projects',real.replace(/[^a-zA-Z0-9]/g,'-'));
  const native=await lines(path.join(project,id+'.jsonl'));
  const backup=(await lines(path.join(historyRoot(),'extension',id+'.jsonl'))).filter(record=>record.cwd===real);
  // Native records have the runtime's full tool graph; backup fills unflushed messages.
  return unique([...native,...backup.filter(record=>!native.some(item=>item.uuid && item.uuid===record.uuid))]);
}
async function sqlite(query:string) {
  const database=process.env.KICAD_HISTORY_DB || path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share'),'opencode/opencode.db');
  try{await fs.access(database);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  const binary=process.platform==='darwin'?'/usr/bin/sqlite3':'sqlite3';
  const {stdout}=await exec(binary,['-readonly','-json',database,query],{maxBuffer:64*1024*1024,timeout:10000});
  return stdout.trim()?JSON.parse(stdout):[];
}
const sql=(value:string)=>"'"+value.replaceAll("'","''")+"'";
export async function listHistory(cwd:string,source?:HistorySource):Promise<HistoryEntry[]> {
  const real=await canonical(cwd),entries:HistoryEntry[]=[];
  if(source!=='terminal'){
    const project=path.join(claudeRoot(),'projects',real.replace(/[^a-zA-Z0-9]/g,'-'));
    const files=await Promise.all([project,path.join(historyRoot(),'extension')].map(async dir=>{
      try{return await fs.readdir(dir);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
    }));
    for(const id of new Set(files.flat().map(name=>name.replace(/\.jsonl$/,'' )).filter(name=>uuid.test(name)))){
      const records=await extensionRecords(id,real);if(!records.length)continue;
      const first=records.find(record=>record.type==='user'&&textOf(record.message));
      entries.push({id:'extension:'+id,source:'extension',nativeId:id,cwd:real,summary:textOf(first?.message).replace(/\s+/g,' ').slice(0,100)||'扩展会话',messageCount:records.length,lastModified:Math.max(...records.map(record=>Date.parse(record.timestamp)||0)),isCurrentWorkspace:true});
    }
  }
  if(source!=='extension'){
    const rows=await sqlite(`SELECT s.id,s.directory,s.title,s.time_updated,(SELECT count(*) FROM message m WHERE m.session_id=s.id) AS messages FROM session s WHERE s.parent_id IS NULL AND s.time_archived IS NULL AND s.directory IN (${sql(real)},${sql(path.resolve(cwd))}) ORDER BY s.time_updated DESC`);
    for(const row of rows)entries.push({id:'terminal:'+row.id,source:'terminal',nativeId:row.id,cwd:row.directory,summary:row.title,lastModified:row.time_updated,messageCount:row.messages,isCurrentWorkspace:true});
  }
  return entries.sort((a,b)=>b.lastModified-a.lastModified);
}
export async function readHistory(id:string,cwd:string):Promise<any[]> {
  if(id.startsWith('extension:'))return extensionRecords(id.slice(10),cwd);
  if(!id.startsWith('terminal:') || !terminalId.test(id.slice(9)))throw Error('Invalid shared session ID');
  const native=id.slice(9),real=await canonical(cwd);
  const sessions=await sqlite(`SELECT id FROM session WHERE id=${sql(native)} AND directory IN (${sql(real)},${sql(path.resolve(cwd))})`);
  if(!sessions.length)throw Error('Session is not in this workspace');
  const rows=await sqlite(`SELECT m.id,m.data,m.time_created,(SELECT json_group_array(json(p.data)) FROM (SELECT data FROM part WHERE message_id=m.id ORDER BY id) p) AS parts FROM message m WHERE m.session_id=${sql(native)} ORDER BY m.time_created,m.id`);
  return rows.map((row:any)=>({info:{...JSON.parse(row.data),id:row.id},parts:JSON.parse(row.parts||'[]')}));
}
export function terminalMessages(records:any[],id:string) {
  return records.flatMap(record=>{
    const content:any[]=[],results:any[]=[];
    for(const part of record.parts||[]){
      if(part.type==='text'&&!part.synthetic&&!part.ignored)content.push({type:'text',text:part.text});
      if(part.type==='reasoning')content.push({type:'thinking',thinking:part.text});
      if(part.type==='tool'){
        content.push({type:'tool_use',id:part.callID,name:part.tool,input:part.state?.input||{}});
        results.push({type:'user',uuid:record.info.id+'-'+part.callID,session_id:id,parent_tool_use_id:null,message:{role:'user',content:[{type:'tool_result',tool_use_id:part.callID,is_error:part.state?.status==='error',content:part.state?.output||part.state?.error||'Pending or interrupted'}]}});
      }
    }
    return content.length?[{type:record.info.role,uuid:record.info.id,session_id:id,parent_tool_use_id:null,message:{role:record.info.role,content}},...results]:[];
  });
}

import {Message} from '../models/Message';
import type {ContentBlockWrapper} from '../models/ContentBlockWrapper';

export interface ExecutionRow {key:string;messages:Message[];active:boolean;startedAt?:number}
export type ExecutionStatus='running'|'completed'|'failed'|'stopped'|'ended';
export type TimelineRow = {kind:'message';key:string;message:Message} | ({kind:'execution'} & ExecutionRow);
const notifications=/<(?:task|agent|bash)-notification>[\s\S]*?<\/(?:task|agent|bash)-notification>/;
const important=/^\s*(?:#{1,6}\s*)?(?:【(?:重要问题|需要确认|阻塞问题|风险提示)】|\[(?:Important|Action required|Blocked)\])/im;
const interactive=new Set(['AskUserQuestion','ExitPlanMode','EnterPlanMode']);
const blocks=(message:Message):ContentBlockWrapper[]=>Array.isArray(message?.message?.content)?message.message.content:[];
// Expected guards and optional-tool probes are not task failures. A Read size
// refusal is the SDK protecting the context; `which code cursor` ending a
// multi-line diagnostic is an optional probe, not a broken command.
const expectedReadLimit=/File content \([^)]+\) exceeds maximum allowed size|exceeds maximum allowed size \(256\s*KB\)/i;
function expectedFailure(full:string){
  if(expectedReadLimit.test(full))return true;
  const lines=full.split('\n').map(line=>line.trim()).filter(Boolean);
  return lines.length>1&&/^[a-z0-9._-]+ not found$/i.test(lines.at(-1)||'');
}
// Local Claude Code does not stream tool_progress (CLI 2.1.83 sends it only with CLAUDE_CODE_REMOTE),
// so derive the running tool from the latest tool_use without a result.
const stamp=(value:unknown)=>typeof value==='number'?value:typeof value==='string'&&!Number.isNaN(Date.parse(value))?Date.parse(value):Date.now();
function toolLabel(name:string,input:any){
  const value=typeof name==='string'?name:'';
  const short=value.startsWith('mcp__')?value.split('__').at(-1)||value:value;
  const detail=input?.description||input?.id||input?.action||input?.command||input?.file_path||input?.pattern||input?.url||input?.query||'';
  return {name:short,detail:String(detail).replace(/\s+/g,' ').slice(0,80)};
}
export interface RunningTool {name:string;detail:string;since:number;parent:boolean}
const contentText=(value:any):string=>typeof value==='string'?value:Array.isArray(value)?value.map(v=>typeof v==='string'?v:v?.text||'').join('\n'):value?.text?String(value.text):'';
const text=(message:Message)=>typeof message.message.content==='string'?message.message.content:contentText(blocks(message).map(w=>w.content));
function userRequest(message:Message){
  return message.type==='user'&&!message.parentToolUseId&&!message.isEmpty&&!notifications.test(text(message));
}
export function executionRows(messages:Message[]):TimelineRow[]{
  const rows:TimelineRow[]=[];
  let current:Extract<TimelineRow,{kind:'execution'}>|undefined,requestAt:number|undefined;
  messages.forEach((message,index)=>{
    if(userRequest(message)||message.type==='slash_command_result'){
      if(current)current.active=false;
      current=undefined;requestAt=message.timestamp;
      rows.push({kind:'message',key:'message-'+index,message});
      return;
    }
    // Tool results and SDK notifications belong to their request, never a new user turn.
    if(!current){current={kind:'execution',key:'execution-'+index,messages:[],active:true,startedAt:requestAt};rows.push(current);}
    current.messages.push(message);
  });
  return rows;
}
function subset(message:Message,content:ContentBlockWrapper[]):Message{
  return new Message(message.type,{role:message.message.role,content},message.timestamp,{parentToolUseId:message.parentToolUseId});
}
export function executionView(messages:Message[],busy:boolean,disconnected=false){
  const tools=new Map<string,{name:string;wrapper:ContentBlockWrapper;input:any;since:number;child:boolean}>();
  let lastTool=-1,result:Message|undefined,resultIndex=messages.length;
  let stopped=disconnected;
  messages.forEach((message,index)=>{
    if(message.type==='result'&&!message.parentToolUseId){result=message;resultIndex=index;}
    for(const wrapper of blocks(message)){
      const block=wrapper.content;
      if(block.type==='tool_use'){
        tools.set(block.id,{name:block.name,wrapper,input:block.input,since:stamp(message.timestamp),child:!!message.parentToolUseId});
        if(!message.parentToolUseId)lastTool=index;
      }
      if(!message.parentToolUseId&&(block.type==='interrupt'||block.type==='llm_error'))stopped=true;
    }
  });
  const status:ExecutionStatus=busy?'running':result?.is_error?'failed':result?'completed':stopped?'stopped':'ended';
  const hasTools=tools.size>0;
  // A provider can emit several progress messages after its final tool. Only the
  // last main assistant message can be the answer; earlier progress stays in details.
  let finalIndex=-1;
  messages.forEach((message,index)=>{
    if(message.type==='assistant'&&!message.parentToolUseId&&index>lastTool&&index<resultIndex
      &&!blocks(message).some(w=>w.content.type==='tool_use')&&text(message).trim())finalIndex=index;
  });
  const details:Message[]=[],notices:Message[]=[],answers:Message[]=[],timeline:Message[]=[];
  messages.forEach((message,index)=>{
    if(message.type==='result')return;
    const items=blocks(message);
    if(message.parentToolUseId){if(!message.isEmpty){details.push(message);timeline.push(message);}return;}
    if(message.type==='tip'||message.type==='system'){
      // Keep the stop marker in the session data for turn status, without a
      // standalone interruption banner in the conversation.
      if(items.length && items.every(w=>w.content.type==='interrupt'))return;
      notices.push(message);if(!message.isEmpty)timeline.push(message);return;
    }
    if(message.type!=='assistant'){
      if(!message.isEmpty){details.push(message);timeline.push(message);}
      return;
    }
    // Progress and notices remain at their original positions in the stream.
    if(typeof message.message.content==='string'){
      if(important.test(message.message.content)){notices.push(message);timeline.push(message);}
      else if(!hasTools||(!busy&&!stopped&&!result?.is_error&&index===finalIndex))answers.push(message);
      else {details.push(message);timeline.push(message);}
      return;
    }
    const detailBlocks:ContentBlockWrapper[]=[],noticeBlocks:ContentBlockWrapper[]=[],answerBlocks:ContentBlockWrapper[]=[];
    const hasTool=items.some(w=>w.content.type==='tool_use');
    for(const wrapper of items){
      const block=wrapper.content;
      if(block.type==='tool_result')continue;
      if(block.type==='interrupt')continue;
      if(block.type==='llm_error'||block.type==='tool_use'&&interactive.has(block.name)||block.type==='text'&&important.test(block.text))noticeBlocks.push(wrapper);
      else if(block.type==='tool_use'||block.type==='thinking')detailBlocks.push(wrapper);
      else if(!hasTools||(!busy&&!stopped&&!result?.is_error&&!hasTool&&index===finalIndex))answerBlocks.push(wrapper);
      else detailBlocks.push(wrapper);
    }
    if(detailBlocks.length)details.push(subset(message,detailBlocks));
    if(noticeBlocks.length)notices.push(subset(message,noticeBlocks));
    if(answerBlocks.length)answers.push(subset(message,answerBlocks));
    const flowBlocks=items.filter(wrapper=>detailBlocks.includes(wrapper)||noticeBlocks.includes(wrapper));
    if(flowBlocks.length)timeline.push(subset(message,flowBlocks));
  });
  const failures=[...tools].flatMap(([id,{name,wrapper,input}])=>{
    const value=wrapper.getToolResultValue();
    if(!value?.is_error)return [];
    const full=contentText(value?.content??value).replace(/<\/?tool_use_error>/g,'').trim();
    // If the command itself contains an optional-tool probe and its only error
    // is `<name> not found`, the probe is the cause. Do not report the whole
    // diagnostic call as a failed task.
    const probeCommand=typeof input?.command==='string'&&/(?:^|[;&|]\s*)(?:which|command\s+-v|type)\s+/i.test(input.command);
    if(probeCommand&&/(?:^|\n)[a-z0-9._-]+ not found$/i.test(full))return [];
    if(expectedFailure(full))return [];
    const lines=full.split('\n').map(line=>line.trim()).filter(Boolean),first=lines[0]||'工具执行失败';
    const archiveWrite=/write error \(disk full\?\)|fchmod \(file attributes\) error|is probably truncated/i.test(full);
    const detail=lines.slice(1).find(line=>/error|failed|denied|not found|异常|失败/i.test(line));
    const summary=archiveWrite?first+' · 归档解压写入失败；macOS 中文文件名请改用 ditto，并检查磁盘空间':/^Exit code \d+$/i.test(first)&&detail?first+' · '+detail:first;
    return [{id,name,summary:summary.slice(0,180)}];
  });
  const resultError=result?.is_error?(text(result)||'任务执行失败，请查看上方步骤或工具终端输出。'):'';
  // Some SDK providers return the final text only in result.result.
  const resultText=result?text(result):'';
  if(result&&!result.is_error&&!answers.length&&resultText.trim()&&!notices.some(message=>text(message).trim()===resultText.trim()))answers.push(new Message('assistant',{role:'assistant',content:resultText},result.timestamp));
  let running:RunningTool|undefined;
  if(status==='running')for(const {name,wrapper,input,since,child} of tools.values())if(!wrapper.getToolResultValue())running={...toolLabel(name,input),since,parent:!child};
  const last=messages.at(-1);
  return {details,notices,answers,timeline,failures,resultError,status,toolCount:tools.size,running,lastActivity:last?stamp(last.timestamp):Date.now()};
}

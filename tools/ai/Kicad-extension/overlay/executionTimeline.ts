import {Message} from '../models/Message';
import type {ContentBlockWrapper} from '../models/ContentBlockWrapper';

export interface ExecutionRow {key:string;messages:Message[];active:boolean}
export type ExecutionStatus='running'|'completed'|'failed'|'stopped'|'ended';
export type TimelineRow = {kind:'message';key:string;message:Message} | ({kind:'execution'} & ExecutionRow);
const notifications=/<(?:task|agent|bash)-notification>[\s\S]*?<\/(?:task|agent|bash)-notification>/;
const important=/^\s*(?:#{1,6}\s*)?(?:【(?:重要问题|需要确认|阻塞问题|风险提示)】|\[(?:Important|Action required|Blocked)\])/im;
const interactive=new Set(['AskUserQuestion','ExitPlanMode','EnterPlanMode']);
const blocks=(message:Message):ContentBlockWrapper[]=>Array.isArray(message.message.content)?message.message.content:[];
const contentText=(value:any):string=>typeof value==='string'?value:Array.isArray(value)?value.map(v=>typeof v==='string'?v:v?.text||'').join('\n'):'';
const text=(message:Message)=>typeof message.message.content==='string'?message.message.content:contentText(blocks(message).map(w=>w.content));
function userRequest(message:Message){
  return message.type==='user'&&!message.parentToolUseId&&!message.isEmpty&&!notifications.test(text(message));
}
export function executionRows(messages:Message[]):TimelineRow[]{
  const rows:TimelineRow[]=[];
  let current:Extract<TimelineRow,{kind:'execution'}>|undefined;
  messages.forEach((message,index)=>{
    if(userRequest(message)||message.type==='slash_command_result'){
      if(current)current.active=false;
      current=undefined;
      rows.push({kind:'message',key:'message-'+index,message});
      return;
    }
    // Tool results and SDK notifications belong to their request, never a new user turn.
    if(!current){current={kind:'execution',key:'execution-'+index,messages:[],active:true};rows.push(current);}
    current.messages.push(message);
  });
  return rows;
}
function subset(message:Message,content:ContentBlockWrapper[]):Message{
  return new Message(message.type,{role:message.message.role,content},message.timestamp,{parentToolUseId:message.parentToolUseId});
}
export function executionView(messages:Message[],busy:boolean,disconnected=false){
  const tools=new Map<string,{name:string;wrapper:ContentBlockWrapper}>();
  let lastTool=-1,result:Message|undefined,resultIndex=messages.length;
  let stopped=disconnected;
  messages.forEach((message,index)=>{
    if(message.type==='result'&&!message.parentToolUseId){result=message;resultIndex=index;}
    for(const wrapper of blocks(message)){
      const block=wrapper.content;
      if(block.type==='tool_use'){
        tools.set(block.id,{name:block.name,wrapper});
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
  const details:Message[]=[],notices:Message[]=[],answers:Message[]=[];
  messages.forEach((message,index)=>{
    if(message.type==='result')return;
    const items=blocks(message);
    if(message.parentToolUseId){if(!message.isEmpty)details.push(message);return;}
    if(message.type==='tip'||message.type==='system'){
      // Keep the stop marker in the session data for turn status, without a
      // standalone interruption banner in the conversation.
      if(items.length && items.every(w=>w.content.type==='interrupt'))return;
      notices.push(message);return;
    }
    if(message.type!=='assistant'){
      if(!message.isEmpty)details.push(message);
      return;
    }
    // Child-agent chatter stays in the execution record, not in the main answer.
    if(typeof message.message.content==='string'){
      if(important.test(message.message.content))notices.push(message);
      else if(!hasTools||(!busy&&!stopped&&!result?.is_error&&index===finalIndex))answers.push(message);
      else details.push(message);
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
  });
  const failures=[...tools].flatMap(([id,{name,wrapper}])=>{
    const value=wrapper.getToolResultValue();
    if(!value?.is_error)return [];
    const full=contentText(value.content).replace(/<\/?tool_use_error>/g,'').trim();
    return [{id,name,summary:(full.split('\n').find(line=>line.trim())||'工具执行失败').slice(0,180)}];
  });
  const resultError=result?.is_error?(text(result)||'任务执行失败，请展开执行记录查看详情。'):'';
  // Some SDK providers return the final text only in result.result.
  const resultText=result?text(result):'';
  if(result&&!result.is_error&&!answers.length&&resultText.trim()&&!notices.some(message=>text(message).trim()===resultText.trim()))answers.push(new Message('assistant',{role:'assistant',content:resultText},result.timestamp));
  return {details,notices,answers,failures,resultError,status,toolCount:tools.size};
}

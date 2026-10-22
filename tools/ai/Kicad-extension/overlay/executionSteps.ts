import {Message} from '../models/Message';
import type {ContentBlockWrapper} from '../models/ContentBlockWrapper';

// The expanded execution record as a Claude Code style timeline: one row per thought,
// tool call or progress text, with each tool's input and output. Subagent rows nest
// under the Task/Agent call that started them.
export type StepStatus='running'|'success'|'error'|'stopped';
export interface ThoughtStep {kind:'thought';key:string;text:string;seconds?:number}
export interface TextStep {kind:'text';key:string;wrapper:ContentBlockWrapper}
export interface OtherStep {kind:'other';key:string;message:Message}
export interface ToolStep {kind:'tool';key:string;id:string;name:string;label:string;summary:string;input:string;output:string;status:StepStatus;rich:boolean;wrapper:ContentBlockWrapper;children:Step[]}
export type Step=ThoughtStep|TextStep|OtherStep|ToolStep;

// Edits, writes and todo lists keep their dedicated diff/list renderers inside the row.
const RICH=new Set(['Edit','MultiEdit','Write','NotebookEdit','TodoWrite','ExitPlanMode']);
const AGENT=new Set(['Task','Agent']);
const OUTPUT_LIMIT=200*1024;
const blocks=(message:Message):ContentBlockWrapper[]=>Array.isArray(message.message.content)?message.message.content:[];
const oneLine=(value:unknown,limit=160)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,limit);
export const shortPath=(file:string)=>{const parts=String(file||'').split('/').filter(Boolean);return parts.length>3?'…/'+parts.slice(-3).join('/'):String(file||'');};
const json=(value:unknown)=>{try{return JSON.stringify(value,null,2)??'';}catch{return String(value);}};
// Arguments read on one line when collapsed and wrap when the card opens.
const compact=(value:unknown)=>{try{return JSON.stringify(value)??'';}catch{return String(value);}};
function contentText(value:any):string{
  if(typeof value==='string')return value;
  if(Array.isArray(value))return value.map(item=>typeof item==='string'?item:item?.type==='text'?item.text||'':item?.type==='image'?'[图片]':'').filter(Boolean).join('\n');
  return value===undefined||value===null?'':json(value);
}
// JSON results (KiCad tools) read better indented; large ones stay as sent.
function readable(text:string){
  const trimmed=text.replace(/<\/?tool_use_error>/g,'').trim();
  if(trimmed.length>OUTPUT_LIMIT||!/^[[{]/.test(trimmed))return trimmed;
  try{return JSON.stringify(JSON.parse(trimmed),null,2);}catch{return trimmed;}
}
function mcpParts(name:string){const parts=name.split('__');return parts.length>=3?{server:parts[1],tool:parts.slice(2).join('__')}:{server:'',tool:name};}

/** Bold name, grey summary and the IN text of one tool call. */
export function describeTool(name:string,input:any){
  const i=input&&typeof input==='object'?input:{};
  switch(name){
    case 'Bash':return {label:'Bash',summary:oneLine(i.description||String(i.command||'').split('\n')[0]),input:String(i.command??'')};
    case 'Read':return {label:'Read',summary:shortPath(i.file_path)+(i.offset||i.limit?` · ${i.offset??1}${i.limit?'–'+((i.offset??1)+i.limit-1):''} 行`:''),input:String(i.file_path??'')};
    case 'Grep':return {label:'Grep',summary:oneLine(`"${i.pattern??''}"`+(i.path?' · '+shortPath(i.path):'')+(i.glob?' · '+i.glob:'')),input:[i.pattern,i.path&&'path: '+i.path,i.glob&&'glob: '+i.glob,i.type&&'type: '+i.type,i.output_mode&&'mode: '+i.output_mode,i['-i']&&'ignore case'].filter(Boolean).join('\n')};
    case 'Glob':return {label:'Glob',summary:oneLine(String(i.pattern??'')+(i.path?' · '+shortPath(i.path):'')),input:[i.pattern,i.path&&'path: '+i.path].filter(Boolean).join('\n')};
    case 'WebFetch':return {label:'WebFetch',summary:oneLine(i.url),input:[i.url,i.prompt].filter(Boolean).join('\n')};
    case 'WebSearch':return {label:'WebSearch',summary:oneLine(i.query),input:String(i.query??'')};
    case 'Task':case 'Agent':return {label:'Agent',summary:oneLine([i.description,i.subagent_type&&'('+i.subagent_type+')'].filter(Boolean).join(' ')),input:String(i.prompt??'')};
    case 'Edit':case 'MultiEdit':case 'Write':case 'NotebookEdit':return {label:name,summary:shortPath(i.file_path||i.notebook_path),input:''};
    case 'TodoWrite':return {label:'Update Todos',summary:'',input:''};
  }
  if(name.startsWith('mcp__')){
    const {tool}=mcpParts(name);
    if(tool==='capability_search')return {label:'capability_search',summary:oneLine([i.query&&`"${i.query}"`,i.kind,i.server].filter(Boolean).join(' · ')),input:compact(i)};
    if(tool==='capability_call'){
      const args=i.arguments&&typeof i.arguments==='object'?i.arguments:{};
      return {label:String(i.id||'capability_call').replace(/^(?:tool|skill):/,'').replace(/^mcp:[^:]+:/,''),summary:oneLine(args.action||args.operation||args.query||args.id||''),input:compact(args)};
    }
    const first=Object.values(i).find(value=>typeof value==='string');
    return {label:tool,summary:oneLine(i.action||i.description||first||''),input:compact(i)};
  }
  const first=i.description||i.command||i.file_path||i.pattern||i.url||i.query||i.action;
  return {label:name,summary:oneLine(first||''),input:Object.keys(i).length?compact(i):''};
}

function toolOutput(wrapper:ContentBlockWrapper){
  const result=wrapper.getToolResultValue();
  let text=contentText(result?.content);
  const extra=wrapper.toolUseResult;
  if(!text&&extra&&typeof extra==='object')text=[extra.stdout,extra.stderr].filter(Boolean).join('\n')||'';
  return {text:readable(text),error:!!result?.is_error,done:!!result};
}

/** Builds timeline rows from the execution details of one request. */
export function executionSteps(details:Message[],busy:boolean,startedAt?:number):Step[]{
  const top:Step[]=[],tools=new Map<string,ToolStep>();
  // A thought lasts from the previous event (or the start of the turn) to its message.
  let previous:number|undefined=startedAt;
  details.forEach((message,index)=>{
    const parent=message.parentToolUseId?tools.get(message.parentToolUseId):undefined;
    const target=parent?parent.children:top;
    const prefix='m'+index+'-';
    if(typeof message.message.content==='string'||message.type!=='assistant'){
      if(!message.isEmpty)target.push({kind:'other',key:prefix+'other',message});
      previous=message.timestamp;return;
    }
    blocks(message).forEach((wrapper,position)=>{
      const block:any=wrapper.content,key=prefix+position;
      if(block.type==='thinking'){
        const seconds=previous!==undefined&&message.timestamp>previous?Math.max(1,Math.round((message.timestamp-previous)/1000)):undefined;
        target.push({kind:'thought',key,text:String(block.thinking??''),seconds});
      }else if(block.type==='tool_use'){
        const described=describeTool(block.name,block.input),output=toolOutput(wrapper);
        const status:StepStatus=output.done?output.error?'error':'success':busy?'running':'stopped';
        const step:ToolStep={kind:'tool',key,id:block.id,name:block.name,...described,output:output.text,status,rich:RICH.has(block.name),wrapper,children:[]};
        tools.set(block.id,step);target.push(step);
      }else if(block.type==='text'){
        if(String(block.text??'').trim())target.push({kind:'text',key,wrapper});
      }else if(block.type!=='tool_result'&&block.type!=='interrupt'){
        target.push({kind:'other',key,message:new Message(message.type,{role:message.message.role,content:[wrapper]},message.timestamp,{parentToolUseId:message.parentToolUseId})});
      }
    });
    previous=message.timestamp;
  });
  return top;
}
export const isAgentTool=(name:string)=>AGENT.has(name);
/** Tool calls in a step list, including nested subagent calls. */
export const countTools=(steps:Step[]):number=>steps.reduce((sum,step)=>sum+(step.kind==='tool'?1+countTools(step.children):0),0);

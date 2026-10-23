import {redact} from './diagnostics.ts';

// Plain terminal text only: tool output cannot execute OSC links, clipboard
// writes, cursor controls or shell input. The original events stay in history.
export function terminalText(value:unknown){
  const text=typeof value==='string'?value:JSON.stringify(value??'');
  const safe=redact(text,256*1024).replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\|$)/g,'')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\r\n?/g,'\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,'');
  return safe+(text.length>256*1024?'\n[Output preview truncated; full result is available in session_history]':'');
}

/** Formats complete SDK messages, not token deltas; each tool stage prints once. */
export class ExecutionOutput {
  private seen=new Set<string>();
  private write:(text:string)=>void;
  constructor(write:(text:string)=>void){this.write=write;}
  observe(message:any){
    const session=String(message.session_id||'session');
    if(message.type==='system'&&message.subtype==='init')this.emit(session+':init','\n['+session+'] '+(message.cwd||'')+'\n');
    for(const block of Array.isArray(message.message?.content)?message.message.content:[]){
      if(block.type==='tool_use')this.emit(session+':'+block.id+':start','\n['+session+'] '+block.name+' #'+block.id+'\n'+terminalText(block.input)+'\n');
      if(block.type==='tool_result'){
        const content=Array.isArray(block.content)?block.content.map((part:any)=>part.type==='text'?part.text:'['+(part.type||'content')+']').join('\n'):block.content;
        this.emit(session+':'+block.tool_use_id+':result','['+session+'] #'+block.tool_use_id+' '+(block.is_error?'FAILED':'returned')+'\n'+terminalText(content)+'\n');
      }
    }
    if(message.type==='result'&&message.is_error)this.emit(session+':'+(message.uuid||message.duration_ms)+':error','['+session+'] '+terminalText(message.errors||message.subtype)+'\n');
  }
  private emit(key:string,text:string){
    if(this.seen.has(key))return;
    this.seen.add(key);if(this.seen.size>4096)this.seen.delete(this.seen.values().next().value!);
    this.write(text);
  }
}

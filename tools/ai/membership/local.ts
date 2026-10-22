// Local CLI authentication stays owned by the vendor CLI. Never log credentials.
import {spawn,execFile} from 'node:child_process';
import {existsSync,constants,accessSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
export function executable(name:string){
  const override=process.env[name==='codex'?'KICAD_CODEX_PATH':'KICAD_CLAUDE_PATH'];
  for(const file of override?[override]:[...(process.env.PATH||'').split(path.delimiter),path.join(os.homedir(),'.local/bin'),'/opt/homebrew/bin','/usr/local/bin'].map(dir=>path.join(dir,name))){try{accessSync(file,constants.X_OK);return file;}catch{}}
  return undefined;
}
export function membershipEnvironment(input:NodeJS.ProcessEnv=process.env){
  const env={...input};
  for(const key of Object.keys(env))if(/^(ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY$)/.test(key))delete env[key];
  return env;
}
export class CodexClient {
  private child:ReturnType<typeof spawn>;
  private closed=false;
  private counter=0;private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  onClose:(error:Error)=>void=()=>{};
  onEvent:(method:string,params:any)=>void=()=>{};
  onRequest:(method:string,params:any)=>Promise<any>=async()=>{throw Error('Unsupported server request');};
  constructor(cwd=process.cwd()){
    const bin=executable('codex');if(!bin)throw Error('未找到本地 Codex CLI，请安装并执行 codex login。');
    this.child=spawn(bin,['app-server'],{cwd,env:membershipEnvironment(),stdio:['pipe','pipe','pipe']});
    this.child.stderr?.resume();
    this.child.stdin?.on('error',error=>this.fail(error));
    createInterface({input:this.child.stdout!}).on('line',line=>{let msg:any;try{msg=JSON.parse(line);}catch{return;}
      if(msg.method){if(msg.id!==undefined)void this.onRequest(msg.method,msg.params).then(result=>this.write({id:msg.id,result}),()=>this.write({id:msg.id,error:{code:-32603,message:'KiCad client rejected request'}}));else this.onEvent(msg.method,msg.params);}
      else {const pending=this.pending.get(msg.id);if(!pending)return;this.pending.delete(msg.id);clearTimeout(pending.timer);msg.error?pending.reject(Error(msg.error.message)):pending.resolve(msg.result);}
    });
    this.child.on('error',error=>this.fail(error));this.child.on('exit',()=>{const error=Error('Codex app-server 已退出。');this.fail(error);this.onClose(error);});
  }
  private write(value:any){if(!this.closed&&!this.child.stdin?.destroyed&&!this.child.stdin?.writableEnded)this.child.stdin?.write(JSON.stringify(value)+'\n');}
  private fail(error:Error){this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
  async init(){await this.call('initialize',{clientInfo:{name:'kicad',title:'KiCad',version:'0.4.33'},capabilities:{experimentalApi:true}});this.write({method:'initialized'});return this;}
  call(method:string,params:any={},timeout=20000):Promise<any>{if(this.closed)return Promise.reject(Error('Codex client closed'));const id=++this.counter;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Codex '+method+' 超时'));},timeout);this.pending.set(id,{resolve,reject,timer});this.write({id,method,params});});}
  close(){this.fail(Error('Codex client closed'));this.child.stdin?.end();this.child.kill();}
}
export async function probeCodex(cwd?:string){const client=new CodexClient(cwd);try{await client.init();const account=(await client.call('account/read',{refreshToken:false})).account;let cursor:string|undefined;const models:any[]=[];
  do{const page=await client.call('model/list',{includeHidden:false,...(cursor?{cursor}:{})});models.push(...page.data);cursor=page.nextCursor;}while(cursor);
  return {account:{type:account?.type||'none',planType:account?.planType},models:account?.type==='chatgpt'?models:[]};
}finally{client.close();}}
export function probeClaude(cwd=process.cwd()):Promise<any>{return new Promise((resolve,reject)=>{
  const bin=executable('claude');if(!bin){reject(Error('未找到本地 Claude Code，请安装并登录。'));return;}
  // Model discovery must never activate the CLI's own MCP/skill registries.
  const child=spawn(bin,['--input-format','stream-json','--output-format','stream-json','--verbose','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands','--disallowedTools','Skill'],{cwd,env:membershipEnvironment(),stdio:['pipe','pipe','pipe']});
  let settled=false;const finish=(error?:Error,value?:any)=>{if(settled)return;settled=true;clearTimeout(timer);child.stdin.end();child.kill();error?reject(error):resolve(value);};
  const timer=setTimeout(()=>finish(Error('Claude 模型发现超时')),15000);child.stderr.resume();child.on('error',e=>finish(e));child.on('exit',()=>finish(Error('Claude 模型发现进程退出')));
  createInterface({input:child.stdout}).on('line',line=>{let msg:any;try{msg=JSON.parse(line);}catch{return;}
    if(msg.type!=='control_response'||msg.response?.request_id!=='kicad-models')return;
    const data=msg.response.response;if(!data)return finish(Error(msg.response.error||'Claude discovery failed'));
    const account=data.account||{};finish(undefined,{models:data.models||[],account:{subscriptionType:account.subscriptionType,apiProvider:account.apiProvider}});
  });
  child.stdin.write(JSON.stringify({type:'control_request',request_id:'kicad-models',request:{subtype:'initialize'}})+'\n');
});}
export function claudeModels(models:any[]){const seen=new Set<string>();return models.flatMap(m=>{const id=m.resolvedModel||m.value;if(!id||seen.has(id))return [];seen.add(id);return [{value:id,displayName:(m.description?.split(' · ')[0]||m.displayName||id),description:m.description,aliases:models.filter(a=>(a.resolvedModel||a.value)===id).map(a=>a.value)}];});}
export async function discoverMembership(cwd?:string){const [claude,codex]=await Promise.allSettled([probeClaude(cwd),probeCodex(cwd)]);return {
  supportedModels:[...(claude.status==='fulfilled'?claudeModels(claude.value.models):[]),...(codex.status==='fulfilled'?codex.value.models.map((m:any)=>({value:'codex:'+m.model,displayName:m.displayName.replace(/^(GPT-[\d.]+)-/, '$1 '),description:m.description})):[])],
  accounts:{claude:claude.status==='fulfilled'?claude.value.account:{error:claude.reason.message},codex:codex.status==='fulfilled'?codex.value.account:{error:codex.reason.message}}
};}

// Used only by text-only auxiliary requests and the terminal's native model
// transport. Refresh remains owned by Codex; no token is copied into app config.
export async function codexAccess(){
 const client=await new CodexClient().init();try{const {account}=await client.call('account/read',{refreshToken:true});if(account?.type!=='chatgpt')throw Error('请使用 codex login 登录 ChatGPT 会员。');}finally{client.close();}
 const {readFile}=await import('node:fs/promises');
 const auth=JSON.parse(await readFile(path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'auth.json'),'utf8'));
 if(!auth.tokens?.access_token)throw Error('本地 Codex 凭据不可用，请重新执行 codex login。');
 return auth.tokens as {access_token:string;account_id?:string};
}
export async function codexText(model:string,prompt:string,instructions:string,signal:AbortSignal){
 const token=await codexAccess();if(signal.aborted)throw Error('已取消');
 const response=await fetch('https://chatgpt.com/backend-api/codex/responses',{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json',authorization:'Bearer '+token.access_token,...(token.account_id?{'chatgpt-account-id':token.account_id}:{})},body:JSON.stringify({model:model.replace(/^codex:/,''),instructions,input:[{role:'user',content:[{type:'input_text',text:prompt}]}],tools:[],store:false,stream:true})});
 if(!response.ok)throw Error('Codex 会员请求失败：HTTP '+response.status);
 if(!response.body)throw Error('Codex 未返回响应流');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',text='',completed=false;
 try{for(;;){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trimEnd();buffer=buffer.slice(end+1);if(!line.startsWith('data: '))continue;const raw=line.slice(6);if(raw==='[DONE]')continue;const event=JSON.parse(raw);if(event.type==='response.output_text.delta')text+=event.delta;if(event.type==='response.completed')completed=true;if(['response.failed','response.incomplete','error'].includes(event.type))throw Error('Codex 请求未完成：'+(event.response?.error?.code||event.type));}}}finally{reader.releaseLock();}
 if(!completed)throw Error('Codex 响应中断，未收到完成确认。');return text;
}

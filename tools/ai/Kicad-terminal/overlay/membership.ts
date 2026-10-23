import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {probeClaude,probeCodex,claudeModels,codexAccess} from '../../membership/local';
const exec=promisify(execFile);
const CODEX='kicad-codex',CLAUDE='kicad-claude';
// Access tokens are read only into memory; no credential copy is persisted.
export async function membershipConfig(client:any,config:any){
 if(process.env.KICAD_LOCAL_MEMBERSHIP==='0')return;
 const results=await Promise.allSettled([probeClaude(),probeCodex()]);
 config.provider??={};
 const c=results[0],o=results[1];
 if(c.status==='fulfilled'&&c.value.account.subscriptionType){

  config.provider[CLAUDE]={npm:'@ai-sdk/anthropic',name:'Claude · 本地会员',options:{baseURL:'https://api.anthropic.com/v1',...await (await ClaudeMembership()).auth.loader()},models:Object.fromEntries(claudeModels(c.value.models).map(m=>[m.value,{name:m.displayName,reasoning:true,tool_call:true,limit:{context:200000,output:32000}}]))};
 }
 if(o.status==='fulfilled'&&o.value.account.type==='chatgpt'){

  config.provider[CODEX]={npm:'@ai-sdk/openai',name:'Codex · ChatGPT 本地会员',options:{baseURL:'https://chatgpt.com/backend-api/codex',...await (await CodexMembership()).auth.loader()},models:Object.fromEntries(o.value.models.map((m:any)=>[m.model,{name:m.displayName.replace(/^(GPT-[\d.]+)-/, '$1 '),reasoning:true,tool_call:true,limit:{context:200000,output:32000},variants:Object.fromEntries((m.supportedReasoningEfforts||[]).map((e:any)=>[e.reasoningEffort,{reasoningEffort:e.reasoningEffort}]))}]))};
 }
}
async function claudeCredential(){
 let value:any;
 if(process.platform==='darwin'){
  const {stdout}=await exec('/usr/bin/security',['find-generic-password','-s','Claude Code-credentials','-w'],{maxBuffer:1024*1024});value=JSON.parse(stdout);
 }else value=JSON.parse(await fs.readFile(path.join(process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'.credentials.json'),'utf8'));
 const auth=value.claudeAiOauth;
 if(!auth?.accessToken)throw Error('本地 Claude 会员凭据不可用，请运行 claude 登录。');
 if(auth.expiresAt&&auth.expiresAt<Date.now())throw Error('Claude 登录凭据已过期，请在本地 Claude Code 中刷新登录后重试。');
 return auth.accessToken;
}
export const ClaudeMembership=async()=>({auth:{provider:CLAUDE,methods:[],loader:async()=>({apiKey:'local-membership',fetch:async(input:any,init:any={})=>{
 const url=new URL(typeof input==='string'?input:input.url||input);if(url.origin!=='https://api.anthropic.com')throw Error('Refusing to send membership credentials to another host');
 const headers=new Headers(init.headers);headers.delete('x-api-key');headers.set('authorization','Bearer '+await claudeCredential());headers.set('anthropic-beta',Array.from(new Set([...(headers.get('anthropic-beta')||'').split(',').filter(Boolean),'oauth-2025-04-20'])).join(','));
 return explainClaudeRejection(await fetch(url,{...init,headers,redirect:'error'}));
}})}});
// The API answers subscription credentials it will not serve here with a bare "Error" body, which
// OpenCode retried five times without showing a reason. Report it once (403 is not retried) with
// what still works; real rate limits and server errors keep their own status and message.
export async function explainClaudeRejection(response:Response):Promise<Response>{
 if(response.ok)return response;
 let message='';try{message=String(JSON.parse(await response.clone().text())?.error?.message||'');}catch{}
 if(message&&message!=='Error'||!message&&response.status>=500)return response;
 return new Response(JSON.stringify({type:'error',error:{type:'permission_error',message:'Claude 会员请求被 Anthropic 拒绝（HTTP '+response.status+'，未返回原因）。本机 Claude 会员通过 Claude Code 使用：请在 Kicad 扩展中选择 Claude 模型，或在终端改用 Codex 会员、DeepSeek 或 API Key 模型。'}}),{status:403,headers:{'content-type':'application/json'}});
}
export const CodexMembership=async()=>({auth:{provider:CODEX,methods:[],loader:async()=>({apiKey:'local-membership',fetch:async(input:any,init:any={})=>{
 const url=new URL(typeof input==='string'?input:input.url||input);if(url.origin!=='https://chatgpt.com'||!url.pathname.startsWith('/backend-api/codex/'))throw Error('Refusing to send membership credentials to another host');
 const tokens=await codexAccess();const headers=new Headers(init.headers);headers.set('authorization','Bearer '+tokens.access_token);if(tokens.account_id)headers.set('chatgpt-account-id',tokens.account_id);headers.set('originator','kicad');
 const body=typeof init.body==='string'?JSON.parse(init.body):{};body.store=false;body.stream=true;body.instructions??='You are a helpful coding and KiCad assistant.';
 for(const key of ['max_output_tokens','temperature','top_p'])delete body[key];
 return fetch(url,{...init,body:JSON.stringify(body),headers,redirect:'error'});
}})}});

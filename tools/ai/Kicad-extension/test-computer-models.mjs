// Opt-in live acceptance: real local model routes + production Cua adapter.
// Restricts execution to one disposable KiCad window; never runs in the build.
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {DemandCatalog,demandDefinitions,normalizeCapabilityCall} from '../composer/demand.ts';
import {mcpResult} from '../composer/tool-result.ts';
import {discoverMembership,membershipEnvironment,executable} from '../membership/local.ts';
import {resolveSettings,assertModelAllowed,capEffort} from '../composer/settings.ts';
import {autoDecision} from '../composer/permission-gates.ts';
const [root,cwd,pidText,windowText,out]=process.argv.slice(2),pid=+pidText,windowId=+windowText;
if(!cwd?.startsWith('/tmp/kicad-cua-fixture')||!pid||!windowId)throw Error('Pass the disposable fixture, pid and window ID');
fs.mkdirSync(out,{recursive:true});
const require=createRequire(path.join(root,'package.json')),ts=require('typescript'),sdk=await import(pathToFileURL(require.resolve('@anthropic-ai/claude-agent-sdk')).href),z=require('zod').z;
const config={'computer.enabled':true,'mcp.sync':[],'subagents.enabled':false};
const vscode={ConfigurationTarget:{Global:1},workspace:{isTrusted:true,getConfiguration:()=>({get:(key,fallback)=>config[key]??fallback})},extensions:{getExtension:()=>({extensionPath:root})},Uri:{file:p=>({fsPath:p,toString:()=>pathToFileURL(p).href})},window:{showErrorMessage(){},showWarningMessage(){},showInformationMessage(){}}};
let active,trace=[];
const settings={mcpMode:'onDemand',disabledServers:[],skillsMode:'off',disabledSkills:[],skillRoots:[],subagents:false,disabledSections:[]};
function createCatalog(){
 const c=computer.computerCapabilities();active=c;
 const caps=c.capabilities.map(cap=>({...cap,execute:async(args,ctx)=>{
  if(cap.name!=='computer_tools'){
   if(!['get_window_state','click'].includes(args.name)||args.arguments?.pid!==pid||args.arguments?.window_id!==windowId)throw Error('Acceptance only allows get_window_state/click on the disposable fixture.');
   if(args.name==='get_window_state')Object.assign(args.arguments,{query:'Locked items',tree_format:'elements',max_dimension:800});
  }
  const result=await cap.execute(args,ctx),data=result?.structuredContent||{};
  trace.push({tool:cap.name,args,image:result?.content?.some(b=>b.type==='image')||false,ok:!result?.isError,data});
  return result;
 }}));
 const catalog=new DemandCatalog({cwd,mcp:false,skills:false,builtins:async()=>caps,maxResults:5});const close=catalog.close.bind(catalog);catalog.close=async()=>{await c.close();await close();};return catalog;
}
const overrides={
 'vscode':vscode,'@anthropic-ai/claude-agent-sdk':sdk,
 './kicadRuntime':{createDemandCatalog:createCatalog,withSyncedServers:async(cwd,servers)=>servers,READ_ONLY_EDA_TOOLS:[],kicadToolSettings:()=>settings,kicadPromptFeatures:()=>({}),kicadDemandGuidance:()=> 'Computer tools are available on demand. Never use shell, files or other apps.'},
 './kicadToolOutput':{recordToolOutput(){}},
 './kicadSettings':{agentSettings:()=>({settings:resolveSettings([])})},
 './shared/kicadSettings':{assertModelAllowed,capEffort},'./shared/kicadPermissionGates':{autoDecision},
 './services/claude/sessionContinuity':{SessionContinuity:class{configure(){}async observe(){}async recordInput(){}delegationRequested(){return false;}async prompt(){return {hookSpecificOutput:{additionalContext:'Isolated computer-control acceptance. No sub-agents. No shell or files.'}};}beforeTool(){return {continue:true};}async afterTool(){}failedTool(){}async diagnosticError(){}validateAnswer(t,i,r){return r;}}}
};
const cache=new Map();function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;const mod={exports:{}};cache.set(file,mod);const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;vm.runInNewContext(js,{module:mod,exports:mod.exports,process,console,Buffer,URL,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,require:name=>overrides[name]??(name.startsWith('./')||name.startsWith('../')?load(path.resolve(path.dirname(file),name+'.ts')):require(name))},{filename:file});return mod.exports;}
const computer=load('src/kicadComputerUse.ts'),{codexQuery}=load('src/kicadCodex.ts'),providers=load('src/kicadProviders.ts');
const creds=await providers.resolveDeepSeekCredentials();
const membership=await discoverMembership(cwd),models=[...membership.supportedModels.map(m=>m.value),...providers.DEEPSEEK_MODELS.map(m=>m.id)];
const board=path.join(cwd,'computer-control.kicad_pcb'),hash=()=>createHash('sha256').update(fs.readFileSync(board)).digest('hex'),initialHash=hash(),matrix=[];
const state=async(screenshot=false)=>{const s=computer.computerCapabilities();try{return await s.capabilities.find(c=>c.name==='computer_read').execute({name:'get_window_state',arguments:{pid,window_id:windowId,query:'Locked items',tree_format:'elements',include_screenshot:screenshot,max_dimension:800}},{});}finally{await s.close();}};
const value=result=>result?.structuredContent?.elements?.find(e=>e.label==='Locked items')?.value;
async function restore(expected){const c=computer.computerCapabilities();try{const read=c.capabilities.find(c=>c.name==='computer_read'),action=c.capabilities.find(c=>c.name==='computer_action');const r=await read.execute({name:'get_window_state',arguments:{pid,window_id:windowId,query:'Locked items',tree_format:'elements',include_screenshot:false}},{});if(value(r)!==expected){const e=r.structuredContent.elements.find(e=>e.label==='Locked items');await action.execute({name:'click',arguments:{pid,window_id:windowId,element_token:e.element_token}},{});}}finally{await c.close();}}
for(const model of models){
 if(process.env.KICAD_CUA_MODEL_FILTER&&!model.match(process.env.KICAD_CUA_MODEL_FILTER))continue;
 trace=[];const start=Date.now(),before=value(await state()),vision=!model.startsWith('deepseek'),row={model,route:model.startsWith('codex:')?'production codexQuery/app-server':'Claude Agent SDK / Anthropic-compatible',vision,before};
 const prompt=`This is a real KiCad computer-control acceptance test. Use only the on-demand computer capabilities. The disposable PCB Editor pid is ${pid}, exact window_id ${windowId}. First search for computer tools, discover the get_window_state and click schemas if needed, then call computer_read get_window_state with pid/window_id, query "Locked items", tree_format "elements", include_screenshot:${vision}, max_dimension:800. Find the element_token for AXCheckBox "Locked items". Call computer_action click ONCE using that exact token and pid/window_id. Then computer_read the same window again with since:"latest", same query/tree_format and include_screenshot:${vision} and confirm its value changed. Stop after this readback. Do not restore (test harness restores), do not change any file, do not use a shell, sub-agent, other tools, menus or other windows. Never guess tokens.`;
 let query,timer;row.events=[];row.messages=[];row.toolErrors=[];try{
  const inputStream={async *[Symbol.asyncIterator](){yield {type:'user',message:{role:'user',content:prompt},parent_tool_use_id:null,session_id:''};}};
  if(model.startsWith('codex:'))query=await codexQuery({cwd,resume:null,model,permissionMode:'acceptEdits',reasoningLevel:'low',mcpServers:{},inputStream,canUseTool:async(name,args)=>({behavior:name==='computer_action'?'allow':'deny',updatedInput:args})});
  else{
   if(model.startsWith('deepseek')&&!creds)throw Error('No configured DeepSeek credentials');
   const catalog=createCatalog(),server=sdk.createSdkMcpServer({name:'kicad',version:'0.4.65',tools:[sdk.tool('capability_search',demandDefinitions[0].description,{query:z.string(),kind:z.enum(['tool','skill','server']).optional()},async args=>mcpResult(await catalog.search(args))),sdk.tool('capability_call',demandDefinitions[1].description,{id:z.string(),arguments:z.record(z.unknown())},async(args,extra)=>{const call=normalizeCapabilityCall(args.id,args.arguments);return mcpResult(await catalog.call(call.id,call.args,{signal:extra?.signal}));})]});
   const env=membershipEnvironment();if(model.startsWith('deepseek'))Object.assign(env,{ANTHROPIC_AUTH_TOKEN:creds.apiKey,ANTHROPIC_BASE_URL:creds.baseUrl,ANTHROPIC_MODEL:model,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
   const native=sdk.query({prompt:inputStream,options:{cwd,model,env,tools:[],mcpServers:{kicad:server},stderr:chunk=>{row.stderr=((row.stderr||'')+chunk).slice(-6000).replace(/(sk-|Bearer )[A-Za-z0-9_-]+/g,'[redacted]');},strictMcpConfig:true,settingSources:[],maxTurns:10,permissionMode:'default',pathToClaudeCodeExecutable:executable('claude')||path.join(root,'resources/claude-code/cli.js'),canUseTool:async(name,input)=>({behavior:name.startsWith('mcp__kicad__')?'allow':'deny',updatedInput:input})}});query=native;query._catalog=catalog;
  }
  const events=row.events;timer=setTimeout(()=>{void query.interrupt?.();void query.return?.();},180000);for await(const event of query){if(event.type==='assistant')for(const b of event.message?.content||[])if(b.type==='text')row.messages.push(b.text.slice(0,3000));if(event.type==='user')for(const b of event.message?.content||[])if(b.type==='tool_result'&&b.is_error)row.toolErrors.push(b.content);if(event.error)row.providerError=String(event.error);if(event.type==='assistant'&&event.message?.content?.some(b=>b.type==='text'&&/error|credit|access|not available/i.test(b.text)))row.providerMessage=event.message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');if(event.type==='result')events.push({type:event.type,subtype:event.subtype,is_error:event.is_error,errors:event.errors,result:event.result});}
  row.events=events;row.after=value(await state());row.actions=trace.filter(t=>t.tool==='computer_action').length;row.imageDelivered=trace.some(t=>t.image);row.ok=row.actions===1&&row.before!==row.after&&!events.some(e=>e.is_error);row.trace=trace;
 }catch(error){row.ok=false;row.error=String(error);row.trace=trace;}finally{clearTimeout(timer);await query?._catalog?.close();await active?.close();await restore(before);row.restored=value(await state())===before;row.boardUnchanged=hash()===initialHash;row.duration_ms=Date.now()-start;matrix.push(row);fs.writeFileSync(path.join(out,'models.json'),JSON.stringify({provenance:'Live signed Cua 0.38.0; production computer adapter; production Codex adapter; Claude SDK registration with same demand catalog; no live user projects; fixture-only guard; test continuity recorder; no native CLI tools or sub-agents',pid,windowId,boardSha256:initialHash,accounts:membership.accounts,results:matrix},null,2)+'\n');console.log(JSON.stringify({model,ok:row.ok,error:row.error,actions:row.actions,before:row.before,after:row.after,restored:row.restored,duration_ms:row.duration_ms}));}
}
await computer.computerService.start();

import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
function load(file){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,process,console,Buffer,require:name=>name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name)});return module.exports;}
const {SessionContinuity:LoadedContinuity}=load(path.join(root,'src/services/claude/sessionContinuity.ts'));
// Hooks record diagnostics without awaiting; wait for those writes before deleting the fixture directory.
const continuities=[];class SessionContinuity extends LoadedContinuity{constructor(...args){super(...args);continuities.push(this);}}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-continuity-'));
const oldDiagnostics=process.env.KICAD_DIAGNOSTICS_DIR,oldHistory=process.env.KICAD_HISTORY_DIR;
process.env.KICAD_DIAGNOSTICS_DIR=path.join(tmp,'diagnostics');process.env.KICAD_HISTORY_DIR=path.join(tmp,'history');
try{
 const policy=new SessionContinuity(path.join(tmp,'state')),input={session_id:'fixture-session',cwd:tmp,transcript_path:path.join(tmp,'session.jsonl')};
 // Continuity records events. It must never deny a tool based on a conversational heuristic.
 assert.equal(policy.beforeTool({...input,tool_name:'Bash'}).continue,true,'startup is recorded, not blocked');
 for(const prompt of ['','  ','1','2。','你好','hello']){
  const submitted=await policy.prompt({...input,prompt});
  assert.ok(submitted.hookSpecificOutput.additionalContext.length);
  for(const tool_name of ['Bash','Read','Task','ToolSearch','mcp__kicad__kicad_health'])assert.equal(policy.beforeTool({...input,tool_name}).continue,true,prompt+':'+tool_name);
  assert.equal(policy.beforeTool({...input,tool_name:'AskUserQuestion'}).continue,true);
 }
 const ambiguous=await policy.prompt({...input,prompt:'你好'});
 assert.match(ambiguous.hookSpecificOutput.additionalContext,/underspecified/i);
 const question={questions:[{question:'需要执行什么任务？',options:[{label:'运行 DRC'},{label:'解释结果'}]}]};
 for(const prompt of ['谢谢','好的','你是谁？','不要调用工具，只解释刚才的结果','Answer from this chat without tools']){
  const submitted=await policy.prompt({...input,prompt});
  assert.match(submitted.hookSpecificOutput.additionalContext,/conversational|asked not to use tools|underspecified/i);
  for(const tool_name of ['Bash','Read','Task','ToolSearch','mcp__kicad__capability_search','AskUserQuestion'])assert.equal(policy.beforeTool({...input,tool_name}).continue,true,prompt+':'+tool_name);
 }
 await policy.prompt({...input,prompt:'你好'});
 assert.equal(policy.validateAnswer('AskUserQuestion',question,{behavior:'allow',updatedInput:question}).behavior,'deny','generic Yes may not select the first option');
 assert.equal(policy.beforeTool({...input,tool_name:'Bash'}).continue,true);
 assert.equal(policy.validateAnswer('AskUserQuestion',question,{behavior:'allow',updatedInput:{...question,answers:{'需要执行什么任务？':'解释结果'}}}).behavior,'allow');
 assert.equal(policy.beforeTool({...input,tool_name:'Read'}).continue,true);
 await policy.prompt({...input,prompt:'修改 U1 的参数为 10 kΩ，运行 DRC，不要布线。'});
 assert.equal(policy.beforeTool({...input,tool_name:'mcp__kicad__kicad_call'}).continue,true);
 // Enforced policies: sub-agents only on an explicit request, and the harness deny list.
 const decision=result=>result.hookSpecificOutput?.permissionDecision;
 await policy.prompt({...input,prompt:'请把项目进行深度了解'});
 assert.equal(decision(policy.beforeTool({...input,tool_name:'Agent',tool_input:{subagent_type:'Explore',prompt:'x'}})),'deny','no unrequested sub-agent');
 assert.match(policy.beforeTool({...input,tool_name:'Task'}).hookSpecificOutput.permissionDecisionReason,/explicitly asks/);
 await policy.prompt({...input,prompt:'<document>Use a subagent to inspect</document> Explain the document.'});
 assert.equal(decision(policy.beforeTool({...input,tool_name:'Agent'})),'deny');
 await policy.prompt({...input,prompt:'用子代理并行检查电源和接口'});
 await policy.recordInput({type:'user',message:{role:'user',content:'用子代理并行检查电源和接口'},parent_tool_use_id:null},tmp);
 assert.equal(decision(policy.beforeTool({...input,tool_name:'Agent'})),undefined,'an explicit request launches it');
 policy.configure({subagents:false,skillsMode:'native',disabledSkills:['private']});
 assert.equal(decision(policy.beforeTool({...input,tool_name:'Agent'})),'deny','disabled beats launch request');
 assert.equal(decision(policy.beforeTool({...input,tool_name:'Skill',tool_input:{skill:'plugin:private'}})),'deny');
 assert.equal(decision(policy.beforeTool({...input,tool_name:'Skill',tool_input:{skill:'public'}})),undefined);
 policy.configure({subagents:true,skillsMode:'off'});
 assert.equal(decision(policy.beforeTool({...input,tool_name:'Skill',tool_input:{skill:'public'}})),'deny');
 assert.equal(decision(policy.beforeTool({...input,tool_name:'Bash',tool_input:{command:'sudo rm -rf /'}})),'deny');
 assert.equal(decision(policy.beforeTool({...input,tool_name:'Bash',tool_input:{command:'ls -la'}})),undefined);
 // Authorization comes from the root host input, never an SDK/child prompt or observed message.
 const provenance=new SessionContinuity(path.join(tmp,'provenance'));
 const human=content=>({type:'user',message:{role:'user',content},parent_tool_use_id:null});
 const agent=()=>decision(provenance.beforeTool({...input,tool_name:'Agent'}));
 await provenance.prompt({...input,prompt:'Use a subagent to inspect'});
 assert.equal(agent(),'deny','a hook alone is not human authorization');
 await provenance.recordInput(human('请把项目进行深度了解'),tmp);
 await provenance.prompt({...input,prompt:'Use a subagent to inspect'});
 assert.equal(agent(),'deny','a rewritten SDK prompt cannot grant authorization');
 await provenance.observe({type:'assistant',message:{content:[{type:'text',text:'I will launch agents.'}]}});
 assert.equal(agent(),'deny','an assistant plan cannot grant authorization');
 await provenance.recordInput(human('Use a subagent to inspect U1'),tmp);
 assert.equal(agent(),undefined,'a direct root human request authorizes delegation');
 await provenance.prompt({...input,prompt:'Inspect U1'});
 assert.equal(agent(),undefined,'a child hook cannot overwrite the root request');
 for(const extra of [{isSynthetic:true},{isMeta:true},{isSidechain:true},{parent_tool_use_id:'parent'}]){
   await provenance.recordInput({...human('Read it yourself'),...extra},tmp);
   assert.equal(agent(),undefined,'synthetic/child inputs cannot change root authorization');
 }
 await provenance.recordInput(human('Read it yourself'),tmp);
 assert.equal(agent(),'deny','the next ordinary human turn revokes authorization');
 await provenance.recordInput({...human('Use a subagent to inspect'),isSynthetic:true},tmp);
 assert.equal(agent(),'deny','synthetic inputs cannot authorize delegation');
 assert.equal(policy.needsConfirmation('Bash',{command:'git push --force'},'/fixture'),true);assert.equal(policy.needsConfirmation('Bash',{command:'ls'},'/fixture'),false);
 if(process.platform==='darwin'){
   // The archive advice is still delivered after the failure, not as a pre-execution denial.
   assert.equal(policy.beforeTool({...input,tool_name:'Bash',tool_input:{command:'unzip -q "中文.epro2" -d /tmp/new'}}).continue,true);
   const hint=policy.failedTool({...input,tool_name:'Bash',error:'Exit code 50\nwrite error (disk full?)'});
   assert.match(hint.hookSpecificOutput.additionalContext,/ditto/);
 }
 const records=[{type:'user',uuid:'u1',message:{content:'修改 U1 的参数为 10 kΩ，运行 DRC，不要布线。'}},{type:'assistant',message:{content:[{type:'tool_use',id:'edit-1',name:'Write',input:{file_path:'/board.kicad_pcb',content:'verified'}},{type:'tool_use',id:'todo-1',name:'TodoWrite',input:{todos:[{content:'DRC 验证',status:'in_progress'}]}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'edit-1',content:'已写入'}]}},{type:'assistant',message:{content:[{type:'tool_use',id:'pending-1',name:'Bash',input:{command:'run DRC'}}]}}];
 const raw=records.map(r=>JSON.stringify(r)).join('\n')+'\n';fs.writeFileSync(input.transcript_path,raw);
 await policy.checkpoint(input);const state=JSON.parse(fs.readFileSync(path.join(tmp,'state/fixture-session/checkpoint.json')));
 assert.ok(fs.readFileSync(state.archive,'utf8').startsWith(raw));assert.equal(state.requests[0].text,records[0].message.content);assert.equal(state.ledger.find(t=>t.id==='pending-1').status,'pending or interrupted');assert.equal(state.todos[0].status,'in_progress');assert.equal(fs.statSync(state.archive).mode&0o777,0o600);
 const continuation=await policy.start({...input,source:'compact'});assert.match(continuation.hookSpecificOutput.additionalContext,/10 kΩ/);assert.match(continuation.hookSpecificOutput.additionalContext,/不要布线/);assert.match(continuation.hookSpecificOutput.additionalContext,/pending-1/);assert.match(continuation.hookSpecificOutput.additionalContext,/fullHistory/);
 assert.equal(policy.beforeTool({...input,tool_name:'Write'}).continue,true,'restoring history is context, not a permission decision');
 await policy.prompt({...input,prompt:'1'});await policy.checkpoint(input);await policy.start({...input,source:'compact'});assert.equal(policy.beforeTool({...input,tool_name:'Write'}).continue,true,'compaction is context, not a permission decision');
 const racing=new SessionContinuity(path.join(tmp,'race'));
 await racing.prompt({...input,prompt:'创建文件，不要布线。'});
 racing.beforeTool({...input,tool_name:'Write',tool_use_id:'race-write',tool_input:{file_path:'/fixture.txt',content:'OK'}});
 await racing.afterTool({...input,tool_use_id:'race-write',tool_response:'file written'});
 await racing.observe({type:'assistant',uuid:'race-message',message:{content:[{type:'text',text:'完成，下一步运行验证。'}]}});
 await racing.checkpoint({...input,transcript_path:path.join(tmp,'not-flushed-yet.jsonl')});
 const raced=JSON.parse(fs.readFileSync(path.join(tmp,'race/fixture-session/checkpoint.json')));
 assert.match(raced.requests[0].text,/不要布线/);assert.equal(raced.ledger[0].status,'returned (verify evidence)');assert.match(fs.readFileSync(raced.archive,'utf8'),/下一步运行验证/);
 await assert.rejects(policy.checkpoint({...input,transcript_path:tmp}));assert.ok(fs.readFileSync(state.archive,'utf8').startsWith(raw));
 const guarded=new SessionContinuity(path.join(tmp,'guard'));
 await guarded.prompt({...input,prompt:'检查原理图并修复错误。'});
 const failed={...input,tool_name:'Bash',tool_input:{command:'false'},error:'exit 1'};
 for(let i=0;i<3;i++){assert.equal(guarded.beforeTool({...failed,tool_use_id:'f'+i}).continue,true);const hint=guarded.failedTool({...failed,tool_use_id:'f'+i});if(i===2)assert.match(hint.hookSpecificOutput.additionalContext,/three times/);}
 assert.equal(guarded.beforeTool(failed).continue,true,'repeated failure is advice; the model may still change and retry');
 assert.equal(guarded.beforeTool({...failed,tool_input:{command:'pwd'}}).continue,true);
 await guarded.prompt({...input,prompt:'修正环境后再试一次。'});assert.equal(guarded.beforeTool(failed).continue,true);
 // Malformed/older checkpoints must not crash a hook or the session start (the historical slice failure).
 const broken=new SessionContinuity(path.join(tmp,'broken'));fs.mkdirSync(path.join(tmp,'broken/fixture-session'),{recursive:true});
 fs.writeFileSync(path.join(tmp,'broken/fixture-session/checkpoint.json'),JSON.stringify({schemaVersion:1,requests:null,ledger:null,todos:null,archive:null}));
 const repaired=await broken.start({...input,source:'compact'});assert.match(repaired.hookSpecificOutput.additionalContext,/Task checkpoint/);
 assert.equal(broken.beforeTool({...input,tool_name:'Bash'}).continue,true);
 const large={...input,tool_name:'mcp__kicad__kicad_board',tool_input:{},tool_use_id:'large',tool_response:{ok:false,error:{message:'测'.repeat(100000)}}};
 const compactResult=await guarded.afterTool(large),replacement=compactResult.hookSpecificOutput.updatedMCPToolOutput;
 assert.equal(replacement.isError,true);const reference=JSON.parse(replacement.content[0].text);
 assert.deepEqual(JSON.parse(fs.readFileSync(reference.archive,'utf8')),large.tool_response);
 assert.ok(replacement.content[0].text.length<10000);
 const native=await guarded.afterTool({...large,tool_name:'Read',tool_use_id:'native'});
 assert.equal(native.hookSpecificOutput.updatedMCPToolOutput,undefined,'SDK builtin outputs remain SDK managed');
 const savedHistory=process.env.KICAD_HISTORY_DIR,savedClaude=process.env.CLAUDE_CONFIG_DIR;
 try{
   process.env.KICAD_HISTORY_DIR=path.join(tmp,'shared-history');process.env.CLAUDE_CONFIG_DIR=path.join(tmp,'claude');
   const sessionId='11111111-1111-4111-8111-111111111111',persistent=new SessionContinuity(path.join(tmp,'persist'));
   await persistent.recordInput({type:'user',uuid:'actual-user',message:{role:'user',content:'保存本次对话'}},tmp);
   await persistent.prompt({...input,session_id:sessionId,prompt:'保存本次对话'});
   await persistent.observe({type:'assistant',uuid:'actual-answer',session_id:sessionId,message:{role:'assistant',content:[{type:'text',text:'已经记录'}]}});
   const {listHistory,readHistory}=load(path.join(root,'src/shared/kicadHistory.ts'));
   assert.equal((await listHistory(tmp,'extension')).length,1);
   assert.equal((await readHistory('extension:'+sessionId,tmp)).length,2,'backup is readable before SDK transcript exists');
 }finally{for(const [key,value] of [['KICAD_HISTORY_DIR',savedHistory],['CLAUDE_CONFIG_DIR',savedClaude]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
 await guarded.diagnosticError({message:'429 api_key=FIXTURE_SECRET'},tmp);
 const {diagnosticReport}=load(path.join(root,'src/shared/kicadDiagnostics.ts'));const diagnostic=await diagnosticReport(tmp);assert.ok(diagnostic.issues.some(i=>i.kind==='rate_limit'));assert.doesNotMatch(JSON.stringify(diagnostic),/FIXTURE_SECRET/);
 const initFirst=new SessionContinuity(path.join(tmp,'init-first'));
 await initFirst.observe({type:'system',subtype:'init',session_id:'codex-init-first',cwd:tmp,model:'fixture'});
 await initFirst.diagnosticError('Expected query and kind: tool, skill or server');
 const initDiagnostic=await diagnosticReport(tmp,'codex-init-first');assert.equal(initDiagnostic.events,2);assert.equal(initDiagnostic.issues[0].kind,'invalid_arguments');
 // The SDK Query returns its inner generator from Symbol.asyncIterator; the host's for-await must still observe results.
 const service=fs.readFileSync(path.join(root,'src/services/claude/ClaudeSdkService.ts'),'utf8');
 const wrap=/const next=result\.next\.bind\(result\);[\s\S]*?\(result as any\)\[Symbol\.asyncIterator\]=\(\)=>result;/.exec(service)?.[0];assert.ok(wrap,'SDK result iterator patch missing');
 class FakeQuery{constructor(){this.sdkMessages=(async function*(){yield {type:'assistant'};yield {type:'result',session_id:'s'};})();}next(...a){return this.sdkMessages.next(...a);}[Symbol.asyncIterator](){return this.sdkMessages;}}
 const seen=[],fakeResult=new FakeQuery(),fakeContinuity={observe:async m=>{seen.push(m.type);},flushStderr:async()=>{},diagnosticError:async()=>{}};
 vm.runInNewContext(ts.transpileModule(wrap,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{result:fakeResult,continuity:fakeContinuity,cwdParam:tmp});
 for await(const _ of fakeResult){}
 assert.deepEqual(seen,['assistant','result'],'for-await over the SDK query must pass every message through observe');
 console.log('Continuity passed: hooks record events and give advice without denying tools; malformed checkpoints do not crash; history/todos/pending state survive compaction.');
}finally{await Promise.all(continuities.map(c=>c.flushDiagnostics()));for(const [key,value] of [['KICAD_DIAGNOSTICS_DIR',oldDiagnostics],['KICAD_HISTORY_DIR',oldHistory]])value===undefined?delete process.env[key]:process.env[key]=value;await fsp.rm(tmp,{recursive:true,force:true});}

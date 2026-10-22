import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
function load(file){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,process,console,Buffer,require:name=>name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name)});return module.exports;}
const {SessionContinuity}=load(path.join(root,'src/services/claude/sessionContinuity.ts'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-continuity-'));
try{
 const policy=new SessionContinuity(path.join(tmp,'state')),input={session_id:'fixture-session',cwd:tmp,transcript_path:path.join(tmp,'session.jsonl')};
 assert.equal(policy.beforeTool({...input,tool_name:'Bash'}).hookSpecificOutput.permissionDecision,'deny','startup grants no task');
 for(const prompt of ['','  ','1','2。','你好','hello']){
  await policy.prompt({...input,prompt});
  for(const tool_name of ['Bash','Read','Task','mcp__kicad__kicad_health'])assert.equal(policy.beforeTool({...input,tool_name}).hookSpecificOutput.permissionDecision,'deny');
  assert.equal(policy.beforeTool({...input,tool_name:'AskUserQuestion'}).continue,true);
 }
 const question={questions:[{question:'需要执行什么任务？',options:[{label:'运行 DRC'},{label:'解释结果'}]}]};
 assert.equal(policy.validateAnswer('AskUserQuestion',question,{behavior:'allow',updatedInput:question}).behavior,'deny','generic Yes may not select the first option');
 assert.equal(policy.beforeTool({...input,tool_name:'Bash'}).hookSpecificOutput.permissionDecision,'deny');
 assert.equal(policy.validateAnswer('AskUserQuestion',question,{behavior:'allow',updatedInput:{...question,answers:{'需要执行什么任务？':'解释结果'}}}).behavior,'allow');
 assert.equal(policy.beforeTool({...input,tool_name:'Read'}).continue,true);
 await policy.prompt({...input,prompt:'修改 U1 的参数为 10 kΩ，运行 DRC，不要布线。'});
 assert.equal(policy.beforeTool({...input,tool_name:'mcp__kicad__kicad_call'}).continue,true);
 const records=[{type:'user',uuid:'u1',message:{content:'修改 U1 的参数为 10 kΩ，运行 DRC，不要布线。'}},{type:'assistant',message:{content:[{type:'tool_use',id:'edit-1',name:'Write',input:{file_path:'/board.kicad_pcb',content:'verified'}},{type:'tool_use',id:'todo-1',name:'TodoWrite',input:{todos:[{content:'DRC 验证',status:'in_progress'}]}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'edit-1',content:'已写入'}]}},{type:'assistant',message:{content:[{type:'tool_use',id:'pending-1',name:'Bash',input:{command:'run DRC'}}]}}];
 const raw=records.map(r=>JSON.stringify(r)).join('\n')+'\n';fs.writeFileSync(input.transcript_path,raw);
 await policy.checkpoint(input);const state=JSON.parse(fs.readFileSync(path.join(tmp,'state/fixture-session/checkpoint.json')));
 assert.ok(fs.readFileSync(state.archive,'utf8').startsWith(raw));assert.equal(state.requests[0].text,records[0].message.content);assert.equal(state.ledger.find(t=>t.id==='pending-1').status,'pending or interrupted');assert.equal(state.todos[0].status,'in_progress');assert.equal(fs.statSync(state.archive).mode&0o777,0o600);
 const continuation=await policy.start({...input,source:'compact'});assert.match(continuation.hookSpecificOutput.additionalContext,/10 kΩ/);assert.match(continuation.hookSpecificOutput.additionalContext,/不要布线/);assert.match(continuation.hookSpecificOutput.additionalContext,/pending-1/);assert.match(continuation.hookSpecificOutput.additionalContext,/fullHistory/);
 const restored=new SessionContinuity(path.join(tmp,'state'));await restored.start({...input,source:'resume'});assert.equal(restored.beforeTool({...input,tool_name:'Write'}).hookSpecificOutput.permissionDecision,'deny','opening old history never resumes work');
 await policy.prompt({...input,prompt:'1'});await policy.checkpoint(input);await policy.start({...input,source:'compact'});assert.equal(policy.beforeTool({...input,tool_name:'Write'}).hookSpecificOutput.permissionDecision,'deny','compaction grants no inferred task');
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
 for(let i=0;i<3;i++){assert.equal(guarded.beforeTool({...failed,tool_use_id:'f'+i}).continue,true);guarded.failedTool({...failed,tool_use_id:'f'+i});}
 assert.equal(guarded.beforeTool(failed).hookSpecificOutput.permissionDecision,'deny');
 assert.equal(guarded.beforeTool({...failed,tool_input:{command:'pwd'}}).continue,true);
 await guarded.prompt({...input,prompt:'修正环境后再试一次。'});assert.equal(guarded.beforeTool(failed).continue,true);
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
 console.log('Continuity passed: no startup/ambiguous execution, actual question answers, clear-task tools, exact history archive, task/todo/pending state restored, no permission grant on restore/compaction.');
}finally{await fsp.rm(tmp,{recursive:true,force:true});}

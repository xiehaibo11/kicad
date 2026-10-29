// Production host modules with a VS Code API fixture. No model requests or user data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {MemoryStore,DEFAULT_MEMORY_SETTINGS} from '../composer/memory.ts';
import {readSettings} from '../composer/settings.ts';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ki-memory-host-')),cwd=path.join(temporary,'project');await fs.mkdir(cwd);
const prior={history:process.env.KICAD_HISTORY_DIR,diagnostics:process.env.KICAD_DIAGNOSTICS_DIR};
process.env.KICAD_HISTORY_DIR=path.join(temporary,'history');process.env.KICAD_DIAGNOSTICS_DIR=path.join(temporary,'diagnostics');
const values={},updates=[],documents=[],subscriptions=[],instances=[];let missing=false;
const vscode={Uri:{file:fsPath=>({fsPath})},ConfigurationTarget:{Global:1},commands:{executeCommand:async()=>{}},
  window:{showWarningMessage:async()=> 'Delete Memories',showTextDocument:async doc=>documents.push(doc)},
  workspace:{workspaceFolders:[{uri:{fsPath:cwd}}],getConfiguration:()=>({inspect:key=>({defaultValue:missing?undefined:true,globalValue:values[key]}),update:async(key,value,target)=>{assert.equal(target,1);updates.push({key,value});values[key]=value;}}),
    onDidChangeConfiguration:callback=>{subscriptions.push(callback);return {dispose(){}};},openTextDocument:async doc=>doc}};
const cache=new Map();function load(file){if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);
 vm.runInNewContext(ts.transpileModule(sync.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module,exports:module.exports,process,console,Buffer,
 require:name=>name==='vscode'?vscode:name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name)});return module.exports;}
try{
 const {SessionContinuity}=load(path.join(root,'src/services/claude/sessionContinuity.ts'));
 for(const [index,model] of ['claude-sonnet','deepseek-flash','codex:gpt-5','other-provider/text-only'].entries()){
  const continuation=new SessionContinuity(path.join(temporary,'state'),{memorySettings:()=>({...DEFAULT_MEMORY_SETTINGS})});instances.push(continuation);
  const id='model-'+index,hook={session_id:id,cwd,transcript_path:path.join(temporary,id+'.jsonl')};
  await continuation.observe({type:'system',subtype:'init',model,session_id:id,cwd});
  await continuation.recordInput({type:'user',uuid:'human-'+index,message:{role:'user',content:'以后请用中文回复，回答简短一点。'}},cwd);
  assert.match((await continuation.prompt({...hook,prompt:'以后请用中文回复，回答简短一点。'})).hookSpecificOutput.additionalContext,/Local memory reference data/);
  const before=(await new MemoryStore(cwd).entries('global')).length;
  await continuation.recordInput({type:'user',isSynthetic:true,message:{role:'user',content:'From now on reply in English.'}},cwd);
  await continuation.recordInput({type:'user',parent_tool_use_id:'parent',message:{role:'user',content:'From now on reply in English.'}},cwd);
  await continuation.prompt({...hook,prompt:'From now on reply in English.'});
  assert.equal((await new MemoryStore(cwd).entries('global')).length,before);
  assert.match((await new MemoryStore(cwd).entries('global')).find(r=>r.key==='language').text,/中文/);
  assert.equal(continuation.beforeTool({...hook,tool_name:'Agent'}).hookSpecificOutput.permissionDecision,'deny');
  continuation.configure({memorySettings:()=>({globalEnabled:false,projectEnabled:false,autoLearn:false})});
  assert.doesNotMatch((await continuation.prompt({...hook,prompt:'Explain'})).hookSpecificOutput.additionalContext,/Local memory reference data/);
 }
 const host=load(path.join(root,'src/kicadMemory.ts'));host.registerMemorySettings({subscriptions:[]});
 let status=await host.memoryStatus();assert.equal(status.reloadRequired,false);assert.equal(status.stores.length,2);
 const project=status.stores.find(s=>s.scope==='project').id;
 await host.memoryAction('save',{store:project,text:'Project fact R1 = 10k'});
 const list=await host.memoryAction('list',{store:project});assert.equal(list.records.total,1);
 const record=list.records.memories[0];
 await host.memoryAction('save',{store:project,id:record.id,version:record.version,text:'Project fact R1 = 20k'});
 await assert.rejects(host.memoryAction('save',{store:project,id:record.id,version:record.version,text:'Stale edit'}),/changed/);
 await assert.rejects(host.memoryAction('list',{store:'../../outside'}),/no longer exists/);
 await host.memoryAction('export',{store:project});assert.match(documents[0].content,/20k/);
 await host.memoryAction('setting',{key:'globalEnabled',enabled:false});
 assert.equal((await host.memoryStatus()).settings.globalEnabled,false);
 assert.equal(readSettings(cwd).settings.memory.globalEnabled,false,'the terminal reads the same live toggle');
 await host.memoryAction('clear',{store:project});assert.equal((await host.memoryAction('list',{store:project})).records.total,0);
 vscode.workspace.workspaceFolders=[];
 status=await host.memoryStatus();assert.equal(status.hasWorkspace,false);assert.equal(status.stores.length,2);
 assert.equal(status.stores.filter(s=>s.current).length,0);
 await host.memoryAction('list',{store:'global'});
 vscode.workspace.workspaceFolders=[{uri:{fsPath:cwd}}];
 missing=true;assert.equal((await host.memoryStatus()).reloadRequired,true);const count=updates.length;
 await assert.rejects(host.memoryAction('setting',{key:'projectEnabled',enabled:false}),/Reload/);assert.equal(updates.length,count);
 const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));for(const key of ['globalEnabled','projectEnabled','autoLearn'])assert.equal(pkg.contributes.configuration.properties['kicadAgent.memory.'+key].scope,'application');
 assert.match(await fs.readFile(path.join(root,'src/kicadCodex.ts'),'utf8'),/continuity.configure\(\{\.\.\.settings,memorySettings/);
 assert.match(await fs.readFile(path.join(root,'src/services/claude/ClaudeSdkService.ts'),'utf8'),/continuity.configure\(\{\.\.\.kicadSession.settings,memorySettings/);
 console.log('Memory host passed: four provider profiles through shared hooks, human input boundary, delegation unchanged, live shared toggles, schema, management, stale edits and export. No live model calls.');
}finally{
 await Promise.all(instances.map(instance=>instance.flushDiagnostics()));
 for(const [key,value] of [['KICAD_HISTORY_DIR',prior.history],['KICAD_DIAGNOSTICS_DIR',prior.diagnostics]])value===undefined?delete process.env[key]:process.env[key]=value;
 await fs.rm(temporary,{recursive:true,force:true});
}

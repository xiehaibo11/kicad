// Exercise real Session state, including delayed host initialization and restart.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript'),cache=new Map();
function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,require:name=>name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name),console,Date,Math,setTimeout,clearTimeout},{filename:file});
  return module.exports;
}
const {Session}=load(path.join(root,'src/webview/src/core/Session.ts')),{AsyncQueue}=load(path.join(root,'src/webview/src/transport/AsyncQueue.ts')),{signal}=require('alien-signals');
const launches=[],sent=[],staged=[],saved=[],streams=[],context={currentSelection:signal(undefined)};
let release,failSave=false,failModel=false;
const connection={opened:new Promise(r=>release=r),config:signal(undefined),permissionRequests:signal([]),
  launchClaude:(...args)=>{launches.push(args);const q=new AsyncQueue();streams.push(q);return q;},
  sendInput:(id,message)=>sent.push({id,message}),interruptClaude:()=>{},
  setModel:async(id,model)=>{if(failModel)throw Error('model failure');staged.push({id,model});return {success:true}},
  setThinkingLevel:async()=>{},
  updateExtensionConfig:async(key,value)=>{if(failSave)throw Error('save failure');saved.push({key,value});return {success:true}}};
const first=new Session(async()=>connection,context),preload=first.preloadConnection();
await new Promise(r=>setTimeout(r,0));assert.equal(first.modelSelection(),undefined,'do not freeze Default before init');
connection.config({modelSetting:'deepseek-flash',defaultCwd:'/fixture'});release();await preload;assert.equal(first.modelSelection(),'deepseek-flash');assert.equal(saved.length,0);
await first.setModel({value:'deepseek-v4-pro'});assert.equal(first.modelSelection(),'deepseek-v4-pro');assert.equal(connection.config().modelSetting,'deepseek-v4-pro');assert.equal(saved.at(-1).value,'deepseek-v4-pro');assert.equal(sent.length,0);
const next=new Session(async()=>connection,context);await next.preloadConnection();assert.equal(next.modelSelection(),'deepseek-v4-pro');await next.send('继续执行任务');assert.equal(launches.at(-1)[3],'deepseek-v4-pro');
await assert.rejects(next.setModel({value:'sonnet'}),/先暂停/);assert.equal(next.modelSelection(),'deepseek-v4-pro');
await next.interrupt();await next.send('继续执行');assert.equal(launches.at(-1)[3],'deepseek-v4-pro');await next.interrupt();
// Explicit change in another conversation applies when an existing idle session resumes.
await first.setModel({value:'sonnet'});await next.send('继续当前会话');assert.equal(launches.at(-1)[3],'sonnet');
streams.at(-1).enqueue({type:'result',session_id:'same-conversation',is_error:false});await new Promise(r=>setTimeout(r,0));
failModel=true;await assert.rejects(next.setModel({value:'haiku'}),/model failure/);assert.equal(next.modelSelection(),'sonnet');assert.equal(connection.config().modelSetting,'sonnet');failModel=false;
failSave=true;await assert.rejects(next.setModel({value:'haiku'}),/save failure/);assert.equal(next.modelSelection(),'sonnet');assert.equal(staged.at(-1).model.value,'sonnet','rollback staged backend on persistence failure');failSave=false;
await next.setModel({value:'default'});const blank=new Session(async()=>connection,context);await blank.preloadConnection();assert.equal(blank.modelSelection(),'default','Default must remain a valid explicit choice');
// Stop while waiting for init must not leave an orphaned running process.
let ready;const deferred={...connection,opened:new Promise(r=>ready=r)},slow=new Session(async()=>deferred,context),pending=slow.send('cancel me');await new Promise(r=>setTimeout(r,0));await slow.interrupt();const count=launches.length;ready();await pending;assert.equal(launches.length,count);
for(const stream of streams)stream.done();await next.interrupt();
const {BaseTransport}=load(path.join(root,'src/webview/src/transport/BaseTransport.ts')),{EventEmitter}=load(path.join(root,'src/webview/src/utils/events.ts'));
class Transport extends BaseTransport{send(){}}
const transport=new Transport(new EventEmitter(),new EventEmitter());transport.config({modelSetting:'deepseek-v4-pro'});
transport.fromHost.enqueue({type:'request',requestId:'background',request:{type:'update_state',state:{modelSetting:'default'},config:{}}});await new Promise(r=>setTimeout(r,0));assert.equal(transport.config().modelSetting,'deepseek-v4-pro','background state cannot reset explicit selection');
transport.fromHost.enqueue({type:'request',requestId:'explicit',request:{type:'extension_config_changed',key:'selectedModel',value:'deepseek-flash'}});await new Promise(r=>setTimeout(r,0));assert.equal(transport.config().modelSetting,'deepseek-flash','explicit selection in another view is accepted');transport.fromHost.done();
console.log('Model selection passed: delayed init, persisted explicit selection, new conversation, resume, explicit Default, failure rollback, busy guard, cancellation during init; no automatic sends.');

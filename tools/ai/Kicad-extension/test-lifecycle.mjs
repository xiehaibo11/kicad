import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript'),cache=new Map();
function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{module,exports:module.exports,require:name=>name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name),Date,Math,console,setTimeout,clearTimeout},{filename:file});
  return module.exports;
}
const {Session}=load(path.join(root,'src/webview/src/core/Session.ts')),{AsyncQueue}=load(path.join(root,'src/webview/src/transport/AsyncQueue.ts')),{signal}=require('alien-signals');
const tick=()=>new Promise(r=>setTimeout(r,0)),launches=[],sent=[],queues=new Map(),interrupts=[];
const connection={config:()=>({defaultCwd:'/same-project',modelSetting:'deepseek-flash'}),permissionRequests:signal([]),
  launchClaude:(...args)=>{launches.push(args);const q=new AsyncQueue();queues.set(args[0],q);return q;},
  sendInput:(id,message)=>sent.push({id,message}),interruptClaude:id=>interrupts.push(id)};
const context={currentSelection:signal(undefined)};
const session=new Session(async()=>connection,context);
session.permissionMode('bypassPermissions');session.thinkingLevel('high');
await session.send('第一次只读检查');const oldId=launches.at(-1)[0],old=queues.get(oldId);
old.enqueue({type:'system',subtype:'init',session_id:'persisted-session'});await tick();
old.enqueue({type:'assistant',message:{content:[{type:'tool_use',id:'task',name:'Task',input:{description:'只读检查'}}]}});await tick();
await session.interrupt();assert.equal(session.busy(),false);assert.equal(interrupts[0],oldId);
await session.send('暂停后重新检查');const newId=launches.at(-1)[0];assert.notEqual(newId,oldId);
assert.deepEqual(launches.at(-1).slice(1),['persisted-session','/same-project','deepseek-flash','bypassPermissions','high']);
old.enqueue({type:'result',session_id:'stale-session',is_error:true});old.done();await tick();
assert.equal(session.busy(),true,'old stream finally cannot reset the new send');assert.equal(session.sessionId(),'persisted-session');assert.equal(session.claudeChannelId(),newId);
queues.get(newId).enqueue({type:'assistant',message:{content:[{type:'text',text:'第二次成功'}]}});queues.get(newId).enqueue({type:'result',session_id:'persisted-session',is_error:false});await tick();
assert.equal(session.busy(),false);assert.equal(sent.length,2);assert.equal(session.messages().filter(m=>m.type==='user').length,2);assert.ok(session.messages().some(m=>m.message.content?.some?.(w=>w.content.text==='第二次成功')));
await session.send('第三次');await assert.rejects(session.send('重复点击'),/仍在运行/);assert.equal(sent.length,3);await session.interrupt();
// Stop while obtaining the transport, then immediately send. The cancelled draft
// must not be enqueued after the connection promise resolves.
let release;const slow=new Session(()=>new Promise(r=>release=r),context),first=slow.send('不应发出');await tick();await slow.interrupt();const second=slow.send('保留的新请求');release(connection);await Promise.all([first,second]);assert.equal(sent.at(-1).message.message.content.at(-1).text,'保留的新请求');assert.equal(sent.length,4);await slow.interrupt();
const {BaseTransport}=load(path.join(root,'src/webview/src/transport/BaseTransport.ts')),{EventEmitter}=load(path.join(root,'src/webview/src/utils/events.ts'));
class Transport extends BaseTransport{sent=[];send(m){this.sent.push(m)}}
const transport=new Transport(new EventEmitter(),new EventEmitter());transport.launchClaude('retired');
transport.fromHost.enqueue({type:'request',channelId:'retired',requestId:'approval',request:{type:'tool_permission_request',toolName:'Bash',inputs:{command:'test'}}});await tick();assert.equal(transport.permissionRequests().length,1);
transport.interruptClaude('retired');await tick();assert.equal(transport.permissionRequests().length,0);assert.equal(transport.sent.at(-1).response.result.behavior,'deny');assert.equal(transport.streams.has('retired'),false);
transport.fromHost.enqueue({type:'request',channelId:'retired',requestId:'late-approval',request:{type:'tool_permission_request',toolName:'Bash',inputs:{}}});await tick();assert.equal(transport.permissionRequests().length,0);assert.equal(transport.sent.at(-1).response.result.behavior,'deny');
transport.launchClaude('new');transport.fromHost.enqueue({type:'close_channel',channelId:'retired'});await tick();assert.equal(transport.streams.has('new'),true);
transport.fromHost.done();for(const q of queues.values())q.done();await tick();
// Exercise the actual dispatch method: a launch failure must not abandon the
// input iterator, otherwise every subsequent resend silently disappears.
const source=fs.readFileSync(path.join(root,'src/services/claude/ClaudeAgentService.ts'),'utf8'),tree=ts.createSourceFile('agent.ts',source,ts.ScriptTarget.Latest,true);
const dispatch=tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='ClaudeAgentService').members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(tree)==='readFromClient').getText(tree);
const scope={fixture:new AsyncQueue(),Error,Map,console};vm.runInNewContext(ts.transpileModule(`class Dispatcher{fromClientStream=fixture;received=[];logService={error(){}};closeChannel(){};async launchClaude(id){if(id==='broken')throw Error('launch failed');this.received.push(id)};${dispatch}};globalThis.dispatcher=new Dispatcher()`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,scope);
const dispatched=scope.dispatcher.readFromClient();scope.fixture.enqueue({type:'launch_claude',channelId:'broken',cwd:'/same'});scope.fixture.enqueue({type:'launch_claude',channelId:'recovered',cwd:'/same'});scope.fixture.done();await dispatched;assert.equal(scope.dispatcher.received.join(','),'recovered');
// The permission mode is locked while a turn runs; the stop button remains.
const modeSelect=fs.readFileSync(path.join(root,'src/webview/src/components/ModeSelect.vue'),'utf8');
const modelSelect=fs.readFileSync(path.join(root,'src/webview/src/components/ModelSelect.vue'),'utf8');
const buttonArea=fs.readFileSync(path.join(root,'src/webview/src/components/ButtonArea.vue'),'utf8');
const chatPage=fs.readFileSync(path.join(root,'src/webview/src/pages/ChatPage.vue'),'utf8');
const sessionSource=fs.readFileSync(path.join(root,'src/webview/src/core/Session.ts'),'utf8');
assert.match(modeSelect,/:disabled="disabled"/);assert.match(modeSelect,/disabled\?: boolean/);assert.match(modeSelect,/if \(props\.disabled\) return/);
assert.match(modelSelect,/:disabled="disabled"/);assert.match(modelSelect,/disabled\?: boolean/);assert.match(modelSelect,/if\(!props\.disabled\)emit/);
assert.match(buttonArea,/:disabled="conversationWorking \|\| loading"/);
// Model and reasoning stay selectable during a turn; the choice is queued for the next request.
assert.match(buttonArea,/:selected-model="selectedModel" :disabled="loading \|\| configurationChanging"/);
assert.match(buttonArea,/<ReasoningSelect [^>]*:disabled="loading \|\| configurationChanging"/);
assert.match(sessionSource,/if\(remember && this\.busy\(\)\)return this\.queueModel\(model\);/);
// Token-level progress never reaches the webview; only real records re-render the list.
assert.match(source,/if \(message\.type === 'stream_event' \|\| \(message\.type === 'system' && \(message as any\)\.subtype === 'thinking_tokens'\)\) continue;/);
assert.match(fs.readFileSync(path.join(root,'src/services/claude/ClaudeSdkService.ts'),'utf8'),/includePartialMessages: false\n/);
assert.match(sessionSource,/if \(currentMessages\.length !== this\.messages\(\)\.length \|\| event\?\.type === 'user'\) this\.messages\(currentMessages\);/);
assert.match(chatPage,/if \(increased && followOutput && !selectingInConversation\(\)\)/);
assert.match(chatPage,/if \(isBusy\.value\) return/);
assert.match(sessionSource,/if\(this\.busy\(\)\)throw new Error/);
console.log('Pause/resend lifecycle passed: fresh channel with original session/options, immediate resend, stale result/finally isolation, duplicate send prevention, startup cancellation, locked request controls and stale permission cleanup.');

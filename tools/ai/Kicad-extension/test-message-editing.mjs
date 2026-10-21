import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript'),cache=new Map(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-edit-test-'));
function load(file){
 if(cache.has(file))return cache.get(file).exports;
 const module={exports:{}};cache.set(file,module);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name),process:{env:{CLAUDE_CONFIG_DIR:directory}},console,Date,Math,setTimeout,clearTimeout},{filename:file});return module.exports;
}
try {
 const {Session}=load(path.join(root,'src/webview/src/core/Session.ts')),{Message}=load(path.join(root,'src/webview/src/models/Message.ts')),{AsyncQueue}=load(path.join(root,'src/webview/src/transport/AsyncQueue.ts')),{signal}=require('alien-signals');
 const {recordMessageEdit,revisedSessionMessages}=load(path.join(root,'src/services/claude/messageEditStore.ts'));
 const id='11111111-1111-4111-8111-111111111111',sent=[],launches=[],queues=[],raw=[];
 let failSave=false,failSend=false;
 const connection={opened:Promise.resolve(),config:signal({modelSetting:'deepseek-flash',defaultCwd:'/same-project'}),permissionRequests:signal([]),
  launchClaude:(...args)=>{launches.push(args);const q=new AsyncQueue();queues.push(q);return q;},interruptClaude:()=>{},
  sendInput:(channel,message)=>{if(failSend)throw Error('send failure');sent.push(message);raw.push(message);},
  recordMessageEdit:async(session,originalId,replacementId)=>{if(failSave)throw Error('save failure');await recordMessageEdit(session,{originalId,replacementId});return {success:true}},
  getSession:async()=>({messages:await revisedSessionMessages(id,raw)})};
 const tick=()=>new Promise(r=>setTimeout(r,0)),context={currentSelection:signal(undefined)},session=new Session(async()=>connection,context);
 session.sessionId(id);session.permissionMode('bypassPermissions');session.thinkingLevel('high');
 const finish=async(text)=>{const answer={type:'assistant',message:{role:'assistant',content:[{type:'text',text}]}},result={type:'result',session_id:id,is_error:false};raw.push(answer,result);queues.at(-1).enqueue(answer);queues.at(-1).enqueue(result);await tick();};
 const users=()=>session.messages().filter(m=>m.type==='user'&&!m.isEmpty),text=m=>typeof m.message.content==='string'?m.message.content:m.message.content.map(w=>w.content.text||'').join('');
 await session.send('保留前一条');await finish('前一条的答复');
 await session.send('需要修改的消息');await finish('过期答复');
 const before=users()[0],original=users()[1];
 const attachment={fileName:'diagram.png',mediaType:'image/png',data:'aGVsbG8='};
 await session.resend(original,'修改后的需求',[attachment]);assert.equal(sent.length,3);assert.equal(users().length,2);assert.equal(users()[0],before);assert.equal(text(users()[1]),'修改后的需求');assert.ok(!session.messages().some(m=>text(m).includes('过期答复')));
 assert.equal(sent.at(-1).message.content[0].type,'image');assert.equal(sent.at(-1).message.content[0].source.data,attachment.data);
 // A replay from the SDK acknowledges the optimistic user message once.
 queues.at(-1).enqueue({...sent.at(-1),isReplay:true});await tick();assert.equal(users().length,2);await finish('更新后的答复');
 await session.resend(users()[1],'再次修改');assert.equal(users().length,2);await finish('再次更新的答复');
 assert.deepEqual(launches[0].slice(1),[id,'/same-project','deepseek-flash','bypassPermissions','high']);assert.equal(launches.length,1,'editing continues the same running session');
 const reopened=new Session(async()=>connection,context);reopened.sessionId(id);await reopened.loadFromServer();assert.equal(reopened.messages().filter(m=>m.type==='user'&&!m.isEmpty).length,2);assert.ok(reopened.messages().some(m=>text(m)==='再次修改'));assert.ok(!reopened.messages().some(m=>text(m)==='需要修改的消息'||text(m)==='修改后的需求'||text(m)==='过期答复'));
 // Same text entered normally represents a new request, never text-based deduplication.
 await session.send('再次修改');await finish('独立的新答复');assert.equal(users().length,3);assert.notEqual(users()[1].uuid,users()[2].uuid);
 const unchanged=session.messages(),sentCount=sent.length;
 failSave=true;await assert.rejects(session.resend(users()[2],'不能发送'),/save failure/);assert.equal(session.messages(),unchanged);assert.equal(sent.length,sentCount);assert.equal(session.busy(),false);failSave=false;
 failSend=true;await assert.rejects(session.resend(users()[2],'未入队的修改'),/send failure/);assert.equal(session.messages(),unchanged);assert.equal(sent.length,sentCount);failSend=false;
 assert.equal((await revisedSessionMessages(id,raw)).filter(m=>m.type==='user').length,3,'unaccepted replacement does not hide history');
 await session.resend(users()[2],'暂停中的修改');await session.interrupt();await session.resend(users()[2],'继续执行');assert.equal(users().length,3);assert.equal(launches.length,2);assert.deepEqual(launches.at(-1).slice(1),[id,'/same-project','deepseek-flash','bypassPermissions','high']);await finish('继续完成');
 await assert.rejects(session.resend(original,'旧引用'),/找不到/);assert.equal(sent.length,sentCount+2);
 await assert.rejects(recordMessageEdit('../escape',{originalId:before.uuid,replacementId:users()[2].uuid}),/标识/);
 // Concurrent saves must not overwrite revisions from another webview.
 const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',c='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 await Promise.all([recordMessageEdit(id,{originalId:a,replacementId:b}),recordMessageEdit(id,{originalId:b,replacementId:c})]);
 const compact=await revisedSessionMessages(id,[a,b,c].map(uuid=>({uuid,type:'user'})));assert.equal(compact.length,1);assert.equal(compact[0].uuid,c);
 for(const q of queues)q.done();
 assert.equal(Message.fromRaw({type:'user',uuid:a,message:{content:'历史消息'}}).uuid,a);
 console.log('Message editing passed: original slot replacement, repeated edits, preceding history, same session/model/permissions/effort, attachments, UUID echo dedup, persisted reopen, normal identical messages, failure preservation, pause/resend, stale reference, atomic concurrent storage.');
} finally {fs.rmSync(directory,{recursive:true,force:true});}

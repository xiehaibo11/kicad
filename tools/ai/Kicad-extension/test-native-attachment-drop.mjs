import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function load(file,mocks={}) {
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(read(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
    {module,exports:module.exports,require:name=>mocks[name] || require(name),URL,Buffer});
  return module.exports;
}
const drop=load('src/webview/src/utils/composerDrop.ts');
const selection=['/fixture/图片一.png','/fixture/image copy 2.png','/fixture/image copy 3.png','/fixture/image.png'];
const transfer=new Map([
  ['text/uri-list',{asString:async()=>`file://${selection[0]}`,asFile(){}}],
  ['application/vnd.code.uri-list',{asString:async()=>selection.map(value=>`file://${encodeURI(value)}`).join('\r\n'),asFile(){}}]
]);
const commands=new Map(),accepted=[],views=[];
const vscode={TreeItem:class {constructor(label){this.label=label;}},ThemeIcon:class {},TreeItemCollapsibleState:{None:0},
  commands:{registerCommand:(name,callback)=>{commands.set(name,callback);return {dispose(){}};},executeCommand:async name=>accepted.push({focus:name})},
  window:{createTreeView:(id,options)=>{views.push({id,options});return {dispose(){}};},showErrorMessage:error=>accepted.push({error})}};
const native=load('src/kicadAttachmentDrop.ts',{vscode,'./webview/src/utils/composerDrop':drop});
const token={isCancellationRequested:false};
assert.deepEqual([...await native.nativeDroppedPaths(transfer,token)],selection,'native API must retain the complete Explorer selection');
assert.deepEqual([...await native.nativeDroppedPaths(transfer,{isCancellationRequested:true})],[]);
assert.deepEqual([...await native.nativeDroppedPaths(new Map([['Files',{asFile:()=>({uri:{scheme:'file',fsPath:selection[1]}})}]]),token)],[selection[1]]);
native.registerNativeAttachmentDrop({subscriptions:[]},paths=>accepted.push({paths}));
assert.equal(views[0].id,'kicad.attachmentDrop');
const controller=views[0].options.dragAndDropController;
assert.ok(controller.dropMimeTypes.includes('application/vnd.code.uri-list'));
await controller.handleDrop(undefined,transfer,token);
assert.deepEqual([...accepted[0].paths],selection);assert.equal(accepted[1].focus,'kicad.chatView.focus');
await controller.handleDrop(undefined,transfer,{isCancellationRequested:true});assert.equal(accepted.length,2,'cancelled drops must not change the composer');

const {ComposerFileInbox}=load('src/composerFileInbox.ts');
const sent=[],inbox=new ComposerFileInbox(message=>sent.push(message));
inbox.enqueue(selection);assert.deepEqual(sent.map(item=>item.type),['kicad_composer_files_available'],'unmounted composer must not consume files');
inbox.attached();const first=sent.at(-1);assert.deepEqual([...first.paths],selection);assert.equal(first.type,'kicad_composer_files');
inbox.attached();assert.equal(sent.at(-1),first,'duplicate ready must not reapply a batch');
inbox.enqueue([selection[1]]);inbox.applied('unrelated');assert.equal(sent.filter(item=>item.type==='kicad_composer_files').length,1);
inbox.detached();inbox.attached();assert.equal(sent.at(-1).id,first.id,'remount retries unacknowledged batch with same identity');
inbox.applied(first.id);const second=sent.at(-1);assert.notEqual(second.id,first.id);assert.equal(second.paths.length,1);
inbox.applied(second.id);const count=sent.length;inbox.attached();inbox.notify();assert.equal(sent.length,count);
assert.throws(()=>inbox.enqueue(Array.from({length:101},(_,i)=>`/file-${i}`)),/100/);
assert.throws(()=>inbox.enqueue([]),/路径/);

const chat=read('src/webview/src/pages/ChatPage.vue'),script=chat.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
const tree=ts.createSourceFile('chat.ts',script,ts.ScriptTarget.Latest,true);
const receiver=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='receiveNativeFiles').getText(tree);
const added=[],ack=[],scope={nativeInput:{value:{addDroppedPaths:async paths=>added.push([...paths])}},nativeDropNotice:{value:''},
  nativeComposerMounted:true,appliedNativeBatches:new Set(),applyingNativeBatches:new Set(),postNative:message=>ack.push(message),nextTick:async()=>{}};
vm.runInNewContext(ts.transpileModule(receiver,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);
const receive=message=>scope.receiveNativeFiles({data:{type:'from-extension',message}});
await receive(first);await receive(first);assert.equal(added.length,1);assert.equal(ack.filter(item=>item.type==='kicad_composer_files_applied').length,2);
scope.nativeInput.value=null;await receive({type:'kicad_composer_files_available'});assert.match(scope.nativeDropNotice.value,/只读/);
await receive(second);assert.equal(added.length,1,'read-only history cannot discard pending files');
assert.match(chat,/ref="nativeInput"/);assert.match(read('src/webview/src/components/ChatInputBox.vue'),/defineExpose\(\{\s+addDroppedPaths/);
const manifest=JSON.parse(read('package.json'));
assert.ok(manifest.contributes.views['kicad-sidebar'].some(view=>view.id==='kicad.attachmentDrop'&&view.type!=='webview'));
assert.match(read('src/services/webViewService.ts'),/bootstrap.host === 'sidebar' && bootstrap.page === 'chat'/);
console.log('Native attachment drop passed: stable TreeView API, complete Explorer selection, cancellation, startup queue, remount retry, duplicate suppression, ordered acknowledgement, read-only history, current composer and no model invocation.');

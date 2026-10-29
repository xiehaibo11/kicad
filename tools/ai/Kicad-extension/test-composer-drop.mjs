import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';

const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
function load(file,mocks={}) {
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
    {module,exports:module.exports,require:name=>mocks[name] || require(name),URL,Buffer,process});
  return module.exports;
}
class Transfer {
  constructor(data={},files=[]) { this.data=data;this.files=files;this.types=[...Object.keys(data),...(files.length?['Files']:[])];this.items={add:file=>this.files.push(file)}; }
  getData(type){return Object.entries(this.data).find(([key])=>key.toLowerCase()===type.toLowerCase())?.[1] || '';}
}
const drop=load('src/webview/src/utils/composerDrop.ts');
const selection=['/fixture/原理图/image.png','/fixture/原理图/image copy 2.png','/fixture/原理图/image copy 3.png','/fixture/原理图/image copy.png'];
const uris=selection.map(file=>pathToFileURL(file).href);
assert.deepEqual([...drop.droppedFilePaths(new Transfer({'text/uri-list':uris[0],'application/vnd.code.uri-list':'# selection\r\n'+uris.join('\r\n')}))],selection);
for(const type of ['ResourceURLs','CodeFiles','CodeEditors']) {
  const values=type==='CodeFiles'?selection:type==='CodeEditors'?selection.map(path=>({resource:{scheme:'file',path}})):uris;
  const transfer=new Transfer({[type]:JSON.stringify(values),'text/uri-list':uris[0]});
  assert.equal(drop.isFileTransfer(transfer),true);assert.deepEqual([...drop.droppedFilePaths(transfer)],selection);
}
assert.deepEqual([...drop.droppedFilePaths(new Transfer({'ResourceURLs':'bad JSON','text/uri-list':uris[1]}))],[selection[1]]);
assert.deepEqual([...drop.droppedFilePaths(new Transfer({'text/uri-list':'https://example.com/private.png\nfile:///bad%ZZ.png'}))],[]);
assert.deepEqual([...drop.droppedFilePaths(new Transfer({'CodeEditors':JSON.stringify([{resource:{scheme:'https',path:'/secret'}},{resource:{scheme:'file',path:'relative'}},{resource:{scheme:'file',path:'/bad\0.png'}}]),'text/uri-list':'file:///bad%00.png'}))],[]);
assert.deepEqual([...drop.droppedFilePaths(new Transfer({'text/uri-list':'file:///C:/PCB%20Design/a.png'}))],['C:/PCB Design/a.png']);
assert.equal(drop.fileMention('PCB Design/read me.md'),'@"PCB Design/read me.md"');
assert.equal(drop.fileMention('schematic',true),'@schematic/');

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ki-drop-'));
const reads=[];
const vscode={FileType:{File:1,Directory:2},Uri:{file:fsPath=>({fsPath,toString:()=>pathToFileURL(fsPath).href}),parse:value=>({fsPath:fileURLToPath(value),toString:()=>value})},workspace:{workspaceFolders:[],fs:{
  stat:async uri=>{const stat=await fs.promises.stat(uri.fsPath);return {type:stat.isDirectory()?2:1,size:stat.size};},
  readFile:async uri=>{reads.push(uri.fsPath);return fs.promises.readFile(uri.fsPath);}
}}};
const {readDroppedFiles}=load('src/kicadAttachments.ts',{vscode});
try {
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yWQAAAABJRU5ErkJggg==','base64');
  for(const name of ['image.png','image copy 2.png','image copy 3.png','image copy.png'])fs.writeFileSync(path.join(tmp,name),png);
  fs.mkdirSync(path.join(tmp,'原理图 exports'));fs.writeFileSync(path.join(tmp,'notes.md'),'不要修改 PCB。');
  const result=await readDroppedFiles(['image.png','image copy 2.png','image copy 3.png','image copy.png','notes.md','原理图 exports','missing.png','https://example.com/a.png'],tmp);
  assert.equal(result.attachments.length,4);assert.equal(result.references.length,2);assert.equal(result.errors.length,2);
  for(const attachment of result.attachments){assert.equal(attachment.mediaType,'image/png');assert.deepEqual(Buffer.from(attachment.data,'base64'),png);}
  assert.equal(reads.length,4,'directories and code references must not be read');
  assert.equal((await readDroppedFiles([path.join(tmp,'image.png'),pathToFileURL(path.join(tmp,'image.png')).href],tmp)).attachments.length,1);
  const huge=path.join(tmp,'huge.png');fs.writeFileSync(huge,'');fs.truncateSync(huge,21*1024*1024);
  const oversized=await readDroppedFiles([huge,path.join(tmp,'image.png')],tmp);assert.equal(oversized.attachments.length,1);assert.match(oversized.errors[0],/20 MB/);assert.ok(!reads.includes(huge));
  await assert.rejects(()=>readDroppedFiles(Array(101).fill('a.png'),tmp),/100/);

  const input=fs.readFileSync(path.join(root,'src/webview/src/components/ChatInputBox.vue'),'utf8');
  const script=input.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1],tree=ts.createSourceFile('input.ts',script,ts.ScriptTarget.Latest,true);
  const names=['getWorkspaceRoot','toWorkspaceRelativePath','statPaths','handleDragOver','handleDragLeave','insertDroppedReferences','addDroppedPaths','handleDrop','handleSubmit'];
  const functions=tree.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text)).map(node=>node.getText(tree)).join('\n');
  const events=[],scope={...drop,DataTransfer:Transfer,content:{value:'草稿保留'},fileDragActive:{value:false},dropError:{value:''},props:{attachments:[],conversationWorking:false},isOptimizing:{value:false},
    textareaRef:{value:{textContent:'草稿保留',focus(){},contains(){return false;}}},placeCaretAtEnd(){},autoResizeTextarea(){},nextTick:fn=>fn(),
    localSlashAction:()=>undefined,
    emit:(type,payload)=>events.push({type,payload}),handleAddFiles:files=>events.push({type:'addAttachment',payload:[...files]}),
    runtime:{connectionManager:{get:async()=>({kicadDropFiles:async paths=>{assert.ok(paths.every(path=>selection.includes(path)));return result;},statPaths:async paths=>({entries:paths.map(path=>({path,type:'file'}))})})}}
  };
  vm.runInNewContext(ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);
  const event=(transfer,extra={})=>({dataTransfer:transfer,shiftKey:false,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra});
  const drag=event(new Transfer({'CodeFiles':JSON.stringify(selection)}));scope.handleDragOver(drag);assert.equal(drag.prevented,true);assert.equal(drag.dataTransfer.dropEffect,'copy');assert.equal(scope.fileDragActive.value,true);
  const ordinary=event(new Transfer({'text/plain':'拖动文字'}));scope.handleDragOver(ordinary);assert.equal(ordinary.prevented,false);
  await scope.handleDrop(ordinary);assert.equal(ordinary.prevented,false);
  const link=event(new Transfer({'text/uri-list':'https://example.com','text/plain':'https://example.com'}));await scope.handleDrop(link);assert.equal(link.prevented,false);
  const multi=event(new Transfer({'application/vnd.code.uri-list':uris.join('\r\n'),'text/uri-list':uris[0]}));
  const pending=scope.handleDrop(multi);multi.dataTransfer.data={};multi.dataTransfer.files=[];await pending;
  assert.equal(multi.prevented,true);assert.equal(events.filter(e=>e.type==='addAttachmentItems').at(-1).payload.length,4);assert.match(scope.content.value,/^草稿保留/);assert.match(scope.content.value,/@.*notes\.md/);assert.match(scope.dropError.value,/missing\.png/);
  events.length=0;scope.content.value='现有草稿';
  await scope.handleDrop(event(new Transfer({'text/uri-list':uris[1]}),{shiftKey:true}));
  assert.equal(events.some(e=>e.type==='addAttachmentItems'),true);assert.match(scope.content.value,/^现有草稿/);
  const native={name:'Finder image.png',size:png.length};await scope.handleDrop(event(new Transfer({},[native])));assert.equal(events.at(-1).payload[0],native);
  assert.equal(events.some(e=>e.type==='submit'),false,'dropping must never send a message');
  events.length=0;scope.content.value='';scope.props.attachments=result.attachments;scope.handleSubmit();assert.equal(events[0].type,'submit','image-only drafts must be sendable');
  assert.match(input,/@dragover="handleDragOver" @dragleave="handleDragLeave" @drop="handleDrop"/);
  for(const file of ['pages/ChatPage.vue','components/Messages/UserMessage.vue'])assert.match(fs.readFileSync(path.join(root,'src/webview/src',file),'utf8'),/@add-attachment-items=/);
  console.log('Composer file drop passed: four-image selection, private/public URI lists, CodeEditors/ResourceURLs/CodeFiles, Unicode and spaces, native FileList, text/link preservation, no required modifier, draft preservation, image bytes, partial failures and size limits, image-only send, edit composer and no automatic send.');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{loadHandlers}=require('./test-editor-images-loader.cjs');
const calls=[],documents=[],providers=new Map();let close,failOpen=false;
const vscode={
  Uri:{from:parts=>({...parts,toString(){return this.scheme+':'+encodeURI(this.path)+'?'+this.query;}})},ViewColumn:{One:1},
  workspace:{
    textDocuments:documents,
    registerTextDocumentContentProvider:(scheme,provider)=>{providers.set(scheme,provider);return {dispose(){providers.delete(scheme);}};},
    onDidCloseTextDocument:listener=>{close=listener;return {dispose(){close=undefined;}};},
    openTextDocument:async uri=>{
      if(failOpen)throw Error('Editor unavailable');
      const existing=documents.find(d=>d.uri.toString()===uri.toString());if(existing)return existing;
      const document={uri,getText:()=>providers.get(uri.scheme).provideTextDocumentContent(uri)};documents.push(document);return document;
    }
  },
  window:{showTextDocument:async(document,options)=>calls.push({document,options})},
  commands:{executeCommand:()=>assert.fail('Viewing content must never execute a command')}
};
const {registerToolContent,handleOpenContent}=loadHandlers(process.argv[2],vscode),context={subscriptions:[],logService:{info(){}},fileSystemService:{createTempFile(){assert.fail('Read-only content must never write a file');}}};
registerToolContent(context);
const open=(content,fileName)=>handleOpenContent({type:'open_content',content,fileName,editable:false},context,new AbortController().signal);
const command='cd /tmp\npython3 -c "print(\'命令 only\')"\n',output=Array.from({length:3000},(_,i)=>'line '+i+' 输出').join('\n');
assert.deepEqual(JSON.parse(JSON.stringify(await open(command,'command (test-1)'))),{type:'open_content_response'});
const first=calls[0].document;assert.equal(first.getText(),command);assert.equal(first.uri.path,'/command (test-1)');
assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options)),{viewColumn:1,preview:true,preserveFocus:true});
assert.ok(!first.uri.toString().includes('python3'),'URIs must not carry command contents');
await open(command,'command (test-1)');assert.equal(calls[1].document,first,'identical views reuse the document');
await open(output,'Bash tool output (test-1)');assert.equal(calls[2].document.getText(),output,'full output is preserved');
await open(output+'\nnew','Bash tool output (test-1)');assert.notEqual(calls[3].document.uri.toString(),calls[2].document.uri.toString(),'updated outputs have distinct snapshots');
await open('error','../错误\\report\n');assert.doesNotMatch(calls[4].document.uri.path.slice(1),/[\\/\n]/,'titles cannot escape the virtual URI filename');
const provider=providers.get(first.uri.scheme);documents.splice(documents.indexOf(first),1);close(first);assert.throws(()=>provider.provideTextDocumentContent(first.uri),/no longer available/);
await open(command,'command (test-1)');assert.equal(calls.at(-1).document.getText(),command,'a closed view can be reopened');
failOpen=true;await assert.rejects(open('failed snapshot','failure'),/Editor unavailable/);failOpen=false;
for(const disposable of context.subscriptions)disposable.dispose();assert.equal(providers.size,0);assert.throws(()=>provider.provideTextDocumentContent(calls.at(-1).document.uri),/no longer available/);
console.log('Tool content passed: production open_content handler, named full snapshots, deduplication, cleanup, retry and no file writes or command execution.');

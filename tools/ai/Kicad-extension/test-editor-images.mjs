import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{loadHandler}=require('./test-editor-images-loader.cjs');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-image-files-')),calls=[],logs=[];
let searches=0,failOpen=false;
const vscode={
 Uri:{file:fsPath=>({scheme:'file',fsPath})},ViewColumn:{One:1},
 commands:{executeCommand:async(...args)=>{calls.push(args);if(failOpen)throw Error('Image preview is unavailable');}},
 workspace:{openTextDocument:async uri=>{calls.push(['text',uri.fsPath]);return {}; }},
 window:{showTextDocument:async()=>({revealRange:()=>calls.push(['reveal-range']),set selection(value){calls.push(['selection']);}})},
 Position:class{constructor(line,character){this.line=line;this.character=character;}},Range:class{constructor(start,end){this.start=start;this.end=end;}},Selection:class{},TextEditorRevealType:{InCenter:0}
};
const context={logService:{error:message=>logs.push(message)},workspaceService:{getDefaultWorkspaceFolder:()=>({uri:{fsPath:directory}})},fileSystemService:{
 findFiles:async()=>{searches++;return [{path:path.join(directory,'wrong.png')}];},
 resolveExistingPath:async(file,cwd,results)=>{const exact=path.resolve(cwd,file);return fs.existsSync(exact)?exact:results[0]?.path||exact;}
}};
const open=loadHandler(process.argv[2],vscode),request=filePath=>({type:'open_file',filePath});
try{
 fs.mkdirSync(path.join(directory,'原理图 exports'));fs.writeFileSync(path.join(directory,'wrong.png'),'must not open');
 for(const ext of ['png','JPG','jpeg','jpe','gif','webp','bmp','ico','avif','svg']){
  const relative='原理图 exports/cleared.'+ext,absolute=path.join(directory,relative);fs.writeFileSync(absolute,'fixture');calls.length=0;
  assert.equal((await open(request(relative),context)).type,'open_file_response');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['vscode.openWith',{scheme:'file',fsPath:absolute},'imagePreview.previewEditor',{viewColumn:1,preview:true,preserveFocus:true}]]);
 }
 assert.equal(searches,0,'image requests never use fuzzy fallback');
 calls.length=0;await assert.rejects(open(request(path.join(directory,'missing.png')),context),/ENOENT/);assert.equal(calls.length,0,'missing images cannot open a different file');
 fs.writeFileSync(path.join(directory,'notes.txt'),'notes');calls.length=0;
 await open({...request('notes.txt'),location:{startLine:1,endLine:2}},context);assert.equal(calls[0][0],'text');assert.equal(calls[1][0],'reveal-range');assert.equal(calls[2][0],'selection');
 calls.length=0;await open(request(directory),context);assert.equal(calls[0][0],'revealInExplorer');
 failOpen=true;await assert.rejects(open(request('wrong.png'),context),/Image preview is unavailable/);assert.ok(logs.length>=2,'host errors remain observable');
 console.log('Editor images passed: native image editor, exact/relative/Unicode paths, supported formats, missing files, text selections and directories.');
}finally{fs.rmSync(directory,{recursive:true,force:true});}

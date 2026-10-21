import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
const source=fs.readFileSync(path.join(root,'src/webview/src/components/ChatInputBox.vue'),'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
const tree=ts.createSourceFile('composer.ts',source,ts.ScriptTarget.Latest,true);
const method=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='handleKeydown').getText(tree);
let accepted=0,navigated=0;
const scope={draftPredictionVisible:{value:false},acceptDraftPrediction:()=>accepted++,slashCompletion:{isOpen:{value:false},handleKeydown:()=>navigated++},fileCompletion:{isOpen:{value:false},handleKeydown:()=>navigated++}};
vm.runInNewContext(ts.transpileModule(method,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,scope);
function tab(extra={}){const e={key:'Tab',ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,isComposing:false,prevented:false,stopped:false,preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true},...extra};scope.handleKeydown(e);return e;}
for(const menu of [null,'slashCompletion','fileCompletion']){
  scope.slashCompletion.isOpen.value=menu==='slashCompletion';scope.fileCompletion.isOpen.value=menu==='fileCompletion';
  for(const visible of [false,true]){
    scope.draftPredictionVisible.value=visible;
    const before=accepted,e=tab();assert.equal(e.prevented,true);assert.equal(e.stopped,true);assert.equal(accepted,before+Number(visible));assert.equal(navigated,0,'Tab must not enter a completion/tool list');
  }
}
const before=accepted;tab({isComposing:true});assert.equal(accepted,before,'IME composition must not accept a prediction');
scope.slashCompletion.isOpen.value=false;scope.fileCompletion.isOpen.value=false;
const modified=tab({shiftKey:true});assert.equal(modified.prevented,false,'leave Shift+Tab to the existing mode-switch shortcut');
console.log('Composer keyboard passed: Tab is reserved with/without predictions and open completion menus, IME protected, Shift+Tab mode shortcut retained.');

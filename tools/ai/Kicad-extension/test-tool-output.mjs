import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
let created=0,shown=0,command,options;
const writes=[];
class EventEmitter{listeners=[];event=listener=>{this.listeners.push(listener);return {dispose(){}}};fire(text){writes.push(text);for(const listener of this.listeners)listener(text);}dispose(){}}
const vscode={EventEmitter,commands:{registerCommand(name,callback){assert.equal(name,'kicadAgent.showToolOutput');command=callback;return {dispose(){}};}},window:{createTerminal(value){created++;options=value;return {show(preserveFocus){assert.equal(preserveFocus,true);shown++;},dispose(){}};}}};
const cache=new Map();
function load(file){if(cache.has(file))return cache.get(file);const mod={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{module:mod,exports:mod.exports,process,Buffer,console,require:name=>name==='vscode'?vscode:name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name)});cache.set(file,mod.exports);return mod.exports;}
const {recordToolOutput,registerToolOutput}=load(path.join(root,'src/kicadToolOutput.ts')),context={subscriptions:[]};registerToolOutput(context);
recordToolOutput({session_id:'fixture',type:'assistant',message:{content:[{type:'tool_use',id:'a',name:'Bash',input:{command:'echo fixture'}}]}});
recordToolOutput({session_id:'fixture',type:'user',message:{content:[{type:'tool_result',tool_use_id:'a',is_error:true,content:'Exit code 1\nJSONDecodeError: Extra data\napi_key=fixture-private'}]}});
assert.equal(created,0);assert.equal(shown,0,'tool activity must not reveal/focus a UI');
command();options.pty.open();assert.equal(created,1);assert.equal(shown,1);assert.match(writes.at(-1),/JSONDecodeError/);assert.doesNotMatch(writes.join(''),/fixture-private/);assert.equal(options.pty.handleInput,undefined,'output terminal cannot execute shell input');
command();assert.equal(created,1);assert.equal(shown,2);options.pty.close();command();assert.equal(created,2,'closed terminal can be reopened with retained output');
const handlers=fs.readFileSync(path.join(root,'src/services/claude/handlers/handlers.ts'),'utf8');assert.match(handlers,/url==='kicad:\/\/tool-output'/);assert.match(handlers,/executeCommand\('kicadAgent.showToolOutput'\)/);
for(const disposable of context.subscriptions)disposable.dispose();
console.log('Tool output passed: passive terminal, explicit reveal only, retained failures, redaction, no shell input, exact host command.');

// Assert actual service options and state transitions; no credentials or model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
const transpile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};vm.runInNewContext(transpile(fs.readFileSync(path.join(root,'src/shared/kicadReasoning.ts'),'utf8')),{module:mod,exports:mod.exports});
const {reasoningOptions,normalizeReasoning,reasoningEnvironment}=mod.exports;
assert.deepEqual(Array.from(reasoningOptions('deepseek-flash'),v=>v.value),['default_on','off','low','high','max']);
assert.equal(normalizeReasoning('deepseek-flash','medium'),'default_on');
assert.equal(normalizeReasoning('haiku','max'),'default_on');
assert.throws(()=>reasoningEnvironment('haiku','max'),/不支持/);
assert.equal(reasoningEnvironment('deepseek-v4-pro','max').CLAUDE_CODE_EFFORT_LEVEL,'max');
function method(file,cls,name){const tree=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);return tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text===cls).members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(tree)===name).getText(tree)}
const change=method('src/services/claude/ClaudeAgentService.ts','ClaudeAgentService','setThinkingLevel');
const channel={model:'deepseek-flash',sessionId:'same-session',cwd:'/fixture',permissionMode:'bypassPermissions',thinkingLevel:'high',busy:false},launches=[];
const scope={Map,channel,launches,reasoningEnvironment};
vm.runInNewContext(transpile(`class Service {channels=new Map([['c1',channel]]);closeChannel(id,notify){if(notify)throw Error('must retain stream');this.channels.delete(id)};async launchClaude(...args){launches.push(args);this.channels.set('c1',{...channel,thinkingLevel:args[5]})};${change}};globalThis.service=new Service();`),scope);
await scope.service.setThinkingLevel('c1','max');assert.equal(launches.length,0);assert.equal(channel.needsRestart,true);assert.equal(channel.thinkingLevel,'max');assert.equal(channel.sessionId,'same-session');assert.equal(channel.permissionMode,'bypassPermissions');
await scope.service.setThinkingLevel('c1','max');assert.equal(launches.length,0);
scope.service.channels.get('c1').busy=true;await assert.rejects(scope.service.setThinkingLevel('c1','low'),/等待/);assert.equal(launches.length,0);
scope.service.channels.get('c1').busy=false;await assert.rejects(scope.service.setThinkingLevel('c1','medium'),/不支持/);assert.equal(launches.length,0);
const setter=method('src/webview/src/core/Session.ts','Session','setThinkingLevel');
let selected='high',fail=true;
const ui={normalizeReasoning,Map,fixture:{level:(...v)=>v.length?(selected=v[0]):selected,connection:{setThinkingLevel:async()=>{if(fail)throw Error('fixture failure')}}}};
vm.runInNewContext(transpile(`class Session {configurationChanging=()=>{};reasoningChanging=false;reasoningByModel=new Map();thinkingLevel=fixture.level;modelSelection=()=> 'deepseek-flash';claudeChannelId=()=> 'c1';async getConnection(){return fixture.connection};${setter}};globalThis.session=new Session();`),ui);
await assert.rejects(ui.session.setThinkingLevel('max'),/fixture failure/);assert.equal(selected,'high');
fail=false;await ui.session.setThinkingLevel('low');assert.equal(selected,'low');
console.log('Reasoning passed: provider capabilities, invalid effort rejection, same session and permissions, busy guard, no optimistic state on failure.');

// A model switch must not claim success or change the visible model on failure.
const modelSetter=method('src/webview/src/core/Session.ts','Session','setModel');
let model='deepseek-flash',modelFail=true;
const switching={normalizeReasoning,Map,fixture:{model:(...v)=>v.length?(model=v[0]):model,level:(...v)=>v.length?(selected=v[0]):selected,connection:{config:()=>undefined,updateExtensionConfig:async()=>({success:true}),setModel:async()=>{if(modelFail)throw Error('model failure');return {success:true}},setThinkingLevel:async()=>{}}}};
vm.runInNewContext(transpile(`class Session {busy=()=>false;configurationChanging=()=>{};reasoningChanging=false;reasoningByModel=new Map();thinkingLevel=fixture.level;modelSelection=fixture.model;claudeChannelId=()=> 'c1';async getConnection(){return fixture.connection};${setter};${modelSetter}};globalThis.session=new Session();`),switching);
selected='max';await assert.rejects(switching.session.setModel({value:'sonnet'}),/model failure/);assert.equal(model,'deepseek-flash');assert.equal(selected,'max');
modelFail=false;await switching.session.setModel({value:'sonnet'});assert.equal(model,'sonnet');assert.equal(selected,'default_on');
await switching.session.setThinkingLevel('medium');await switching.session.setModel({value:'deepseek-flash'});assert.equal(selected,'default_on');
await switching.session.setModel({value:'sonnet'});assert.equal(selected,'medium');
console.log('Model changes passed: failure retains old selection, unsupported effort resets, remembered per-model choice restores.');

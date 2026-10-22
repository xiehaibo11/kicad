// Exercise the shipped resolver and actual channel switch method without real keys.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=process.argv[2], require=createRequire(path.join(root,'package.json')),ts=require('typescript');
const transpile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const settings={},userFile={apiKey:'fixture-only',baseUrl:'https://custom-provider.invalid/anthropic/'};
const mod={exports:{}};
vm.runInNewContext(transpile(fs.readFileSync(path.join(root,'src/kicadProviders.ts'),'utf8')),{
  module:mod,exports:mod.exports,URL,process:{env:{}},
  require:name=>name==='vscode'?{workspace:{getConfiguration:()=>({get:(key,fallback)=>settings[key]??fallback})}}:name==='node:fs'?{readFileSync:()=>JSON.stringify(userFile)}:require(name),
});
assert.equal((await mod.exports.resolveDeepSeekCredentials()).baseUrl,'https://custom-provider.invalid/anthropic');
settings['deepseek.baseUrl']=' https://explicit.invalid/anthropic ';
assert.equal((await mod.exports.resolveDeepSeekCredentials()).baseUrl,'https://explicit.invalid/anthropic');
settings['deepseek.baseUrl']='file:///secret';
await assert.rejects(mod.exports.resolveDeepSeekCredentials(),/HTTP/);
delete settings['deepseek.baseUrl']; delete userFile.baseUrl;
assert.equal((await mod.exports.resolveDeepSeekCredentials()).baseUrl,'https://api.deepseek.com/anthropic');
const source=fs.readFileSync(path.join(root,'src/services/claude/ClaudeAgentService.ts'),'utf8');
const tree=ts.createSourceFile('service.ts',source,ts.ScriptTarget.Latest,true);
const cls=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='ClaudeAgentService');
const method=cls.members.find(node=>ts.isMethodDeclaration(node)&&node.name.getText(tree)==='setModel').getText(tree);
let direct=0,launches=[],closed=[];
const channel={model:'deepseek-flash',cwd:'/project',sessionId:'session-preserved',permissionMode:'acceptEdits',thinkingLevel:'off',busy:false,query:{setModel:async()=>{direct++}}};
const reasonMod={exports:{}};vm.runInNewContext(transpile(fs.readFileSync(path.join(root,'src/shared/kicadReasoning.ts'),'utf8')),{module:reasonMod,exports:reasonMod.exports});
const scope={channel,launches,closed,Map,normalizeReasoning:reasonMod.exports.normalizeReasoning};
vm.runInNewContext(transpile(`class Service {
  channels=new Map([['c1',channel]]);logService={info(){},warn(){}};
  closeChannel(id,notify){closed.push({id,notify});this.channels.delete(id)}
  async launchClaude(...args){launches.push(args);this.channels.set(args[0],{...channel,model:args[3]})}
  ${method}
};globalThis.service=new Service();`),scope);
await scope.service.setModel('c1','sonnet');
assert.equal(direct,0);assert.equal(launches.length,0);
assert.equal(channel.model,'sonnet');assert.equal(channel.sessionId,'session-preserved');assert.equal(channel.permissionMode,'acceptEdits');assert.equal(channel.thinkingLevel,'off');
assert.equal(closed.length,0,'Selection must not close the frontend stream or SDK');
await scope.service.setModel('c1','deepseek-v4-pro');assert.equal(launches.length,0);assert.equal(channel.model,'deepseek-v4-pro');
scope.service.channels.get('c1').busy=true;
await assert.rejects(scope.service.setModel('c1','sonnet'),/等待/);assert.equal(launches.length,0);
scope.service.channels.get('c1').busy=false;
await scope.service.setModel('c1','deepseek-flash');assert.equal(launches.length,0);assert.equal(channel.needsRestart,true,'Manual send must use a fresh environment even within one provider');
assert.ok(source.includes('if (active?.query !== query) return;'),'Old process output cannot enter replacement');
console.log('Provider routing passed: endpoint precedence, validation, cross-provider and DeepSeek model changes, resume identity, modes and busy guard.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {DemandCatalog} from '../composer/demand.ts';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
function load(file,imports={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports,require:name=>imports[name]??require(name),console});return module.exports;}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-slash-'));let starts=0,executions=0,closes=0,document,command;
let settings={mcpMode:'onDemand',skillsMode:'onDemand',skillRoots:[tmp],disabledSkills:[],disabledServers:[]};
const runtime={kicadToolSettings:()=>settings,createDemandCatalog:(cwd,servers,_files,_disabled,max,options)=>{
 assert.deepEqual(Object.keys(servers),[]);
 const catalog=new DemandCatalog({cwd,skillRoots:[tmp],skills:options.skillsMode!=='off',disabledSkills:settings.disabledSkills,maxResults:max,servers:{},builtins:async()=>[{name:'kicad_reference',description:'engineering references',inputSchema:{type:'object'},execute(){executions++;}}],connect:async()=>{starts++;throw Error('No MCP connection while browsing');}});
 const close=catalog.close.bind(catalog);catalog.close=async()=>{closes++;await close();};return catalog;
}};
const host=load('src/kicadSlashHost.ts',{'./kicadRuntime':runtime,vscode:{commands:{executeCommand:async name=>{command=name}},workspace:{openTextDocument:async data=>{document=data;return data}},window:{showTextDocument:async()=>{}}}});
try{
 fs.mkdirSync(path.join(tmp,'board-review'));fs.writeFileSync(path.join(tmp,'board-review/SKILL.md'),'---\nname: board-review\ndescription: Inspect the board\n---\nBODY_MUST_NOT_ENTER_MENU\n');
 const signal=new AbortController().signal;
 const tools=await host.slashCatalog({kind:'tool',query:'references'},tmp,signal);assert.equal(tools.results[0].id,'tool:kicad_reference');
 const skills=await host.slashCatalog({kind:'skill',query:''},tmp,signal);assert.equal(skills.results[0].name,'board-review');assert.ok(!JSON.stringify(skills).includes('BODY_MUST_NOT_ENTER_MENU'));
 settings={...settings,skillsMode:'off'};await assert.rejects(()=>host.slashCatalog({kind:'skill',query:''},tmp,signal),/turned off/);
 assert.equal(closes,3);assert.equal(starts,0);assert.equal(executions,0);
 await host.localSlash({action:'mcp'},tmp,{private:{env:{TOKEN:'do-not-display'},url:'https://example.test/secret-token'},disabled:{disabled:true}});
 assert.ok(!document.content.includes('secret-token'));assert.ok(!document.content.includes('do-not-display'));assert.equal(JSON.parse(document.content).servers[1].enabled,false);
 await host.localSlash({action:'doctor'},tmp,{});assert.equal(command,'kicadAgent.promptAudit');
 await assert.rejects(()=>host.localSlash({action:'arbitrary-command'},tmp,{}),/Unsupported/);
 const catalog=load('src/shared/kicadSlash.ts');
 const provider=load('src/webview/src/providers/slashCommandProvider.ts',{'../../../shared/kicadSlash':catalog,'../core/runtimeTransport':{transport:{slashCatalog:async()=>skills}}});
 for(const model of ['claude-opus-4-6','deepseek-flash','codex:gpt-6.1-sol']){
  const commands=provider.getSlashCommands('',{model,appContext:{commandRegistry:{getCommandsBySection:()=>({'Slash Commands':[]})}}});
  assert.ok(Array.isArray(commands));assert.ok(commands.some(item=>item.label==='/tools'));assert.ok(commands.some(item=>item.label==='/skills'));
 }
 const entries=await provider.getSlashCommands('skill:board',undefined,signal);assert.match(entries[0].draft,/Use the skill.*board-review/);
 assert.equal(catalog.localSlashAction('/doctor prompt-audit'),'doctor');assert.equal(catalog.localSlashAction('ask about /model'),undefined);
 console.log('Slash menu passed: provider-independent local entries, bounded metadata-only discovery, disabled skills, cleanup, secret-free MCP view and no model/tool/MCP execution.');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}

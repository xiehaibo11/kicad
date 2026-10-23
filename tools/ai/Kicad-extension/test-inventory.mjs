// Assembled settings inventory: host requests, Kicad toggles and verified permission cleanup
// against fixture files. No MCP server, hook or CLI is started.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=process.argv[2],requireRoot=createRequire(path.join(root,'package.json')),ts=requireRoot('typescript'),require=createRequire(import.meta.url);
const base=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-inventory-host-')),home=path.join(base,'home'),cwd=path.join(base,'repo');
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value,null,2));};
write(path.join(home,'.claude/settings.json'),{permissions:{allow:['mcp__kicad__kicad_call','Bash(git log:*)']}});
write(path.join(cwd,'.claude/settings.local.json'),{permissions:{allow:['Bash(./build/bin/kicad-agent:*)','mcp__kicad__kicad_board','mcp__kicad__capability_call','Bash(git status:*)'],deny:['mcp__kicad__kicad_project']}});
write(path.join(cwd,'.claude/skills/review/SKILL.md'),'---\nname: review\ndescription: Review\n---\nbody\n');
// MCP servers configured in other tools: user files are synced, a repository file of another tool is not.
write(path.join(home,'.codex/config.toml'),'[mcp_servers.codex_docs]\ncommand = "node"\nargs = ["docs.js"]\n');
write(path.join(home,'.cursor/mcp.json'),{mcpServers:{cursor_web:{url:'https://cursor.test/mcp'}}});
write(path.join(cwd,'.cursor/mcp.json'),{mcpServers:{repo_only:{command:'sh'}}});
const previousHome=process.env.HOME;process.env.HOME=home;
const updates=[],config={vscode:{}};
const vscode={
  Uri:{file:fsPath=>({fsPath})},ConfigurationTarget:{Global:1,Workspace:2,WorkspaceFolder:3},
  workspace:{workspaceFolders:[{uri:{fsPath:cwd}}],getConfiguration:()=>({
    inspect:key=>({globalValue:config.vscode[key]}),get:(key,fallback)=>config.vscode[key]??fallback,
    update:async(key,value,target)=>{updates.push({key,value,target});config.vscode[key]=value;},
  })},
};
const SOURCES=['claude-code','claude-desktop','cursor','vscode','windsurf','codex','opencode'];
const settings=()=>({mcpMode:'onDemand',skillsMode:'onDemand',mcpSync:config.vscode['mcp.sync']??SOURCES,disabledServers:config.vscode['mcp.disabledServers']||[],disabledSkills:config.vscode['skills.disabled']||[],skillRoots:[],subagents:true,disabledSections:[]});
const cache=new Map();
function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{module,exports:module.exports,process,console,Buffer,require:name=>{
    if(name==='vscode')return vscode;
    if(name.startsWith('node:'))return require(name);
    if(name==='./kicadRuntime')return {kicadToolSettings:settings,kicadAgents:s=>s.subagents?{'kicad-reviewer':{description:'Reviews'}}:undefined};
    if(name.startsWith('./'))return load(path.resolve(path.dirname(file),name+'.ts'));
    throw Error('Unexpected inventory dependency: '+name);
  }},{filename:file});
  return module.exports;
}
try{
  const loaded=load(path.join(root,'src/kicadInventoryHost.ts'));
  // Results cross the vm realm; compare them as plain data.
  const plain=value=>JSON.parse(JSON.stringify(value)),host=Object.fromEntries(Object.entries(loaded).map(([name,fn])=>[name,async(...args)=>plain(await fn(...args))]));
  const first=await host.kicadInventory();
  assert.deepEqual(first.servers[0].tools,['capability_search','capability_call','capability_inspect'],'built-in tools follow the sub-agent setting');
  assert.deepEqual(first.agents.map(a=>a.name),['kicad-reviewer']);
  assert.ok(first.hooks.filter(h=>h.scope==='builtin').length>=6,'built-in hooks are listed');
  assert.deepEqual(first.permissions.map(p=>[p.scope,p.list,p.rule]),[
    ['user','allow','mcp__kicad__kicad_call'],['local','allow','Bash(./build/bin/kicad-agent:*)'],['local','allow','mcp__kicad__kicad_board'],['local','deny','mcp__kicad__kicad_project']]);

  // Other tools' servers are listed with their source; a repository file of another tool is never used.
  const server=(inventory,name)=>inventory.servers.find(item=>item.name===name);
  assert.deepEqual([server(first,'codex_docs').source,server(first,'codex_docs').flags],['Codex',[]]);
  assert.deepEqual([server(first,'cursor_web').source,server(first,'cursor_web').transport],['Cursor','http']);
  assert.deepEqual(server(first,'repo_only').flags.map(flag=>flag.kind),['ignored']);
  assert.deepEqual(first.mcpSources.filter(item=>item.files.length).map(item=>[item.id,item.enabled,item.files.map(file=>file.used)]),[['cursor',true,[true,false]],['codex',true,[true]]]);
  await host.setKicadSync('codex',false);
  assert.deepEqual(plain(updates.at(-1)),{key:'mcp.sync',value:SOURCES.filter(id=>id!=='codex'),target:1});
  assert.deepEqual(server(await host.kicadInventory(),'codex_docs').flags.map(flag=>flag.kind),['disabled'],'turning a source off is visible immediately');
  await host.setKicadSync('codex',true);assert.equal(updates.at(-1).value,undefined,'the full list is the default and stored as no value');
  await assert.rejects(()=>host.setKicadSync('unknown',true),/Unknown MCP source/);

  // Toggles edit only the Kicad disable lists the catalog obeys.
  await host.setKicadEnabled('skill','review',false);
  assert.deepEqual(plain(updates.at(-1)),{key:'skills.disabled',value:['review'],target:1});
  assert.deepEqual((await host.kicadInventory()).skills.find(s=>s.name==='review').flags.map(f=>f.kind),['disabled']);
  await host.setKicadEnabled('skill','review',true);assert.equal(updates.at(-1).value,undefined,'an empty list is removed');
  await host.setKicadEnabled('server','docs',false);assert.deepEqual(plain(updates.at(-1)),{key:'mcp.disabledServers',value:['docs'],target:1});

  // Cleanup writes through the settings service, reads the file back and ignores unreported rules.
  const writes=[],service={activeProfile:null,async updateSetting(key,value,target){writes.push(target);const file=target==='local'?path.join(cwd,'.claude/settings.local.json'):target==='global'?path.join(home,'.claude/settings.json'):path.join(cwd,'.claude/settings.json');const data=JSON.parse(fs.readFileSync(file,'utf8'));if(value===undefined)delete data[key];else data[key]=value;fs.writeFileSync(file,JSON.stringify(data));}};
  const local=first.permissions.filter(p=>p.scope==='local').map(({scope,list,rule})=>({scope,list,rule}));
  const result=await host.cleanKicadPermissions(service,[...local,{scope:'local',list:'allow',rule:'Bash(git status:*)'}]);
  assert.equal(result.removed.length,3);assert.deepEqual(result.skipped,[]);assert.deepEqual(writes,['local']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd,'.claude/settings.local.json'),'utf8')).permissions,{allow:['mcp__kicad__capability_call','Bash(git status:*)']},'only reported rules are removed; an emptied list disappears');
  assert.deepEqual(result.inventory.permissions.map(p=>p.scope),['user']);

  // With a profile active, settings.json is not edited from here.
  const profile={...service,activeProfile:'work'};writes.length=0;
  const blocked=await host.cleanKicadPermissions(profile,[{scope:'user',list:'allow',rule:'mcp__kicad__kicad_call'}]);
  assert.deepEqual([blocked.removed.length,blocked.skipped[0]?.reason,writes.length],[0,'A settings profile is active.',0]);

  // The assembled runtime gives a Claude session the synced servers; only heavy SDK modules are stubbed.
  const sdkStubs={'@anthropic-ai/claude-agent-sdk':{createSdkMcpServer:options=>({type:'sdk',name:options.name,instance:{_registeredTools:{}}}),tool:(name,description,args,handler)=>({name,description,args,handler})},
    './shared/kicadLocalTools':{localToolBindings:()=>[],localToolDefinitions:[]},'./shared/kicadDiagnostics':{diagnosticReport:()=>({})},'./shared/kicadPromptAudit':{promptAudit:()=>({})},'./kicadToolsPolicy':{needsKiCadTools:()=>true}};
  for(const name of ['client/index.js','client/stdio.js','client/sse.js','client/streamableHttp.js','types.js'])sdkStubs['@modelcontextprotocol/sdk/'+name]=new Proxy({},{get:()=>class{}});
  const runtimeCache=new Map();
  const loadRuntime=file=>{
    if(runtimeCache.has(file))return runtimeCache.get(file).exports;
    const module={exports:{}};runtimeCache.set(file,module);
    const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(js,{module,exports:module.exports,process,console,Buffer,URL,setTimeout,clearTimeout,require:name=>{
      if(name==='vscode')return {...vscode,extensions:{getExtension:()=>({extensionPath:root})},window:{}};
      if(sdkStubs[name])return sdkStubs[name];
      if(name.startsWith('node:'))return require(name);
      if(name==='zod'||name==='jsonc-parser')return requireRoot(name);
      if(name.startsWith('./'))return loadRuntime(path.resolve(path.dirname(file),name+'.ts'));
      throw Error('Unexpected runtime dependency: '+name);
    }},{filename:file});
    return module.exports;
  };
  const runtime=loadRuntime(path.join(root,'src/kicadRuntime.ts'));
  const session=await runtime.getKiCadSdkSession(cwd,{kicad_own:{command:'own'}},{tools:false});
  const listed=plain(await session.catalog.search({query:'',kind:'server'})).results.map(item=>item.name);
  assert.deepEqual(listed.sort(),['codex_docs','cursor_web','kicad_own'],'the agent can find servers from other tools; repository files of other tools stay out');
  await session.catalog.close();

  // The pages are wired into the assembled webview and host.
  const read=file=>fs.readFileSync(path.join(root,file),'utf8');
  for(const tab of ['Skills','Hooks','Plugins','SlashCommands'])assert.doesNotMatch(read('src/webview/src/components/settings/tabs/SettingsTab'+tab+'.vue'),/Coming Soon/,tab+' is implemented');
  assert.match(read('src/webview/src/components/settings/tabs/SettingsTabMCPServers.vue'),/<KicadMcpInventory \/>/);
  assert.match(read('src/webview/src/components/settings/tabs/SettingsTabPermissions.vue'),/<KicadPermissionCleanup \/>/);
  for(const type of ['kicad_inventory','kicad_set_enabled','kicad_clean_permissions'])assert.match(read('src/services/claude/ClaudeAgentService.ts'),new RegExp('case "'+type+'"'));
  console.log('Settings inventory passed: built-in tools/agents/hooks, Kicad toggles, verified rule cleanup, profile guard, pages wired.');
}finally{process.env.HOME=previousHome;fs.rmSync(base,{recursive:true,force:true});}

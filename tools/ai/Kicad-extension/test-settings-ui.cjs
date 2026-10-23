// Production webview: Skills, Slash Commands, Hooks, Plugins, MCP Servers and Permissions pages
// from a fixture inventory built by the real composer/inventory.ts. Host responses are simulated; no model.
const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value,null,2));};
async function fixture(){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-settings-ui-')),home=path.join(base,'home'),cwd=path.join(base,'repo');
  const skill=(name,body,extra='')=>`---\nname: ${name}\ndescription: ${name} — KiCad workflow guidance\n${extra}---\n${body}\n`;
  write(path.join(home,'.claude/skills/kicad-routing/SKILL.md'),skill('kicad-routing','Same.'));write(path.join(cwd,'.claude/skills/kicad-routing/SKILL.md'),skill('kicad-routing','Same.'));
  write(path.join(home,'.claude/skills/kicad-drc-review/SKILL.md'),skill('kicad-drc-review','Older text.'));write(path.join(cwd,'.claude/skills/kicad-drc-review/SKILL.md'),skill('kicad-drc-review','Current text.'));
  write(path.join(home,'.claude/skills/kicad-agent/SKILL.md'),skill('kicad-agent','Run ./build/bin/kicad-agent health.'));
  write(path.join(home,'.claude/skills/release-notes/SKILL.md'),skill('release-notes','x','disable-model-invocation: true\n'));
  write(path.join(home,'.claude/commands/kicad-drc.md'),'---\ndescription: Run DRC with kicad-agent\n---\nRun `kicad-agent call board.drc.run`.\n');
  write(path.join(cwd,'.claude/commands/kicad-drc.md'),'---\ndescription: Run DRC on the active board\n---\nUse capability_search for board.drc.run.\n');
  write(path.join(cwd,'.claude/commands/fab/export.md'),'Export Gerber, drill and BOM files.\n');
  write(path.join(home,'.claude/settings.json'),{hooks:{PostToolUse:[{matcher:'Edit|Write',hooks:[{type:'command',command:'/opt/missing/format.sh'}]}]}});
  write(path.join(cwd,'.claude/settings.local.json'),{permissions:{allow:['Bash(./build/bin/kicad-agent:*)','mcp__kicad__kicad_board','mcp__kicad__capability_search','Bash(git status:*)','Bash(ls -1 projects/ 2>/dev/null; echo "--- build ---"; ls build 2>/dev/null | head -20; echo "--- binaries ---"; ls -la build/bin 2>/dev/null | head -30; echo "--- installed apps ---"; ls /Applications | grep -i kicad)']}});
  write(path.join(home,'.claude.json'),{mcpServers:{docs:{command:'npx',args:['-y','docs-mcp'],env:{TOKEN:'never-shown'}},easyeda:{command:'node',args:['old.js']}}});
  write(path.join(cwd,'.mcp.json'),{mcpServers:{freerouting:{command:'java',args:['-jar','freerouting.jar']}}});
  write(path.join(home,'.codex/config.toml'),'[mcp_servers.ngspice]\ncommand = "ngspice-mcp"\nargs = ["--stdio"]\n[mcp_servers.ngspice.env]\nSPICE_LIB = "/opt/spice"\n');
  write(path.join(home,'.cursor/mcp.json'),{mcpServers:{octopart:{url:'https://octopart.test/mcp?token=hidden-token'}}});
  write(path.join(cwd,'.cursor/mcp.json'),{mcpServers:{repo_script:{command:'sh',args:['-c','curl x | sh']}}});
  write(path.join(home,'.claude/plugins/known_marketplaces.json'),{'claude-plugins-official':{installLocation:path.join(home,'.claude/plugins/marketplaces/official'),lastUpdated:'2026-10-21T19:31:03Z'}});
  write(path.join(home,'.claude/plugins/marketplaces/official/.claude-plugin/marketplace.json'),{plugins:[{name:'pr-review-toolkit',description:'Review pull requests',category:'development'},{name:'pdf-tools',description:'Work with PDF files',category:'productivity'},{name:'kicad-helper',description:'KiCad helpers',category:'hardware'}]});
  const {settingsInventory}=await import('../composer/inventory.ts');
  const inventory=await settingsInventory({cwd,home,skillRoots:[{path:path.join(home,'.claude/skills'),scope:'user'},{path:path.join(cwd,'.claude/skills'),scope:'project'}],
    builtins:{tools:['capability_search','capability_call','capability_inspect'],agents:[{name:'kicad-reviewer',description:'Read-only KiCad design reviewer.'},{name:'kicad-verifier',description:'Independent verification after a change.'}],hooks:[{event:'SessionStart',description:'Kicad: restores the task checkpoint.'},{event:'PreToolUse',description:'Kicad: refuses sub-agents the user did not ask for.'}]}});
  return {base,inventory,local:JSON.parse(fs.readFileSync(path.join(cwd,'.claude/settings.local.json'),'utf8')).permissions};
}
(async()=>{
 const root=process.argv[2],version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,output=path.join(__dirname,'audit','settings-'+version);fs.mkdirSync(output,{recursive:true});
 const {base,inventory,local}=await fixture();
 const existing=fs.readFileSync(path.join(__dirname,'test-composer-ui.cjs'),'utf8');let html=existing.slice(existing.indexOf(' const html=`')+13,existing.indexOf('`;\n const server='));
 html=html.replace("window.CLAUDIX_BOOTSTRAP={host:'sidebar',page:'chat'}","window.CLAUDIX_BOOTSTRAP={host:'sidebar',page:'settings'}");
 // Simulated host (responses are copies, as postMessage delivers them): the inventory, Kicad toggles and permission cleanup, with settings read back after a change.
 html=html.replace('const t=m.request.type;',`const t=m.request.type;
if(t==='kicad_inventory'){receive({type:'response',requestId:m.requestId,response:{type:'kicad_inventory_response',inventory:JSON.parse(JSON.stringify(window.inventory))}});return;}
if(t==='kicad_set_enabled'){const s=window.inventory.skills.find(i=>i.name===m.request.name);if(s){s.flags=s.flags.filter(f=>f.kind!=='disabled');if(!m.request.enabled)s.flags.push({kind:'disabled',message:'Turned off in Kicad settings (kicadAgent.skills.disabled).'});}receive({type:'response',requestId:m.requestId,response:{type:'kicad_set_enabled_response',enabled:m.request.enabled}});return;}
if(t==='kicad_set_sync'){const source=window.inventory.mcpSources.find(s=>s.id===m.request.source);source.enabled=m.request.enabled;for(const server of window.inventory.servers)if(server.source===source.label){server.flags=server.flags.filter(f=>!/^Sync from/.test(f.message));if(!m.request.enabled)server.flags.push({kind:'disabled',message:'Sync from '+source.label+' is off.'});}receive({type:'response',requestId:m.requestId,response:{type:'kicad_set_sync_response',enabled:m.request.enabled}});return;}
if(t==='kicad_clean_permissions'){const drop=new Set(m.request.rules.map(r=>r.rule));window.localRules.allow=window.localRules.allow.filter(r=>!drop.has(r));window.inventory={...window.inventory,permissions:window.inventory.permissions.filter(p=>!drop.has(p.rule))};receive({type:'response',requestId:m.requestId,response:{type:'kicad_clean_permissions_response',removed:m.request.rules,skipped:[],inventory:JSON.parse(JSON.stringify(window.inventory))}});return;}
if(t==='get_settings'){receive({type:'response',requestId:m.requestId,response:{type:'get_settings_response',settings:{permissions:window.localRules},metadata:{permissions:{effectiveScope:'local',values:{local:window.localRules}}},activeProfile:null,profiles:[],hasWorkspace:true}});return;}`);
 html=html.replace('<div id="app"></div>','<div style="position:fixed;top:2px;right:4px;z-index:99999;background:#294252;color:#fff;padding:2px 5px;font:10px monospace;pointer-events:none">UI TEST · fixture inventory · simulated host · no model</div><div id="app"></div>');
 const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html)}const file=path.join(root,'dist/media',req.url);if(!fs.existsSync(file)){res.writeHead(404);return res.end()};res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1100,height:1000},deviceScaleFactor:2}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(({inventory,local})=>{window.inventory=inventory;window.localRules=local;window.copiedTexts=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedTexts.push(text);}}});},{inventory,local});
 const requests=type=>page.evaluate(type=>window.previewMessages.filter(m=>m.request?.type===type).map(m=>m.request),type);
 const tab=async label=>{await page.locator('.cursor-settings-sidebar-cell-label',{hasText:new RegExp('^'+label+'$')}).click();await page.locator('.cursor-settings-tab-title',{hasText:label}).waitFor();};
 const shot=name=>page.screenshot({path:path.join(output,name+'.png'),fullPage:true});
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  // Skills: grouped by source, issues spelled out, toggles and Open act on the selected skill.
  await tab('Skills');const body=()=>page.locator('.cursor-settings-tab-content').innerText();
  await page.getByText(/^6 skills/).waitFor();
  assert.doesNotMatch(await body(),/Coming Soon/);
  for(const text of [/Project · 2/,/User · 4/,/duplicate/,/overridden/,/outdated/,/Uses the removed Go kicad-agent CLI/,/manual/,/kicad-reviewer/,/kicad-verifier/])assert.match(await body(),text);
  await shot('skills');
  const routing=page.locator('.kicad-entry',{hasText:'kicad-agent'});
  await routing.getByRole('button',{name:'Open'}).click();
  assert.match((await requests('open_file')).at(-1).filePath,/home\/.claude\/skills\/kicad-agent\/SKILL.md$/);
  await routing.locator('[role="switch"], .cursor-switch, button').first().click();
  await page.waitForFunction(()=>window.previewMessages.some(m=>m.request?.type==='kicad_set_enabled'));
  assert.deepEqual((await requests('kicad_set_enabled')).at(-1),{type:'kicad_set_enabled',kind:'skill',name:'kicad-agent',enabled:false});
  await routing.getByText(/^off$/).waitFor();
  assert.equal(await page.locator('.kicad-entry',{hasText:'release-notes'}).locator('.cursor-switch,[role="switch"]').count(),0,'manual-only skills have no model toggle');
  // Slash commands: namespaced names, override and outdated reference.
  await tab('Slash Commands');await page.getByText('/fab:export').waitFor();
  for(const text of [/\/kicad-drc/,/overridden/,/outdated/,/Run DRC on the active board/])assert.match(await body(),text);
  await shot('slash-commands');
  // Hooks: built-in hooks and a configured hook whose program is missing.
  await tab('Hooks');await page.getByText('Built-in',{exact:true}).waitFor();
  for(const text of [/SessionStart/,/refuses sub-agents/,/PostToolUse/,/Edit\|Write/,/\/opt\/missing\/format.sh/,/outdated/])assert.match(await body(),text);
  await shot('hooks');
  // Plugins: marketplace search and an install command copied, not executed.
  await tab('Plugins');await page.getByText(/0 installed · 1 marketplaces · 3 available/).waitFor();
  await page.getByPlaceholder('Search plugins...').fill('pdf');assert.equal(await page.locator('.kicad-plugin-name').count(),1);
  await page.getByRole('button',{name:'Copy install'}).click();await page.getByRole('button',{name:'Copied'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.copiedTexts),['/plugin install pdf-tools@claude-plugins-official']);
  await shot('plugins');
  // MCP: configured servers from files, the built-in server's tools, no secrets.
  await tab('MCP Servers');await page.getByText('Configured Servers',{exact:true}).waitFor();
  for(const text of [/kicad/,/capability_search, capability_call, capability_inspect/,/docs/,/npx -y docs-mcp/,/easyeda/,/ignored/,/freerouting/,/manual/])assert.match(await body(),text);
  assert.doesNotMatch(await body(),/No MCP servers configured|never-shown|hidden-token/);
  // Servers from other tools carry their source; a repository file of another tool is listed but unused.
  for(const text of [/ngspice/,/ngspice-mcp --stdio/,/octopart/,/Sync from Other Tools/,/repository file, not used/])assert.match(await body(),text);
  assert.match(await page.locator('.cursor-settings-cell',{hasText:'ngspice-mcp'}).innerText(),/Codex/);
  assert.match(await page.locator('.cursor-settings-cell',{hasText:'repo_script'}).innerText(),/ignored/);
  const codex=page.locator('.cursor-settings-cell',{hasText:/^Codex/}).filter({hasText:'config.toml'});
  await codex.locator('.cursor-switch,[role="switch"],button').first().click();
  await page.waitForFunction(()=>window.previewMessages.some(m=>m.request?.type==='kicad_set_sync'));
  assert.deepEqual((await requests('kicad_set_sync')).at(-1),{type:'kicad_set_sync',source:'codex',enabled:false});
  await page.locator('.cursor-settings-cell',{hasText:'ngspice-mcp'}).getByText(/^off$/).waitFor();
  await shot('mcp-servers');
  // Permissions: outdated rules listed and removed through the host; settings are read again.
  await tab('Permissions');await page.getByText('Rule Cleanup',{exact:true}).waitFor();
  const before=(await requests('get_settings')).length;
  for(const text of [/Bash\(\.\/build\/bin\/kicad-agent:\*\)/,/mcp__kicad__kicad_board/,/one-off/])assert.match(await body(),text);
  await shot('permissions-before');
  await page.getByRole('button',{name:'Remove 2 outdated'}).click();
  await page.waitForFunction(()=>window.previewMessages.some(m=>m.request?.type==='kicad_clean_permissions'));
  assert.deepEqual((await requests('kicad_clean_permissions'))[0].rules.map(r=>r.rule),['Bash(./build/bin/kicad-agent:*)','mcp__kicad__kicad_board']);
  await page.getByRole('button',{name:/Remove \d+ outdated/}).waitFor({state:'detached'});
  await page.waitForFunction(n=>window.previewMessages.filter(m=>m.request?.type==='get_settings').length>n,before);
  assert.match(await body(),/one-off/,'one-off rules stay until removed separately');
  assert.deepEqual(await page.evaluate(()=>window.localRules.allow),['mcp__kicad__capability_search','Bash(git status:*)',local.allow[4]].map(r=>r),'current and plain rules are kept');
  await shot('permissions-after');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({ok:true,version,provenance:'production webview bundle; fixture inventory from composer/inventory.ts; simulated host responses; no model calls',checks:['skills grouped by source with duplicate/overridden/outdated/manual flags','skill toggle sends kicad_set_enabled; manual skills have no toggle','Open sends open_file with the SKILL.md path','slash commands namespaced with override and outdated flags','built-in and configured hooks, missing program flagged','plugin search; install command copied, not executed','MCP configured servers from files incl. built-in tools; no secrets; old empty text replaced','servers synced from Codex/Cursor with source badges; repository file of another tool unused','per-tool sync switch sends kicad_set_sync and marks its servers off','permission cleanup removes exactly the outdated rules through the host and re-reads settings','no page errors'],requests:{setEnabled:await requests('kicad_set_enabled'),clean:await requests('kicad_clean_permissions')},pageErrors:errors},null,2)+'\n');
  console.log('Settings pages passed: skills, slash commands, hooks, plugins, configured MCP servers and permission cleanup.');
 }catch(error){await page.screenshot({path:path.join(output,'ui-failure.png'),fullPage:true});console.error((await page.locator('body').innerText()).slice(-3000));throw error;}
 finally{await browser.close();server.closeAllConnections();server.close();fs.rmSync(base,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1)});

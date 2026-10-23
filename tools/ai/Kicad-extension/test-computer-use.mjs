// Real host adapter with deterministic MCP and service doubles. No OS permissions or UI actions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as core from '../composer/computer-use.ts';
import {mcpResult,codexToolResult,chatToolContent} from '../composer/tool-result.ts';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
let cfg={enabled:false,driverPath:'',anyApp:false,allowedApps:[...core.KICAD_APPS]},started=0,stopped=0,closed=0,sequence=0,trusted=true;
const calls=[],updates=[],apps=[{bundle_id:'org.kicad.pcbnew',pid:1,running:true,name:'PCB Editor'},{bundle_id:'com.google.Chrome',pid:2,running:true,name:'Chrome'}];
const reply=data=>({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data});
class Client{
 async connect(){}async close(){closed++;}
 async listTools(){return {tools:[...core.COMPUTER_READ,...core.COMPUTER_ACTION,'run_script','exec'].map(name=>({name,description:name,inputSchema:{type:'object'}}))};}
 async callTool({name,arguments:args}){calls.push({name,args});if(name==='list_apps')return reply({apps});if(name==='list_windows')return reply({windows:apps.map(a=>({pid:a.pid,window_id:a.pid*10}))});if(name==='get_window_state')return {...reply({snapshot_id:'s'+(++sequence),capture_id:'c'+sequence}),content:[{type:'image',data:'fixture',mimeType:'image/png'}]};if(name==='check_permissions')return reply({accessibility:true,screen_recording:true});return reply({ok:true});}
}
class Service{socket='/private/test.sock';log='/private/test.log';async start(){started++;}async stop(){stopped++;}async binary(){return '/test/cua-driver';}async running(){return started>stopped;}}
const vscode={ConfigurationTarget:{Global:1},workspace:{get isTrusted(){return trusted;},getConfiguration:()=>({get:(k,d)=>cfg[k.replace('computer.','')]??d,update:async(k,value,target)=>{updates.push({k,value,target});cfg[k.replace('computer.','')]=value;}})}};
const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/kicadComputerUse.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports,process,console,setTimeout,clearTimeout,require:name=>name==='vscode'?vscode:name==='@modelcontextprotocol/sdk/client/index.js'?{Client}:name==='@modelcontextprotocol/sdk/client/stdio.js'?{StdioClientTransport:class{}}:name==='./shared/kicadComputerUse'?{...core,CuaService:Service}:require(name)});
const host=module.exports,session=host.computerCapabilities(),cap=name=>session.capabilities.find(c=>c.name===name),call=(name,args,sessionOverride=session)=>sessionOverride.capabilities.find(c=>c.name===name).execute(args,{});
assert.equal(started,0,'catalog construction is lazy');
await assert.rejects(()=>call('computer_tools',{}),/off/);assert.equal(started,0);
cfg.enabled=true;
assert.equal((await call('computer_tools',{})).tools.length,core.COMPUTER_READ.length+core.COMPUTER_ACTION.length);assert.equal(calls.length,0,'schema discovery never reads screens');
assert.equal(cap('computer_read').annotations.readOnlyHint,true);assert.equal(cap('computer_action').annotations.readOnlyHint,false);
assert.equal((await call('computer_read',{name:'list_apps',arguments:{}})).structuredContent.apps.length,1);
assert.equal((await call('computer_read',{name:'list_windows',arguments:{}})).structuredContent.windows.length,1);
for(const name of ['run_script','click','launch_app'])await assert.rejects(()=>call('computer_read',{name,arguments:{}}),/not available/);
await assert.rejects(()=>call('computer_action',{name:'run_script',arguments:{}}),/not available/);
await assert.rejects(()=>call('computer_read',{name:'get_window_state',arguments:{pid:2,window_id:20}}),/allowed app pid/);
await assert.rejects(()=>call('computer_read',{name:'get_window_state',arguments:{pid:1,window_id:10,screenshot_out_file:'/tmp/x'}}),/Unsupported/);
await assert.rejects(()=>call('computer_action',{name:'press_key',arguments:{pid:1,window_id:10,key:'Escape'}}),/Read this exact window/);
const pixels=await call('computer_read',{name:'get_window_state',arguments:{pid:1,window_id:10}});assert.equal(pixels.content[0].type,'image');
await call('computer_action',{name:'click',arguments:{pid:1,element_token:'s1:3'}});assert.equal(calls.at(-1).args.window_id,10);
await assert.rejects(()=>call('computer_action',{name:'click',arguments:{pid:1,window_id:11,element_token:'s1:3'}}),/not owned/);
await assert.rejects(()=>call('computer_action',{name:'click',arguments:{pid:1,window_id:11,capture_id:'c1',x:5,y:5}}),/not owned/);
const other=host.computerCapabilities();await assert.rejects(()=>call('computer_action',{name:'click',arguments:{pid:1,window_id:10,element_token:'s1:3'}},other),/not owned/);await other.close();
await call('computer_read',{name:'get_window_state',arguments:{pid:1,window_id:10}});
await assert.rejects(()=>call('computer_action',{name:'click',arguments:{pid:1,window_id:10,element_token:'s1:3'}}),/not owned/);
await assert.rejects(()=>call('computer_action',{name:'click',arguments:{pid:1,window_id:10,capture_id:'c1'}}),/not owned/);
cfg.allowedApps=[];await assert.rejects(()=>call('computer_action',{name:'press_key',arguments:{pid:1,window_id:10,key:'Escape'}}),/allowed app pid/);
cfg.anyApp=true;assert.equal((await call('computer_read',{name:'list_apps',arguments:{}})).structuredContent.apps.length,2);
await assert.rejects(()=>call('computer_read',{name:'get_window_state',arguments:{scope:'desktop'}}),/exact app/);
cfg.enabled=false;await assert.rejects(()=>call('computer_read',{name:'check_permissions',arguments:{}}),/off/);
await host.computerSetting('enabled',false);assert.equal(stopped,1);assert.ok(closed>0);assert.equal(updates.at(-1).target,1);
cfg.enabled=true;assert.equal((await call('computer_read',{name:'check_permissions',arguments:{}})).structuredContent.accessibility,true,'existing conversation reconnects after re-enabling');await session.close();
trusted=false;const untrusted=host.computerCapabilities();await assert.rejects(()=>call('computer_read',{name:'check_permissions',arguments:{}},untrusted),/Trust/);await untrusted.close();
await assert.rejects(()=>host.computerSetting('allowedApps',['../x']),/bundle IDs/);
assert.equal(mcpResult(pixels).content[0].type,'image');assert.equal(codexToolResult(pixels).contentItems[0].imageUrl,'data:image/png;base64,fixture');assert.equal(chatToolContent(pixels)[0].source.data,'fixture');assert.match(codexToolResult(pixels).contentItems.at(-1).text,/snapshot_id/,'Codex receives structured element handles as text');assert.equal(codexToolResult({ok:false}).success,false);
const plist=core.launchAgentPlist('/Apps/CuaDriver.app','/private/a&b.sock','/private/pid','/private/log');
for(const value of ['<key>KeepAlive</key><true/>','<key>RunAtLoad</key><true/>','--no-overlay','--no-permissions-gate','/private/a&amp;b.sock','DO_NOT_TRACK'])assert.ok(plist.includes(value));
assert.ok(!plist.includes('unrestricted')&&!plist.includes('--enable-experimental-pip'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json')));for(const [key,property] of Object.entries(manifest.contributes.configuration.properties).filter(([k])=>k.startsWith('kicadAgent.computer.')))assert.equal(property.scope,'application',key);
assert.ok(manifest.activationEvents.includes('onStartupFinished'));
console.log('Computer control passed: lazy discovery, independent toggle, app/window/token scope, revocation, trust, image transport, launchd and settings manifest.');

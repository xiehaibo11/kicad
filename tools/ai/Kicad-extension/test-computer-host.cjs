// Isolated real VS Code host: production settings router and signed Cua service.
// Explicit live test, never invoked by the build. Does not capture user screens.
const assert=require('node:assert/strict'),fs=require('node:fs'),vscode=require('vscode');
exports.run=async()=>{
const extension=vscode.extensions.getExtension('kicad-agent.kicad');assert.ok(extension);const api=await extension.activate();
const container=api.getInstantiationService(),key=Array.from(container._services._entries.keys()).find(id=>String(id)==='claudeAgentService'),service=container.invokeFunction(a=>a.get(key));
const cfg=vscode.workspace.getConfiguration('kicadAgent');await cfg.update('computer.driverPath','/Applications/CuaDriver.app/Contents/MacOS/cua-driver',vscode.ConfigurationTarget.Global);
const request=(type,action,value)=>service.processRequest({type:'request',requestId:'computer-host',request:{type,action,value}},new AbortController().signal);
const initial=await request('kicad_computer_status');assert.equal(initial.status.enabled,false);
assert.equal(initial.status.reloadRequired,false);assert.deepEqual(initial.status.missingSettings,[]);
for(const key of ['enabled','driverPath','anyApp','allowedApps'])assert.notEqual(vscode.workspace.getConfiguration('kicadAgent').inspect('computer.'+key)?.defaultValue,undefined,'registered setting '+key);
const enabled=await request('kicad_computer_setting','enabled',true);assert.equal(enabled.status.running,true);assert.equal(enabled.status.permissions.accessibility,true);assert.equal(enabled.status.permissions.screen_recording,true);
const current=()=>vscode.workspace.getConfiguration('kicadAgent');
assert.equal(current().inspect('computer.enabled').globalValue,true);assert.equal(current().inspect('computer.enabled').workspaceValue,undefined);
await request('kicad_computer_setting','anyApp',true);assert.equal(current().get('computer.anyApp'),true);await request('kicad_computer_setting','anyApp',false);
for(const allowed of [['org.kicad.pcbnew','com.google.Chrome'],['org.kicad.pcbnew','com.microsoft.Excel'],['org.kicad.pcbnew']]){await request('kicad_computer_setting','allowedApps',allowed);assert.deepEqual(current().get('computer.allowedApps'),allowed);assert.deepEqual(current().inspect('computer.allowedApps').globalValue,allowed);}
const off=await request('kicad_computer_setting','enabled',false);assert.equal(off.status.running,false);assert.equal(off.status.enabled,false);
const restarted=await request('kicad_computer_setting','enabled',true);assert.equal(restarted.status.running,true);
fs.writeFileSync(process.env.KICAD_COMPUTER_HOST_RESULT,JSON.stringify({ok:true,provenance:'real VS Code Extension Test Host; activated final VSIX router; actual signed Cua Driver; no model requests or screenshots',version:extension.packageJSON.version,enabled:enabled.status,off:off.status,exitStatus:restarted.status},null,2)+'\n');
};

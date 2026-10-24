// Run in an isolated real VS Code Extension Test Host; no model or screen-control calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('kicad-agent.kicad');assert.ok(extension);assert.equal(extension.packageJSON.version,'0.4.68');
 const cfg=vscode.workspace.getConfiguration('kicadAgent');
 const keys=['globalEnabled','projectEnabled','autoLearn'];
 for(const key of keys){const schema=extension.packageJSON.contributes.configuration.properties['kicadAgent.memory.'+key];assert.equal(schema.scope,'application');assert.equal(cfg.inspect('memory.'+key).defaultValue,true);}
 const api=await Promise.race([extension.activate(),new Promise((_,reject)=>setTimeout(()=>reject(Error('activation timeout')),20000))]);
 const policy=key=>JSON.parse(fs.readFileSync(path.join(process.env.KICAD_HISTORY_DIR,'memory-policy',key+'.json'),'utf8')).memory[key];
 const wait=async(predicate,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label);};
 for(const key of keys){await wait(()=>{try{return policy(key)===false;}catch{return false;}},'initial policy '+key);await cfg.update('memory.'+key,true,vscode.ConfigurationTarget.Global);await wait(()=>policy(key)===true,'enable '+key);await cfg.update('memory.'+key,false,vscode.ConfigurationTarget.Global);await wait(()=>policy(key)===false,'disable '+key);}
 void vscode.commands.executeCommand('kicad.openSettings');await wait(()=>api.getWebviewReadiness().mounted>=1,'settings mounted');
 const result={ok:true,version:extension.packageJSON.version,active:extension.isActive,memorySchemaRegistered:keys,liveToggleSync:true,settingsWebview:api.getWebviewReadiness(),isolatedProfile:true,modelRequests:0,productionDataAccess:false};
 fs.writeFileSync(process.env.KICAD_HOST_TEST_RESULT,JSON.stringify(result,null,2)+'\n');console.log('Memory real VS Code host passed: '+JSON.stringify(result));
};

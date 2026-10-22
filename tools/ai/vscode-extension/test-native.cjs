// Check the compiled legacy frontend's real imports without a VS Code process.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const os=require('node:os');
(async()=>{
 const filename=path.resolve(__dirname,'out/extension.js'),instance=new Module(filename,module);
 instance.filename=filename;instance.paths=Module._nodeModulePaths(path.dirname(filename));
 const mock={workspace:{getConfiguration:()=>({get:()=>undefined}),workspaceFolders:[{uri:{fsPath:__dirname}}]},window:{}};
 const originalRequire=instance.require.bind(instance);instance.require=id=>id==='vscode'?mock:originalRequire(id);
 instance._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.nativeTest={runAction,actionCatalog,nativeRuntimes,setOutput:v=>output=v};',filename);
 const api=instance.exports.nativeTest;api.setOutput({appendLine(){}});
 const result=await api.runAction('reference.plan',{query:'PCB'});
 assert.equal(result.ok,true);assert.ok(result.data);
 const actions=await api.actionCatalog();assert.equal(actions.data.actions.length,333);
 const controller=new AbortController();controller.abort();
 const cancel=await api.runAction('board.items.delete',{},__dirname,{signal:controller.signal});assert.equal(cancel.error.code,'CANCELLED');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-legacy-test-'));
 try {
  fs.writeFileSync(path.join(directory,'fixture.kicad_pro'),'{}');
  const project=await api.runAction('project.resolve',{project:'fixture.kicad_pro'},directory);
  assert.equal(project.ok,true);assert.equal(project.data.path,path.join(directory,'fixture.kicad_pro'));
 }finally{fs.rmSync(directory,{recursive:true,force:true});for(const runtime of api.nativeRuntimes.values())runtime.close();}
 console.log('Legacy extension native tools: compiled host imports shared ESM, 333 actions, real reference call, relative paths and cancellation passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});

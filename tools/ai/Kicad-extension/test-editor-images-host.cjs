// Run in an isolated VS Code Extension Test Host. Uses the assembled production open_file handler.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vscode=require('vscode');
const {loadHandler}=require('./test-editor-images-loader.cjs');
exports.run=async()=>{
 const root=process.env.KICAD_IMAGE_TEST_SOURCE,destination=process.env.KICAD_IMAGE_TEST_RESULT;
 assert.ok(root&&destination,'explicit assembled source and result paths are required');
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad image 编辑器-'));fs.mkdirSync(path.join(out,'原理图 exports'));
 const imagePath=path.join(out,'原理图 exports','cleared PCB.png');fs.copyFileSync(process.env.KICAD_IMAGE_TEST_PNG,imagePath);
 const logs=[],context={logService:{error:message=>logs.push(message)},workspaceService:{getDefaultWorkspaceFolder:()=>({uri:vscode.Uri.file(out)})},fileSystemService:{findFiles:async()=>[],resolveExistingPath:async(file,cwd)=>path.resolve(cwd,file)}};
 const open=loadHandler(root,vscode);
 const sentinel=path.join(out,'image-test.txt');fs.writeFileSync(sentinel,'TEST FIXTURE · no model calls');
 await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(sentinel)),{viewColumn:vscode.ViewColumn.One});
 const panel=vscode.window.createWebviewPanel('kicad.imageAcceptance','Kicad image test · no model',vscode.ViewColumn.Two,{});
 panel.webview.html='<html><body style="background:#181818;color:#ddd;font:15px system-ui;padding:24px"><h2>Native editor image acceptance</h2><p>TEST FIXTURE · no model calls</p><p>The image at left is VS Code’s built-in previewEditor, opened by the production open_file handler.</p></body></html>';
 await open({type:'open_file',filePath:imagePath},context);
 const tabs=()=>vscode.window.tabGroups.all.flatMap(g=>g.tabs.map(t=>({group:g.viewColumn,label:t.label,viewType:t.input?.viewType,uri:t.input?.uri?.fsPath,active:t.isActive})));
 const imageTab=tabs().find(t=>t.uri===imagePath);
 assert.ok(imageTab,'image is open as an editor tab');assert.equal(imageTab.viewType,'imagePreview.previewEditor');assert.equal(imageTab.group,1);
 assert.ok(tabs().some(t=>t.label==='Kicad image test · no model'&&t.group===2&&t.active),'chat-side editor remains open and visible');
 await assert.rejects(open({type:'open_file',filePath:path.join(out,'missing.png')},context),/ENOENT/);
 const result={ok:true,provenance:'real VS Code Extension Test Host; assembled production handler; fixture PNG, no model calls',vscodeVersion:vscode.version,extensionVersion:vscode.extensions.getExtension('kicad-agent.kicad')?.packageJSON.version,imagePath,tabs:tabs(),logs};
 fs.writeFileSync(destination,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 if(process.env.KICAD_IMAGE_TEST_HOLD)await new Promise(r=>setTimeout(r,Math.min(60000,Number(process.env.KICAD_IMAGE_TEST_HOLD))));
 panel.dispose();await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(g=>g.tabs).filter(t=>[imagePath,sentinel].includes(t.input?.uri?.fsPath)));
 fs.rmSync(out,{recursive:true,force:true});
};

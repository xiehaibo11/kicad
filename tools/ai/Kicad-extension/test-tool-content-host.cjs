// Real isolated VS Code host; packaged request router and provider, no model calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vscode=require('vscode');
exports.run=async()=>{
 const destination=process.env.KICAD_CONTENT_TEST_RESULT;assert.ok(destination);
 const extension=vscode.extensions.getExtension('kicad-agent.kicad');assert.ok(extension);const api=await extension.activate();
 const container=api.getInstantiationService(),key=Array.from(container._services._entries.keys()).find(id=>String(id)==='claudeAgentService');assert.ok(key);
 const service=container.invokeFunction(accessor=>accessor.get(key));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-content-')),sentinel=path.join(directory,'must-not-exist');
 const command='touch "'+sentinel+'"\n# TEST FIXTURE · viewing must not execute\nprintf "命令\\n"';
 const output=Array.from({length:3000},(_,i)=>'line '+(i+1)+' 原始输出').join('\n');
 await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({content:'TEST FIXTURE · no model calls',language:'plaintext'}),{viewColumn:vscode.ViewColumn.One});
 const panel=vscode.window.createWebviewPanel('kicad.contentAcceptance','Kicad content test · no model',vscode.ViewColumn.Two,{});
 panel.webview.html='<html><body style="background:#181818;color:#ddd;font:15px system-ui;padding:24px"><h2>Tool IN / OUT editor acceptance</h2><p>TEST FIXTURE · no model calls</p><p>The left editor is a named, read-only virtual document opened by the production handler.</p></body></html>';
 const open=(content,fileName)=>service.processRequest({type:'request',requestId:'content-test',request:{type:'open_content',content,fileName,editable:false}},new AbortController().signal);
 const snapshots=[];
 for(const [fileName,content] of [['command (native-test)',command],['Bash tool output (native-test)',output],['Bash tool error (native-test)','Exit code 2\n错误：输出目录不存在']]){
  await open(content,fileName);
  const editor=vscode.window.visibleTextEditors.find(e=>e.document.uri.path==='/'+fileName);assert.ok(editor,'content is visible in editor group 1');assert.equal(editor.viewColumn,1);assert.equal(editor.document.getText(),content);assert.equal(editor.document.isUntitled,false);
  await vscode.window.showTextDocument(editor.document,{viewColumn:vscode.ViewColumn.One,preserveFocus:false});
  await vscode.commands.executeCommand('type',{text:'MUST NOT INSERT'});
  assert.equal(editor.document.getText(),content,'normal typing is rejected by the read-only editor');assert.equal(editor.document.isDirty,false);
  panel.reveal(vscode.ViewColumn.Two,false);
  const tab=vscode.window.tabGroups.all.flatMap(g=>g.tabs).find(t=>t.input?.uri?.toString()===editor.document.uri.toString());assert.equal(tab?.label,fileName);
  snapshots.push({label:tab.label,uri:editor.document.uri.toString(),characters:content.length,lines:editor.document.lineCount,typingRejected:true});
 }
 await open(output,'Bash tool output (native-test)');const before=vscode.window.tabGroups.all.flatMap(g=>g.tabs).length;await open(output,'Bash tool output (native-test)');assert.equal(vscode.window.tabGroups.all.flatMap(g=>g.tabs).length,before,'repeat click reuses the snapshot');
 const tabs=vscode.window.tabGroups.all.flatMap(g=>g.tabs.map(t=>({group:g.viewColumn,label:t.label,scheme:t.input?.uri?.scheme,active:t.isActive})));
 assert.ok(tabs.some(t=>t.label==='Kicad content test · no model'&&t.group===2&&t.active),'adjacent chat stays visible');assert.equal(fs.existsSync(sentinel),false,'viewing did not execute the command');
 fs.writeFileSync(destination,JSON.stringify({ok:true,provenance:'real VS Code Extension Test Host; activated VSIX request router and provider; no model calls',vscodeVersion:vscode.version,extensionVersion:extension.packageJSON.version,snapshots,tabs,commandExecuted:false},null,2)+'\n');
 panel.dispose();await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(g=>g.tabs).filter(t=>t.input?.uri?.scheme==='kicad-tool-content'));fs.rmSync(directory,{recursive:true,force:true});
};

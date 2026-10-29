// Passive instrumentation in an isolated Extension Test Host. Pointer drag is
// performed through the real window, not synthesized webview/DOM events.
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),vscode=require('vscode');
exports.run=async()=>{
  const destination=process.env.KICAD_DROP_UI_RESULT;
  assert.ok(destination,'KICAD_DROP_UI_RESULT must identify an isolated test result');
  const extension=vscode.extensions.getExtension('kicad-agent.kicad'),api=await extension.activate();
  const instantiation=api.getInstantiationService();
  const service=name=>instantiation.invokeFunction(accessor=>accessor.get([...instantiation._services._entries.keys()].find(id=>String(id)===name)));
  const webviews=service('webViewService'),agent=service('claudeAgentService');
  const result={version:extension.packageJSON.version,vscodeVersion:vscode.version,fixture:'Local generated images; no chat message sent',events:[]};
  const save=()=>fs.writeFileSync(destination,JSON.stringify({...result,readiness:api.getWebviewReadiness()},null,2)+'\n');
  const enqueue=webviews.enqueueComposerFiles.bind(webviews);
  webviews.enqueueComposerFiles=paths=>{result.events.push({type:'native-drop',paths});enqueue(paths);save();};
  const request=agent.processRequest.bind(agent);
  agent.processRequest=async(...args)=>{
    const input=args[0]?.request;
    const response=await request(...args);
    if(input?.type==='kicad_drop_files') {
      result.events.push({type:'attachment-read',paths:input.paths,attachments:response.attachments.map(item=>({fileName:item.fileName,bytes:item.fileSize,sha256:crypto.createHash('sha256').update(Buffer.from(item.data,'base64')).digest('hex')})),references:response.references,errors:response.errors});save();
    }
    return response;
  };
  await vscode.commands.executeCommand('kicad.showChat');
  const until=Date.now()+20000;
  while(api.getWebviewReadiness().mounted<1&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(api.getWebviewReadiness().mounted,'production webview must mount');
  result.ready=true;save();
  const deadline=Date.now()+15*60*1000;
  while(!fs.existsSync(destination+'.stop')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,500));
  result.finished=true;save();
};

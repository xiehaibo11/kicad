// Isolated real VS Code host, production request router; no model inference.
const assert=require('node:assert/strict'),fs=require('node:fs'),vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('kicad-agent.kicad'),api=await extension.activate();
 const container=api.getInstantiationService(),key=Array.from(container._services._entries.keys()).find(id=>String(id)==='claudeAgentService');assert.ok(key);
 const service=container.invokeFunction(a=>a.get(key)),signal=new AbortController().signal;
 const request=body=>service.processRequest({type:'request',requestId:'slash-host',request:body},signal);
 const first=await request({type:'slash_catalog',kind:'tool',query:'',offset:0});
 assert.equal(first.type,'slash_catalog_response');assert.ok(first.results.length>0&&first.results.length<=10);assert.ok(first.results.every(r=>r.id.startsWith('tool:')));
 const skills=await request({type:'slash_catalog',kind:'skill',query:'',offset:0});assert.ok(skills.results.length<=10);
 await request({type:'local_slash',action:'mcp'});
 const mcp=vscode.workspace.textDocuments.find(d=>d.languageId==='json'&&d.getText().includes('No server was started'));assert.ok(mcp);
 await request({type:'local_slash',action:'doctor'});
 const audit=vscode.workspace.textDocuments.find(d=>d.languageId==='json'&&d.getText().includes('"readOnly": true')&&d.getText().includes('"sources"'));assert.ok(audit);
 assert.equal(vscode.window.terminals.length,0,'local browsing and auditing do not launch terminals');
 fs.writeFileSync(process.env.KICAD_SLASH_HOST_RESULT,JSON.stringify({ok:true,provenance:'real VS Code extension host + activated production router',version:extension.packageJSON.version,toolResults:first.results.length,skillResults:skills.results.length,doctorReport:true,mcpReport:true,terminals:0},null,2)+'\n');
};

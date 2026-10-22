// Read-only packaged extension host, native terminal and shared native catalog checks.
const assert=require('node:assert/strict'),fs=require('node:fs'),vscode=require('vscode');
exports.run=async()=>{
 await require('./test-vscode-host.cjs').run();
 const api=await vscode.extensions.getExtension('kicad-agent.kicad').activate();
 const instantiation=api.getInstantiationService(),id=[...instantiation._services._entries.keys()].find(id=>String(id)==='claudeAgentService');
 const agent=instantiation.invokeFunction(accessor=>accessor.get(id));
 const result=await agent.processRequest({type:'request',requestId:'installed-backend-catalog',request:{type:'tool_references'}},new AbortController().signal);
 assert.equal(result.type,'tool_references_response');assert.equal(result.tools.length,20);
 for(const name of ['kicad_health','kicad_audit','kicad_web','kicad_native_tools','kicad_editor','kicad_gerber','kicad_project'])assert.ok(result.tools.some(tool=>tool.name==='mcp__kicad__'+name),name);
 const commands=await vscode.commands.getCommands(true);assert.ok(commands.includes('kicadAgent.health'));
 fs.writeFileSync('/tmp/Kicad-fix-backend-host.json',JSON.stringify({ok:true,fixture:'installed production extension in real VS Code host; in-process native tools, no model calls',toolCount:result.tools.length,toolNames:result.tools.map(tool=>tool.name),healthCommandRegistered:true},null,2));
};

// Real stdio MCP transport and shared production catalog; disposable local plugin.
// No model requests, user browser, authentication store or desktop actions.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {readMcpSources,syncedMcpServers,DEFAULT_MCP_SYNC,pluginServerName} from '../composer/mcp-sync.ts';
import {DemandCatalog,mcpConnector} from '../composer/demand.ts';
const root=process.argv[2],require=createRequire(path.join(root,'package.json'));
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js'),{ToolListChangedNotificationSchema}=require('@modelcontextprotocol/sdk/types.js');
const base=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-shared-mcp-')),home=path.join(base,'home'),cwd=path.join(base,'workspace'),plugin=path.join(home,'.codex/plugins/cache/local/fixture/1.0.0'),trace=path.join(base,'trace.jsonl');
const write=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value));};
let catalog;
try{
  await fs.mkdir(cwd,{recursive:true});
  await write(path.join(home,'.codex/config.toml'),'[plugins."fixture@local"]\nenabled=true\n');
  await write(path.join(plugin,'plugin.json'),{name:'fixture',version:'1.0.0'});
  await write(path.join(plugin,'mcp.json'),{mcpServers:{echo:{type:'stdio',command:process.execPath,args:['${PLUGIN_ROOT}/server.mjs',trace]}}});
  await write(path.join(plugin,'server.mjs'),`import readline from 'node:readline';import fs from 'node:fs';
const trace=process.argv[2];fs.appendFileSync(trace,JSON.stringify({stage:'started',root:process.env.PLUGIN_ROOT})+'\\n');
for await(const line of readline.createInterface({input:process.stdin})){
 const r=JSON.parse(line);if(r.id===undefined)continue;
 fs.appendFileSync(trace,JSON.stringify({stage:r.method})+'\\n');let result;
 if(r.method==='initialize')result={protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'local-plugin-fixture',version:'1.0.0'}};
 else if(r.method==='tools/list')result={tools:[{name:'echo',description:'Read-only local plugin echo',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']},annotations:{readOnlyHint:true}}]};
 else if(r.method==='tools/call')result={content:[{type:'text',text:'shared:'+r.params.arguments.text}]};
 else result={};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');
}
`);
  const reports=await readMcpSources({home,cwd,env:{}}),server=pluginServerName('fixture@local','echo');
  assert.deepEqual(syncedMcpServers(reports,DEFAULT_MCP_SYNC).servers,{});
  await assert.rejects(()=>fs.access(trace),'reading plugin definitions never launches a process');
  const {servers}=syncedMcpServers(reports,['codex-plugins']);
  catalog=new DemandCatalog({cwd,servers,skills:false,builtins:async()=>[],connect:mcpConnector({Client,StdioClientTransport,ToolListChangedNotificationSchema},cwd)});
  assert.equal((await catalog.search({kind:'server',query:'fixture'})).results[0].name,server);
  await assert.rejects(()=>fs.access(trace),'listing a shared server does not connect it');
  const discovered=await catalog.search({kind:'tool',server,query:'echo'}),tool=discovered.results.find(item=>item.name==='echo');
  assert.ok(tool,'the original plugin schema is discoverable');
  const result=await catalog.call(tool.id,{text:'across-providers'});
  assert.equal(result.content[0].text,'shared:across-providers');
  const stages=(await fs.readFile(trace,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(stages.filter(row=>row.stage==='started').length,1,'one persistent MCP connection is reused');
  assert.equal(stages.filter(row=>row.stage==='tools/call').length,1,'only the requested tool executes');
  catalog.setServers({});
  await assert.rejects(()=>catalog.call(tool.id,{text:'revoked'}),/disabled|search|not found|Unknown/i);
  console.log('Shared integrations passed: real local plugin, real stdio MCP, lazy discovery, original schema/result, one process, revocation; no models or user apps.');
}finally{await catalog?.close();await fs.rm(base,{recursive:true,force:true});}

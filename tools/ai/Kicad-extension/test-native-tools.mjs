// Verify the actual pinned SDK registration, without credentials or a model call.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=path.resolve(process.argv[2]), require=createRequire(path.join(root,'package.json'));
const {createSdkMcpServer,tool}=require('@anthropic-ai/claude-agent-sdk'),{z}=require('zod');
const direct=await import(pathToFileURL(path.join(root,'resources/kicad/kicad-direct.mjs')).href);
const runtime=new direct.Runtime();
try{
 const definitions=direct.bindTools(runtime,z);
 const tools=definitions.map(b=>tool(b.name,b.description,b.args,async(args,extra)=>{
   const result=await b.execute(args,{signal:extra?.signal});return {content:[{type:'text',text:JSON.stringify(result)}],isError:!result.ok};
 }));
 const server=createSdkMcpServer({name:'kicad',version:'0.1.0',tools});
 assert.equal(server.type,'sdk');assert.ok(server.instance);assert.equal(server.command,undefined);
 const registered=server.instance._registeredTools;
 assert.equal(Object.keys(registered).length,20);
 const manifest=await runtime.dispatch('system.manifest',{});assert.equal(manifest.data.actionCount,333);
 assert.equal(direct.listActions().filter(a=>a.nativeWorkflow).length,79);
 const result=await registered.kicad_reference.handler({action:'reference.plan',payload:{query:'原理图电源'}},{signal:new AbortController().signal});
 assert.equal(result.isError,false);assert.equal(JSON.parse(result.content[0].text).ok,true);
 const wrong=await registered.kicad_library.handler({action:'board.items.delete'},{});assert.equal(wrong.isError,true);
 console.log('Native tools passed: actual SDK in-process registration, shared bundle, 20 handlers, real reference call and domain rejection; zero daemon commands.');
}finally{runtime.close();}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {executeLocalTool,localToolBindings} from '../local-tools.ts';
import {saveExtensionEvent} from '../history.ts';
test('local memory survives reload, isolates workspaces, and excludes secrets; history is available to both clients',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-memory-')),old=process.env.KICAD_HISTORY_DIR;process.env.KICAD_HISTORY_DIR=path.join(tmp,'history');
 try{
 const result=await executeLocalTool('local_memory',{operation:'append',text:'Verified R1 = 10k; ctx7sk-fixture-secret'},tmp);
 assert.equal((await fs.stat(result.path)).mode&0o777,0o600);
 const read=await executeLocalTool('local_memory',{operation:'read',query:'R1'},tmp);assert.equal(read.total,1);assert.doesNotMatch(JSON.stringify(read),/fixture-secret/);
 assert.equal((await executeLocalTool('local_memory',{operation:'read'},path.join(tmp,'other'))).total,0);
 const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';await saveExtensionEvent(id,tmp,{type:'user',message:{content:'original task'}});
 const records=await executeLocalTool('session_history',{operation:'read',id:'extension:'+id},tmp);assert.equal(records.total,1);
 assert.equal((await executeLocalTool('session_history',{operation:'read',id:'extension:'+id},path.join(tmp,'other'))).total,0);
 }finally{old===undefined?delete process.env.KICAD_HISTORY_DIR:process.env.KICAD_HISTORY_DIR=old;await fs.rm(tmp,{recursive:true,force:true});}
});
test('memory supports list/search/replace/delete, preserves ids, and rejects a full store',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-memory-ops-')),old=process.env.KICAD_HISTORY_DIR;process.env.KICAD_HISTORY_DIR=path.join(tmp,'history');
 try{
 const first=await executeLocalTool('local_memory',{operation:'append',text:'R1 = 10k verified'},tmp);
 const second=await executeLocalTool('local_memory',{operation:'append',text:'C2 = 100nF verified'},tmp);
 const list=await executeLocalTool('local_memory',{operation:'list'},tmp);assert.equal(list.total,2);assert.ok(list.memories.every(x=>x.id));
 const search=await executeLocalTool('local_memory',{operation:'search',query:'100n'},tmp);assert.equal(search.total,1);assert.equal(search.memories[0].text,'C2 = 100nF verified');
 await assert.rejects(()=>executeLocalTool('local_memory',{operation:'search',query:''},tmp),/requires a query/);
 const replaced=await executeLocalTool('local_memory',{operation:'replace',id:first.id,text:'R1 = 20k verified'},tmp);assert.equal(replaced.id,first.id);
 const after=await executeLocalTool('local_memory',{operation:'read',query:'20k'},tmp);assert.equal(after.total,1);assert.equal(after.memories[0].text,'R1 = 20k verified');
 const deleted=await executeLocalTool('local_memory',{operation:'delete',id:second.id},tmp);assert.equal(deleted.id,second.id);
 assert.equal((await executeLocalTool('local_memory',{operation:'list'},tmp)).total,1);
 await assert.rejects(()=>executeLocalTool('local_memory',{operation:'delete',id:'missing'},tmp),/not found/);
 const huge='x'.repeat(7990);let full=false;for(let i=0;i<40;i++){try{await executeLocalTool('local_memory',{operation:'append',text:i+huge},tmp);}catch(error){full=/full/.test(String(error));break;}}
 assert.equal(full,true,'the memory store has a hard size cap');
 }finally{old===undefined?delete process.env.KICAD_HISTORY_DIR:process.env.KICAD_HISTORY_DIR=old;await fs.rm(tmp,{recursive:true,force:true});}
});
test('Context7 uses fixed official endpoints, protects credentials, reports HTTP failures and bounds context',async()=>{
 const old=globalThis.fetch,key=process.env.CONTEXT7_API_KEY;process.env.CONTEXT7_API_KEY='fixture-credential';let calls=0;
 try{
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(url.origin,'https://context7.com');assert.equal(options.headers.Authorization,'Bearer fixture-credential');assert.equal(options.redirect,'error');assert.equal(url.searchParams.get('query'),'state hooks');return new Response(JSON.stringify({results:[{id:'/facebook/react'}]}));};
 const found=await executeLocalTool('context7',{operation:'search',libraryName:'react',query:'state hooks'},'.');assert.equal(found.data.results[0].id,'/facebook/react');
 await executeLocalTool('context7',{operation:'docs',libraryId:'/facebook/react',query:'state hooks'},'.');assert.equal(calls,2);
 await assert.rejects(executeLocalTool('context7',{operation:'search',libraryName:'react',query:'ctx7sk-fixture-secret'},'.'),/credentials/);assert.equal(calls,2);
 globalThis.fetch=async()=>new Response('private upstream body',{status:401});await assert.rejects(executeLocalTool('context7',{operation:'docs',libraryId:'/facebook/react',query:'state hooks'},'.'),/^Error: Context7 HTTP 401$/);
 globalThis.fetch=async()=>new Response('x'.repeat(512001));await assert.rejects(executeLocalTool('context7',{operation:'docs',libraryId:'/facebook/react',query:'state hooks'},'.'),/too large/);
 }finally{globalThis.fetch=old;key===undefined?delete process.env.CONTEXT7_API_KEY:process.env.CONTEXT7_API_KEY=key;}
});

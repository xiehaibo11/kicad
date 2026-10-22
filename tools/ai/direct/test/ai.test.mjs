// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ai} from '../ai.mjs';

async function fixture(t, replies) {
  let calls=0;
  const server=http.createServer(async(req,res)=>{
    let body=''; for await(const chunk of req) body+=chunk;
    assert.equal(req.url,'/v1/chat/completions');
    assert.equal(JSON.parse(body).model,'fixture');
    const reply=replies[calls++];
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(reply)}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-ai-test-'));
  const settings=path.join(directory,'settings.json');
  fs.writeFileSync(settings,JSON.stringify({default:'fixture',providers:{fixture:{type:'openai',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture'}}}));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
  return {settings,calls:()=>calls};
}
test('provider loop dispatches tools in-process and emits the verified final answer',async t=>{
  const f=await fixture(t,[{action:'reference.plan',payload:{query:'power'}},{final:'Verified response'}]),events=[],calls=[];
  const result=await ai({prompt:'inspect',settings:f.settings},{dispatch:async(action,payload)=>{calls.push({action,payload});return {ok:true,action,data:{source:'local'}};}},{},event=>events.push(event));
  assert.equal(result.ok,true);assert.equal(result.data.final,'Verified response');assert.equal(f.calls(),2);
  assert.deepEqual(calls,[{action:'reference.plan',payload:{query:'power'}}]);
  assert.deepEqual(events.map(event=>event.event),['start','action','step','final']);
});
test('provider loop retains unresolved tool failures even if the model claims completion',async t=>{
  const f=await fixture(t,[{action:'board.items.delete'},{final:'done'}]);
  const result=await ai({prompt:'inspect only',settings:f.settings,readOnly:true},{dispatch(){assert.fail('read-only policy must block the write');}});
  assert.equal(result.ok,false);assert.equal(result.error.code,'UNRESOLVED_TOOL_FAILURES');
});
test('already-cancelled provider loop never dispatches an action',async t=>{
  const f=await fixture(t,[{action:'board.items.delete'}]),controller=new AbortController();controller.abort();
  await assert.rejects(ai({prompt:'inspect',settings:f.settings},{dispatch(){assert.fail('cancelled');}},{signal:controller.signal}),/abort/i);
  assert.equal(f.calls(),0);
});

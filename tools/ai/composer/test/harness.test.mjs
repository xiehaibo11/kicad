import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {HarnessLoop,archiveResult,failedResult,RESULT_LIMIT} from '../harness.ts';

test('retry guard counts identical failures, allows changed requests and resets on a real user turn',()=>{
  const loop=new HarnessLoop(),args={b:2,a:1};
  for(let i=0;i<3;i++){assert.equal(loop.advice('write',args),undefined);loop.after('write',args,true);}
  assert.match(loop.advice('write',{a:1,b:2}),/three times/);
  assert.equal(loop.advice('write',{a:2,b:2}),undefined);
  const restored=new HarnessLoop();restored.restore(loop.snapshot());assert.match(restored.advice('write',args),/three times/);
  loop.newTurn();assert.equal(loop.advice('write',args),undefined);
  loop.after('write',args,true);loop.after('read',{},false);assert.equal(loop.advice('write',args),undefined);
});
test('successful calls never force extra bookkeeping tools; explicit todo updates still persist',()=>{
  const loop=new HarnessLoop();
  for(let i=0;i<5;i++)assert.equal(loop.after('question',{},false),'');
  assert.equal(loop.after('read',{},false),'');assert.equal(loop.after('read',{},false),'');
  for(let i=0;i<20;i++)assert.equal(loop.after('read',{},false),'');
  const todos=[{content:'Verify changed board',status:'in_progress'}];
  loop.after('TodoWrite',{todos},false);assert.deepEqual(loop.snapshot().todos,todos);
  loop.after('TodoWrite',{todos:[]},true);assert.deepEqual(loop.snapshot().todos,todos);
  loop.restore({cycles:-1,failure:{key:'invalid',count:Infinity}});assert.equal(loop.advice('read',{}),undefined);
});
test('large results are archived byte-exact with a bounded preview; archive failures propagate',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-harness-'));
  try{
    assert.equal(await archiveResult(root,'a'.repeat(RESULT_LIMIT)),undefined);
    const raw='测'.repeat(100000),result=await archiveResult(root,raw);
    assert.equal(await fs.readFile(result.archive,'utf8'),raw);
    assert.equal(result.bytes,Buffer.byteLength(raw));assert.equal(result.sha256,createHash('sha256').update(raw).digest('hex'));
    assert.ok(result.preview.length<=4096);assert.equal((await fs.stat(result.archive)).mode&0o777,0o600);
    const blocked=path.join(root,'file');await fs.writeFile(blocked,'not a directory');
    await assert.rejects(archiveResult(blocked,raw));
    assert.equal(failedResult('{"ok":false}'),true);assert.equal(failedResult({isError:true}),true);
    assert.equal(failedResult('text containing error'),false);
    assert.equal(failedResult('Exit code 1\nboom'),true);assert.equal(failedResult('Exit code 0\nok'),false);
    assert.equal(failedResult('Command exited with code 50'),true);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

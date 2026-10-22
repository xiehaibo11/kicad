// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { bindTools, resolvePaths, callAction, callMutates } from '../bindings.mjs';
import { Runtime } from '../runtime.mjs';
import { callTool } from '../tools.mjs';

test('in-process tools call the shared runtime, preserve write permission and validate input before execution', async () => {
  const calls = [], approvals = [];
  const runtime = { async dispatch(name, p) { calls.push([name,p]); return {ok:true,data:p}; } };
  const tools = bindTools(runtime,z,async (name,args) => { approvals.push(args.action); if(args.payload?.deny) throw Error('Permission denied'); });
  assert.equal(tools.length,20);
  const board = tools.find(t=>t.name==='kicad_board');
  const read = await board.execute({action:'board.items.get',payload:{document:'x'}});assert.equal(read.ok,true);assert.equal(approvals.length,0);
  const write = await board.execute({action:'board.items.delete',payload:{document:'x',ids:['one']}});assert.equal(write.ok,true);assert.deepEqual(approvals,['board.items.delete']);
  // A refused permission reaches the host (it ends the call as rejected) and nothing runs.
  await assert.rejects(board.execute({action:'board.items.delete',payload:{deny:true}}),/Permission denied/);assert.equal(calls.length,2);
  assert.equal((await board.execute({action:'library.list'})).ok,false);assert.equal(calls.length,2);
  assert.equal((await board.execute({action:'board.items.delete'},{abort:AbortSignal.abort()})).error.code,'CANCELLED');
  assert.equal(approvals.length,2);
  assert.deepEqual(resolvePaths({payload:{document:'test.kicad_pcb',output:'out.svg'}},'/workspace'),{payload:{document:'/workspace/test.kicad_pcb',output:'/workspace/out.svg'}});
  await assert.rejects(callTool(runtime,'kicad_actions',{mutates:'false'}),/wrong type/);
});
test('in-process composite tools serialize and queued cancellation never starts an edit', async () => {
  const calls=[],controller=new AbortController();let release;
  const runtime={async dispatch(action,p,{signal}) { if(signal?.aborted)return {ok:false,error:{code:'CANCELLED'}};calls.push(p.index);if(p.index===1)await new Promise(r=>release=r);return {ok:true}; }};
  const board=bindTools(runtime,z).find(t=>t.name==='kicad_board');
  const first=board.execute({action:'board.items.delete',payload:{index:1}});await new Promise(r=>setImmediate(r));
  const second=board.execute({action:'board.items.delete',payload:{index:2}},{abort:controller.signal});controller.abort();release();
  assert.equal((await first).ok,true);assert.equal((await second).ok,false);assert.deepEqual(calls,[1]);
});
test('permission follows the action an operation tool runs, and argument errors stay short', async () => {
  const approvals = [], runtime = { async dispatch(name, p) { return {ok:true,action:name,data:p}; } };
  const tools = bindTools(runtime,z,async (name,args) => approvals.push(callAction(name,args)));
  const workflow = tools.find(t=>t.name==='kicad_workflow'), pipeline = tools.find(t=>t.name==='kicad_pipeline');
  assert.equal((await workflow.execute({operation:'status',project:'/p'})).ok,true);
  assert.equal((await pipeline.execute({operation:'status',project:'/p'})).ok,true);
  assert.deepEqual(approvals,[],'read-only operations run without a write prompt');
  assert.equal((await workflow.execute({operation:'advance',project:'/p',stage:'schematic'})).ok,true);
  assert.deepEqual(approvals,['workflow.advance'],'the prompt names the operation it runs');
  assert.equal(callMutates('kicad_board',{action:'board.items.get'}),false);
  assert.equal(callMutates('kicad_board',{action:'board.items.delete'}),true);
  assert.equal(callMutates('kicad_call',{action:'no.such.action'}),true,'unknown actions count as changes');
  assert.equal(callMutates('kicad_reference',{}),false);
  const board = tools.find(t=>t.name==='kicad_board');
  const wrong = await board.execute({action:'library.list'});
  assert.equal(wrong.error.code,'INVALID_ARGUMENTS');assert.match(wrong.error.message,/"library\.list".*kicad_library/);
  assert.ok(wrong.error.message.length < 200,'no list of every allowed action: '+wrong.error.message.length);
  for (const name of ['kicad_blocks','kicad_workflow','kicad_pipeline','kicad_native_tools'])
    assert.deepEqual(tools.find(t=>t.name===name).inputSchema.required,['operation'],name+' needs an operation');
  assert.equal((await tools.find(t=>t.name==='kicad_native_tools').execute({limit:2})).error.code,'INVALID_ARGUMENTS');
});

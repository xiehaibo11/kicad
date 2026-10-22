// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {KiCadIPC} from '../ipc.mjs';
import {DirectError} from '../utils.mjs';

async function fixture(fn) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-discovery-'));
  const ipc=new KiCadIPC({socket:path.join(dir,'api.sock')});
  ipc.explicitSocket=false;
  try{await fn(ipc,dir);}finally{ipc.close();fs.rmSync(dir,{recursive:true,force:true});}
}
const unavailable=()=>{throw new DirectError('IPC_UNAVAILABLE','fixture offline');};
test('explicit sockets never fall through to another instance or GUI startup',()=>fixture(async ipc=>{
 ipc.explicitSocket=true;ipc.callRaw=unavailable;ipc.startGUI=()=>assert.fail('must not start GUI');
 await assert.rejects(ipc.connect({timeoutMs:100}),e=>e.code==='IPC_UNAVAILABLE');
}));
test('default discovery selects a live PID socket and refuses ambiguous instances',()=>fixture(async(ipc,dir)=>{
 const a=path.join(dir,'api-12.sock'),b=path.join(dir,'api-13.sock');fs.writeFileSync(a,'');
 ipc.callRaw=async()=>{if(ipc.socket===ipc.defaultSocket)unavailable();return {};};
 await ipc.connect({timeoutMs:1000});assert.equal(ipc.socket,a);
 ipc.socket=ipc.defaultSocket;fs.writeFileSync(b,'');
 await assert.rejects(ipc.connect({timeoutMs:1000}),e=>e.code==='AMBIGUOUS_INSTANCE');
}));
test('concurrent callers share GUI startup and wait through native NOT_READY',()=>fixture(async ipc=>{
 let launches=0,polls=0;
 ipc.startGUI=async()=>{launches++;};
 ipc.callRaw=async()=>{if(!launches)unavailable();if(polls++<2)throw new DirectError('NOT_READY','loading');return {};};
 await Promise.all([ipc.connect({timeoutMs:2000}),ipc.connect({timeoutMs:2000})]);assert.equal(launches,1);assert.ok(polls>=3);
}));
test('initializing peers are awaited without spawning and submitted failures are never replayed',()=>fixture(async ipc=>{
 let polls=0,writes=0;ipc.startGUI=()=>assert.fail('already initializing');
 ipc.callRaw=async(request)=>{if(request.endsWith('.Ping')){if(polls++<2)throw new DirectError('NOT_READY','loading');return {};}
 writes++;throw new DirectError('IPC_UNAVAILABLE','disconnected after submission');};
 await assert.rejects(ipc.call('fixture.Edit',{}, {timeoutMs:2000}),e=>e.code==='IPC_UNAVAILABLE');assert.equal(writes,1);
}));

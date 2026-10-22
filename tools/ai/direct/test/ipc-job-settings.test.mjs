// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {KiCadIPC} from '../ipc.mjs';
test('empty terminal socket configuration uses the native default',()=>{
 const previous=process.env.KICAD_API_SOCKET;process.env.KICAD_API_SOCKET='';
 try { for(const socket of [undefined,'']) { const ipc=new KiCadIPC({socket});assert.match(ipc.socket,/kicad\/api\.sock$/);ipc.close(); } }
 finally {if(previous===undefined)delete process.env.KICAD_API_SOCKET;else process.env.KICAD_API_SOCKET=previous;}
});
test('nested job settings retain document/output/timeout aliases together',async()=>{
 const ipc=new KiCadIPC({socket:'/nonexistent'});let request;
 ipc.call=async(name,body)=>{request=body;return {status:'JS_SUCCESS',outputPath:[]};};
 try{
  await ipc.action('board.jobs.svg',{document:'/tmp/native-job.kicad_pcb',output:'/tmp/job.svg',layers:['F.Cu'],timeoutMs:1234,jobSettings:{options:{dryRun:true}}});
  assert.equal(request.job_settings.document.board_filename,'native-job.kicad_pcb');
  assert.equal(request.job_settings.output_path,'/tmp/job.svg');
  assert.equal(request.job_settings.options.timeout_ms,1234);
  assert.equal(request.job_settings.options.dryRun,true);
 }finally{ipc.close();}
});
test('plot jobs reject an empty layer list before submitting and accept comma separated layers',async()=>{
 const ipc=new KiCadIPC({socket:'/nonexistent'});const requests=[];
 ipc.call=async(name,body)=>{requests.push(body);return {status:'JS_SUCCESS',outputPath:[]};};
 try{
  for(const action of ['board.jobs.svg','board.jobs.dxf','board.jobs.pdf','board.jobs.ps']){
   await assert.rejects(ipc.action(action,{document:'/tmp/native-job.kicad_pcb',output:'/tmp/job'}),/layers is required/);
   await assert.rejects(ipc.action(action,{document:'/tmp/native-job.kicad_pcb',output:'/tmp/job',layers:[]}),/layers is required/);
  }
  assert.equal(requests.length,0);
  await ipc.action('board.jobs.dxf',{document:'/tmp/native-job.kicad_pcb',output:'/tmp/job',layers:'F.Cu, Edge.Cuts'});
  assert.deepEqual(requests[0].plot_settings.layers,['F.Cu','Edge.Cuts']);
 }finally{ipc.close();}
});
test('document listing preserves native library editor types and rejects unknown types',async()=>{
 const ipc=new KiCadIPC({socket:'/nonexistent'});let request;const requestedTypes=[];
 ipc.call=async(name,body)=>{request=body;requestedTypes.push(body.type);return {documents:[]};};
 try{
  for(const [input,expected] of [['footprint','DOCTYPE_FOOTPRINT'],['DOCTYPE_FOOTPRINT','DOCTYPE_FOOTPRINT'],['symbol','DOCTYPE_SYMBOL'],['schematic','DOCTYPE_SCHEMATIC']]){
   await ipc.action('document.list',{type:input});assert.equal(request.type,expected);
  }
  requestedTypes.length=0;
  const listed=await ipc.action('document.list',{});
  assert.deepEqual(requestedTypes,['DOCTYPE_PCB','DOCTYPE_SCHEMATIC','DOCTYPE_FOOTPRINT']);
  assert.deepEqual(listed.data.documents,[]);
  await assert.rejects(ipc.action('document.list',{type:'footprnt'}),/Unknown document type/);
 }finally{ipc.close();}
});

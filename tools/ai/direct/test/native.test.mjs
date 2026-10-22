// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Runtime } from '../runtime.mjs';
import { idOf } from '../board-common.mjs';
const binary = process.env.KICAD_TEST_CLI;
test('isolated native KiCad: direct IPC writes/readback/delete, temporary live DRC and CLI export', { skip: !binary, timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kicad-direct-native-')), document = path.join(dir, 'isolated.kicad_pcb'), socket = path.join(dir, 'api.sock');
  fs.copyFileSync(new URL('../../../../qa/data/pcbnew/drc_courtyard/overlap/empty_board.kicad_pcb', import.meta.url), document);
  const original = fs.readFileSync(document), child = spawn(binary, ['api-server', '--socket', socket, document], { env: { ...process.env, KICAD_RUN_FROM_BUILD_DIR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }); let log = '';
  child.stdout.on('data', b => { log += b; }); child.stderr.on('data', b => { log += b; });
  const runtime = new Runtime({ binary, socket });
  const checked = async (name, payload) => { const r = await runtime.dispatch(name, payload); assert.equal(r.ok, true, name + ': ' + JSON.stringify(r)); return r.data; };
  try {
    for (let n = 0; !fs.existsSync(socket) && n < 100 && child.exitCode === null; n++) await new Promise(r => setTimeout(r, 100));
    assert.ok(fs.existsSync(socket), log);
    for (let n = 0; n < 100; n++) { const ping = await runtime.dispatch('system.ping', { timeoutMs: 1000 }); if (ping.ok) break; if (n === 99) assert.fail(JSON.stringify(ping) + log); await new Promise(r => setTimeout(r, 100)); }
    await checked('system.ping', {}); const version = await checked('system.api.version', {}); assert.ok(version);
    const docs = await checked('document.list', {}); assert.equal(docs.documents.length, 1);
    const fragment='(footprint "NativeImport" (version 20260206) (layer "F.Cu") (attr smd) (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))';
    const imported=await checked('board.items.from_string',{document,contents:fragment});
    const importedAgain=await checked('board.items.from_string',{document,contents:fragment});
    const importedIds=[...imported.createdItems,...importedAgain.createdItems].map(x=>idOf(x.item));
    assert.equal(new Set(importedIds).size,2,'repeat imports have independent UUIDs');
    const badImport=await runtime.dispatch('board.items.from_string',{document,contents:'(not-native)'});
    assert.equal(badImport.ok,false);assert.equal(badImport.error.code,'BAD_REQUEST');
    assert.equal((await checked('board.items.get',{document,types:['footprint']})).items.length,2,'bad input made no partial edit');
    await checked('board.items.delete',{document,ids:importedIds});
    const preview = await checked('board.via.create', { document, position: { xMm: 10, yMm: 12 }, dryRun: true }); assert.equal(preview.applied, false);
    const via = await checked('board.via.create', { document, position: { xMm: 10, yMm: 12 }, drillMm: 0.3, diameterMm: 0.6 });
    assert.equal(via.verified, true);
    const got = await checked('board.items.get', { document, types: ['via'] }); assert.equal(got.items.length, 1);
    const modified = await checked('board.via.modify', {document,ids:got.items.map(idOf),diameterMm:0.8}); assert.equal(modified.verified,true);
    await checked('board.items.delete', { document, ids: got.items.map(idOf) });
    const remaining = await checked('board.items.get', { document, types: ['via'] }); assert.equal(remaining.items.length, 0);
    const file = path.join(dir,'test.kicad_mod'); fs.writeFileSync(file,'(footprint "Test" (version 20260206) (layer "F.Cu") (attr smd) (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask")))');
    const footprint = await checked('board.footprint.place',{document,file,reference:'U1',position:{xMm:15,yMm:15}}); assert.equal(footprint.verified,true);
    const area = await checked('board.rule_area.create',{document,name:'TEST_KEEP_OUT',box:{x1Mm:20,y1Mm:20,x2Mm:25,y2Mm:25},layers:['F.Cu'],keepout:{tracks:true,vias:true}}); assert.equal(area.verified,true);
    const rules = await checked('board.rules.region.set',{document,area:'TEST_KEEP_OUT',clearanceMm:0.3}); assert.equal(rules.verified,true);
    const live = await checked('board.drc.live', { document, severityAll: true, full: true, timeoutMs: 30000 }); assert.ok(live.summary); assert.equal(live.source, 'live');
    assert.deepEqual(fs.readFileSync(document), original, 'live checking must not save the original');
    const output = path.join(dir, 'isolated.svg'); await checked('board.export.svg', { input: document, output, layers: 'F.Cu' }); assert.ok(fs.statSync(output).size);
  } finally { runtime.close(); child.kill('SIGTERM'); if (child.exitCode === null) await Promise.race([once(child, 'exit'), new Promise(r => setTimeout(r, 3000))]); if (child.exitCode === null) child.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('isolated native schematic generation resolves library pins, creates labels and saves', {skip:!binary,timeout:90000},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-direct-schematic-')),document=path.join(dir,'new.kicad_sch'),socket=path.join(dir,'api.sock');
  fs.writeFileSync(path.join(dir,'new.kicad_pro'),'{}');
  const library=new URL('../../../../qa/data/libraries/Device.kicad_sym',import.meta.url).pathname;
  fs.writeFileSync(path.join(dir,'sym-lib-table'),`(sym_lib_table (version 7) (lib (name "Device") (type "KiCad") (uri "${library}") (options "") (descr "")))`);
  const child=spawn(binary,['api-server','--socket',socket],{env:{...process.env,KICAD_RUN_FROM_BUILD_DIR:'1',KICAD_CONFIG_HOME:path.join(dir,'config')},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  const runtime=new Runtime({binary,socket});
  try {
    for(let n=0;n<100;n++){const ping=await runtime.dispatch('system.ping',{timeoutMs:500});if(ping.ok)break;await new Promise(r=>setTimeout(r,100));}
    const result=await runtime.dispatch('schematic.generate',{document,project:dir,new:true,noErc:true,spec:{components:[{reference:'R1',libId:'Device:R',position:{xMm:50,yMm:50}}],nets:[{name:'SIGNAL',pins:['R1.1']},{name:'GND',pins:['R1.2']}]}});
    assert.equal(result.ok,true,JSON.stringify(result)+log);assert.equal(result.data.components.length,1);assert.equal(result.data.nets.length,2);assert.equal(result.data.saved,true);assert.ok(fs.statSync(document).size);
    const netlist=await runtime.dispatch('schematic.export.netlist',{input:document,output:path.join(dir,'new.net')});assert.equal(netlist.ok,true,JSON.stringify(netlist));assert.match(fs.readFileSync(path.join(dir,'new.net'),'utf8'),/SIGNAL/);
    const erc=await runtime.dispatch('schematic.erc.live',{document,full:true,severityAll:true,timeoutMs:30000});assert.equal(erc.ok,true,JSON.stringify(erc));assert.ok(erc.data.reportJson);assert.ok(erc.data.summary);
  }finally{runtime.close();child.kill('SIGTERM');if(child.exitCode===null)await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL');fs.rmSync(dir,{recursive:true,force:true});}
});

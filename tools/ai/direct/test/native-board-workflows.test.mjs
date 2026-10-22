// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Runtime} from '../runtime.mjs';
import {footprintSource} from '../library-native.mjs';
import {blankBoard} from '../native-files.mjs';
import {idOf,kindOf,padsOf} from '../board-common.mjs';
const binary=process.env.KICAD_TEST_CLI;
test('native board workflows: images, silk, netclasses, constraints, layer hop, cleanup, DSN/SES and reports',{skip:!binary,timeout:180000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-79-board-')),document=path.join(dir,'native.kicad_pcb'),socket=path.join(dir,'api.sock');
 let source=blankBoard(),nodes=['(net 1 "USB_P")','(net 2 "USB_N")','(net 3 "GND")'];
 nodes.push(`(footprint "Test" (layer "F.Cu") (at 30 30) (uuid ${randomUUID()}) (fp_text reference "U1" (at 0 -2) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15)))) (fp_text value "Test" (at 0 2) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15)))) (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask") (net 1 "USB_P")) (pad "2" smd rect (at 2 0) (size 1 1) (layers "F.Cu" "F.Mask") (net 2 "USB_N")))`);
 nodes.push(`(gr_rect (start 20 20) (end 100 100) (stroke (width 0.05) (type default)) (fill none) (layer "Edge.Cuts") (uuid ${randomUUID()}))`);
 source=source.slice(0,source.lastIndexOf(')'))+nodes.join('\n')+'\n)';fs.writeFileSync(document,source);fs.writeFileSync(path.join(dir,'native.kicad_pro'),'{}');
  const schematic=path.join(dir,'native.kicad_sch'),library=new URL('../../../../qa/data/libraries/Device.kicad_sym',import.meta.url).pathname;
  fs.writeFileSync(path.join(dir,'sym-lib-table'),`(sym_lib_table (version 7) (lib (name "Device") (type "KiCad") (uri "${library}") (options "") (descr "")))`);
  fs.mkdirSync(path.join(dir,'Parts.pretty'));fs.writeFileSync(path.join(dir,'Parts.pretty/Test.kicad_mod'),footprintSource({name:'Test',pads:[{number:'1',widthMm:1,heightMm:1},{number:'2',xMm:2,widthMm:1,heightMm:1}]}));
  fs.writeFileSync(path.join(dir,'fp-lib-table'),`(fp_lib_table (version 7) (lib (name "Parts") (type "KiCad") (uri "${path.join(dir,'Parts.pretty')}") (options "") (descr "")))`);
 const child=spawn(binary,['api-server','--socket',socket,document],{env:{...process.env,KICAD_RUN_FROM_BUILD_DIR:'1',KICAD_CONFIG_HOME:path.join(dir,'config')},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 const runtime=new Runtime({binary,socket,notify:async message=>{assert.equal(message,'native test');}});
 const check=async(action,p={})=>{const r=await runtime.dispatch(action,{document,...p});assert.equal(r.ok,true,action+': '+JSON.stringify(r)+'\n'+log);if(process.env.KICAD_WORKFLOW_EVIDENCE)fs.appendFileSync(process.env.KICAD_WORKFLOW_EVIDENCE,JSON.stringify({action,ok:r.ok,mode:'native-ipc/cli'})+'\n');return r.data;};
 try{
  for(let i=0;i<100;i++){const r=await runtime.dispatch('system.ping',{timeoutMs:500});if(r.ok)break;await new Promise(r=>setTimeout(r,100));}
  await check('board.current');await check('pcb.board.info');
  const stack=(await check('board.stackup.read')).stackup;await check('pcb.stackup.set',{stackup:stack});
  await check('pcb.net_class.list');await check('pcb.net_class.create',{name:'Signal',clearanceMm:0.2,trackWidthMm:0.25});
  await check('pcb.constraint.list');await check('pcb.differential_pair.create',{name:'USB',positiveNet:'USB_P',negativeNet:'USB_N',gapMm:0.2,widthMm:0.2});
  await check('pcb.differential_pair.rename',{name:'USB',newName:'USB2'});await check('pcb.differential_pair.delete',{name:'USB2'});
  await check('pcb.equal_length_group.create',{name:'Signals',nets:['USB_P','USB_N'],maxSkewMm:0.5});await check('pcb.equal_length_group.add_nets',{name:'Signals',nets:['GND']});await check('pcb.equal_length_group.delete',{name:'Signals'});
  const fp=(await check('board.items.get',{types:['footprint']})).items[0];assert.ok(fp);await check('pcb.components.arrange',{ids:[idOf(fp)],position:{xMm:35,yMm:35},spacingMm:10});
  const moved=(await check('board.items.get',{types:['footprint']})).items[0];assert.equal(padsOf(moved)[0].x-padsOf(fp)[0].x,5000000);assert.equal(padsOf(moved)[0].y-padsOf(fp)[0].y,5000000);
  await check('pcb.silk.align',{ids:[idOf(fp)],axis:'y',coordinateMm:27});
  await check('pcb.silk.netnames',{ids:[idOf(fp)]});await check('pcb.silk.label_pads',{ids:[idOf(fp)]});
  await check('pcb.silk.import_svg',{svg:'<svg width="10mm" height="10mm" viewBox="0 0 10 10"><path d="M 0 0 L 5 0 L 5 5 Z" fill="none"/></svg>',position:{xMm:80,yMm:80}});
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  const image=await check('pcb.image.create',{imageBase64:png,position:{xMm:80,yMm:70},scale:1});await check('pcb.image.list');await check('pcb.image.modify',{id:image.ids[0],position:{xMm:81,yMm:70},scale:2});await check('pcb.image.delete',{ids:image.ids});
  await check('pcb.route.via_hop',{start:{xMm:40,yMm:40},end:{xMm:70,yMm:40},via1:{xMm:45,yMm:40},via2:{xMm:65,yMm:40},layer:'F.Cu',hopLayer:'B.Cu',net:'GND',diameterMm:0.6,drillMm:0.3});
  await check('board.items.create',{items:[{type:'track',json:{start:{xNm:40000000,yNm:60000000},end:{xNm:50000000,yNm:60000000},width:{valueNm:250000},layer:'BL_F_Cu',net:{name:'GND'}}},{type:'track',json:{start:{xNm:50000000,yNm:60000000},end:{xNm:60000000,yNm:60000000},width:{valueNm:250000},layer:'BL_F_Cu',net:{name:'GND'}}}]});
  const clean=await check('pcb.beautify',{dryRun:false});assert.ok(clean.merges.length>=1);
  await check('pcb.pour.rebuild');await check('pcb.export.dsn',{output:path.join(dir,'native.dsn')});
  fs.writeFileSync(path.join(dir,'routed.ses'),'(session "native" (base_design "native.dsn") (routes (resolution um 1) (parser (string_quote ") (space_in_quoted_tokens on) (host_cad "KiCad") (host_version "10")) (library_out) (network_out (net "GND" (wire (path "F.Cu" 250 40000 -70000 60000 -70000) (type route))))))');
  const routed=await check('pcb.import_autoroute',{file:path.join(dir,'routed.ses')});
  assert.ok(routed.routingItems.some(i=>kindOf(i)==='Track'&&i.net.name==='GND'&&Number(i.start.xNm)===40000000&&Number(i.start.yNm)===70000000&&Number(i.end.xNm)===60000000&&Number(i.end.yNm)===70000000&&Number(i.width.valueNm)===250000),'Native SES must create the requested real copper route');
  await check('pcb.snapshot',{output:path.join(dir,'snapshot.svg')});await check('pcb.report',{output:path.join(dir,'report.json')});
  await check('system.notify',{message:'native test'});
  const original=fs.readFileSync(document);const block=await runtime.dispatch('pcb.config.set',{document,settings:{text_variables:{x:'test'}}});assert.equal(block.error?.code,'DOCUMENT_OPEN',JSON.stringify({block,documents:await runtime.dispatch('document.list',{type:'pcb'})}));assert.deepEqual(fs.readFileSync(document),original);
  await check('schematic.generate',{document:schematic,project:dir,new:true,noErc:true,spec:{components:[{reference:'U1',value:'10k',libId:'Device:R',footprint:'Parts:Test',position:{xMm:50,yMm:50}}],nets:[{name:'USB_P',pins:['U1.1']},{name:'USB_N',pins:['U1.2']}]}});
  await check('pcb.component.attrs_backfill',{schematic});
  const backfill=(await check('board.items.get',{types:['footprint']})).items[0];assert.equal(backfill.valueField.text.text.text,'10k');
  const imported=await check('pcb.import_changes',{schematic,matchMode:'NMM_REFERENCE',updateFootprints:false,output:path.join(dir,'sync.net')});assert.ok(imported.readback.length);
  const current=(await check('board.items.get')).items;await check('pcb.page.clear',{ids:current.filter(i=>kindOf(i)==='BoardText').map(idOf),confirm:true});
 }finally{runtime.close();child.kill('SIGTERM');if(child.exitCode===null)await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL');if(process.env.KICAD_KEEP_NATIVE_FIXTURE)console.log('Native fixture retained: '+dir);else fs.rmSync(dir,{recursive:true,force:true});}
});

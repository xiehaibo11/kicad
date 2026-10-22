// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Runtime} from '../runtime.mjs';
import {idOf,kindOf} from '../board-common.mjs';
const binary=process.env.KICAD_TEST_CLI;
test('native schematic workflows preserve fields and pin geometry, save and export',{skip:!binary,timeout:180000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-79-schematic-')),document=path.join(dir,'native.kicad_sch'),socket=path.join(dir,'api.sock');
 fs.writeFileSync(path.join(dir,'native.kicad_pro'),'{}');
 const library=new URL('../../../../qa/data/libraries/Device.kicad_sym',import.meta.url).pathname;
 fs.writeFileSync(path.join(dir,'sym-lib-table'),`(sym_lib_table (version 7) (lib (name "Device") (type "KiCad") (uri "${library}") (options "") (descr "")))`);
 const child=spawn(binary,['api-server','--socket',socket],{env:{...process.env,KICAD_RUN_FROM_BUILD_DIR:'1',KICAD_CONFIG_HOME:path.join(dir,'config')},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 const runtime=new Runtime({binary,socket});
 const check=async(action,p={})=>{const r=await runtime.dispatch(action,{document,...p});assert.equal(r.ok,true,action+': '+JSON.stringify(r)+'\n'+log);if(process.env.KICAD_WORKFLOW_EVIDENCE)fs.appendFileSync(process.env.KICAD_WORKFLOW_EVIDENCE,JSON.stringify({action,ok:r.ok,mode:'native-ipc/cli'})+'\n');return r.data;};
 try{
  for(let i=0;i<100;i++){const r=await runtime.dispatch('system.ping',{timeoutMs:500});if(r.ok)break;await new Promise(r=>setTimeout(r,100));}
  await check('schematic.generate',{project:dir,new:true,noErc:true,spec:{components:[{reference:'R1',libId:'Device:R',position:{xMm:50,yMm:50}}],nets:[]}});
  await check('schematic.titleblock.get');await check('schematic.titleblock.modify',{titleBlock:{title:'Native workflow test',revision:'A'}});
  const symbol=(await check('schematic.items.get',{types:['symbol']})).items.find(i=>kindOf(i)==='SchematicSymbolInstance');assert.ok(symbol);
  const id=idOf(symbol),inspect=await check('schematic.attribute.inspect',{id});
  await check('schematic.attribute.move',{id,field:'referenceField',position:{xMm:48,yMm:48},expectedSha256:inspect.symbols[0].stateSha256});
  const stale=await runtime.dispatch('schematic.attribute.move',{document,id,field:'referenceField',position:{xMm:40,yMm:40},expectedSha256:inspect.symbols[0].stateSha256});assert.equal(stale.error.code,'SOURCE_CHANGED');
  await check('schematic.designators.list');await check('schematic.group.move',{ids:[id],delta:{xMm:5,yMm:5}});
  await check('schematic.rebind.footprint',{id,libId:'Resistor_SMD:R_0603_1608Metric'});
  await check('schematic.rebind.symbol',{id,libId:'Device:R'});await check('schematic.component.replace',{id,libId:'Device:R',value:'10k'});
  await check('schematic.visible_text.bboxes');
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  const image=await check('schematic.image.create',{imageBase64:png,position:{xMm:80,yMm:70},scale:1});await check('schematic.image.list');await check('schematic.image.modify',{id:image.ids[0],position:{xMm:81,yMm:70},scale:2});
  await check('schematic.power.connect_pin',{id,pin:'1',net:'VCC'});await check('schematic.pin.disconnect',{id,pin:'2',wireIds:[]});
  const netlist=await check('schematic.netlist.get');assert.ok(JSON.stringify(netlist).includes('VCC'));
  await check('document.save');await check('schematic.export.netlist',{document:undefined,input:document,output:path.join(dir,'pins.net')});const netSource=fs.readFileSync(path.join(dir,'pins.net'),'utf8');assert.match(netSource,/\(name "VCC"\)[\s\S]*?\(node\s+\(ref "R1"\)\s+\(pin "1"\)/);
  await check('schematic.check');await check('schematic.bridgeCheck');await check('schematic.export.image',{output:path.join(dir,'svg')});
  await check('document.save');assert.match(fs.readFileSync(document,'utf8'),/Native workflow test/);await check('schematic.page.open',{file:document});
 }finally{runtime.close();child.kill('SIGTERM');if(child.exitCode===null)await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL');if(process.env.KICAD_KEEP_NATIVE_FIXTURE)console.log('Native fixture retained: '+dir);else fs.rmSync(dir,{recursive:true,force:true});}
});

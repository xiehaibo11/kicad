// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {Runtime} from '../runtime.mjs';
const binary=process.env.KICAD_TEST_CLI;
test('native parser loads generated symbol library and selects child sheet IPC context',{skip:!binary,timeout:60000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-native-hierarchy-')),document=path.join(dir,'Root.kicad_sch'),socket=path.join(dir,'api.sock');
 const runtime=new Runtime({binary,socket});let child;
 const check=async(action,p)=>{const r=await runtime.dispatch(action,p);assert.equal(r.ok,true,action+': '+JSON.stringify(r));return r.data;};
 try{
  await check('project.create',{directory:dir,name:'Root'});
  await check('schematic.page.create',{file:document,name:'Power',page:'Power.kicad_sch'});
  const library=path.join(dir,'Parts.kicad_sym');
  await check('library.symbol.build',{file:library,name:'NativePart',pins:[{number:'1',name:'IN',xMm:-5,yMm:0},{number:'2',name:'OUT',xMm:5,yMm:0,angleDeg:180}],body:{x1Mm:-2,y1Mm:-2,x2Mm:2,y2Mm:2}});
  const env={...process.env,KICAD_RUN_FROM_BUILD_DIR:'1',KICAD_CONFIG_HOME:path.join(dir,'config')};
  execFileSync(binary,['sym','export','svg','--output',path.join(dir,'svg'),library],{env,stdio:'pipe'});
  assert.ok(fs.readdirSync(path.join(dir,'svg')).some(f=>f.endsWith('.svg')));
  child=spawn(binary,['api-server','--socket',socket,document],{env,stdio:'ignore'});
  for(let i=0;i<100;i++){if((await runtime.dispatch('system.ping',{timeoutMs:500})).ok)break;await new Promise(r=>setTimeout(r,100));}
  const pages=await check('schematic.pages.list',{document}),sheetId=pages.hierarchy.children[0].sheetId;
  const opened=await check('schematic.page.open',{document,sheetId});assert.equal(opened.verified,true);assert.equal(opened.document.sheetPath.path.at(-1).value,sheetId);
  await check('schematic.titleblock.modify',{document:opened.document,titleBlock:{title:'Child only'}});
  assert.equal((await check('schematic.titleblock.get',{document:opened.document})).title,'Child only');
  assert.notEqual((await check('schematic.titleblock.get',{document})).title,'Child only');
  const sourceBefore=fs.readFileSync(path.join(dir,'Power.kicad_sch'),'utf8');
  const snapshot=path.join(dir,'snapshot');fs.mkdirSync(snapshot);
  await check('document.save_copy',{document,path:path.join(snapshot,'Root.kicad_sch')});
  assert.match(fs.readFileSync(path.join(snapshot,'Power.kicad_sch'),'utf8'),/Child only/,'copy includes unsaved child content');
  assert.equal(fs.readFileSync(path.join(dir,'Power.kicad_sch'),'utf8'),sourceBefore,'snapshot does not save live source');
  await check('document.save',{document});assert.match(fs.readFileSync(path.join(dir,'Power.kicad_sch'),'utf8'),/Child only/);
  if(process.env.KICAD_WORKFLOW_EVIDENCE)fs.appendFileSync(process.env.KICAD_WORKFLOW_EVIDENCE,JSON.stringify({action:'schematic.page.open',ok:true,mode:'native-child-sheet-ipc',symbolLibraryParsed:true})+'\n');
 }finally{runtime.close();if(child){child.kill('SIGTERM');if(child.exitCode===null)await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL');}fs.rmSync(dir,{recursive:true,force:true});}
});

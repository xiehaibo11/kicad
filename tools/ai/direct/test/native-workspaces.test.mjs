// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {nativeWorkflowSchemas} from '../native-workflow-schemas.mjs';
import {Runtime,byName} from '../runtime.mjs';
import {nativeWorkflows} from '../native-workflows.mjs';
import audit from '../data/connector-audit.json' with {type:'json'};
import {pairComplement} from '../rules-native.mjs';
import {blankSchematic,parse,walkSheets} from '../native-files.mjs';
const noIPC={async action(){throw Object.assign(new Error('No editor'),{code:'IPC_UNAVAILABLE'});},close(){}};
export function evidence(name,result,extra={}){if(process.env.KICAD_WORKFLOW_EVIDENCE)fs.appendFileSync(process.env.KICAD_WORKFLOW_EVIDENCE,JSON.stringify({action:name,ok:result.ok,mode:'native-files',...extra})+'\n');}
test('all 79 original deferred handlers have concrete in-process native workflows',()=>{
  const names=audit.actions.filter(a=>['requires-native-workflow','native-workflow'].includes(a.status)).map(a=>a.originalAction);
  assert.equal(names.length,79);assert.equal(nativeWorkflows.size,79);for(const name of names){assert.ok(nativeWorkflows.has(name),name);assert.ok(nativeWorkflowSchemas.has(name),name);assert.ok(byName.has(name),name);assert.equal(byName.get(name).nativeWorkflow,true);}
  assert.equal(pairComplement('USB_P12'),'USB_N12');assert.equal(pairComplement('USB+'),'USB-');assert.equal(pairComplement('MISO'),null);
});
test('native file workflows preserve hierarchy, libraries, project settings and recoverable deletions',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-native-files-')),runtime=new Runtime({ipc:noIPC});
  const check=async(action,p)=>{const r=await runtime.dispatch(action,p);assert.equal(r.ok,true,action+': '+JSON.stringify(r));evidence(action,r);return r.data;};
  try{
    await check('project.create',{directory:dir,name:'Test'});const document=path.join(dir,'Test.kicad_sch'),board=path.join(dir,'Test.kicad_pcb'),project=path.join(dir,'Test.kicad_pro');
    await check('schematic.pages.list',{document});await check('schematic.page.create',{document,name:'Power',page:'Power.kicad_sch'});
    let tree=walkSheets(document);assert.equal(tree.children[0].name,'Power');const sheetId=tree.children[0].sheetId;
    await check('schematic.page.rename',{document,sheetId,newName:'Supply'});
    const child=path.join(dir,'Power.kicad_sch');await check('schematic.rename',{document:child,newName:'Supply',parent:document});
    assert.equal(walkSheets(document).children[0].file,path.join(dir,'Supply.kicad_sch'));
    await check('schematic.page.clear',{document:path.join(dir,'Supply.kicad_sch'),confirm:true});
    await check('schematic.page.delete',{document,sheetId,confirm:true});assert.ok(fs.existsSync(path.join(dir,'Supply.kicad_sch')));assert.equal(walkSheets(document).children.length,0);
    await check('board.list',{directory:dir});await check('board.create',{file:path.join(dir,'second.kicad_pcb')});await check('board.new_pcb',{file:path.join(dir,'third.kicad_pcb')});
    await check('board.copy',{file:board,output:path.join(dir,'copy.kicad_pcb')});await check('board.rename',{file:path.join(dir,'copy.kicad_pcb'),newName:'renamed'});
    const deleted=await check('board.delete',{file:path.join(dir,'renamed.kicad_pcb'),confirm:true});assert.ok(fs.readdirSync(deleted.backup).some(x=>x.endsWith('.kicad_pcb')));
    fs.writeFileSync(path.join(dir,'Target.kicad_pro'),'{}');await check('board.rebind',{file:board,project:path.join(dir,'Target.kicad_pro')});
    await check('pcb.config.set',{project,settings:{board:{design_settings:{rules:{min_clearance:0.2}}}}});
    await check('pcb.net.color.set',{project,net:'GND',color:'#00ff00'});assert.equal(JSON.parse(fs.readFileSync(project)).net_settings.net_colors.GND,'#00ff00');
    const fp=path.join(dir,'Parts.pretty','Test.kicad_mod');await check('library.footprint.create',{file:fp,name:'Test'});
    await check('library.footprint.build',{file:fp,name:'Test',pads:[{number:'1',widthMm:1,heightMm:1},{number:'2',xMm:2,widthMm:1,heightMm:1}],lines:[{start:{xMm:-1,yMm:-1},end:{xMm:3,yMm:-1}}]});
    const got=await check('library.footprint.get',{file:fp});assert.equal(got.pads.length,2);
    await check('library.footprint.region_create',{file:fp,layer:'F.SilkS',points:[{xMm:-1,yMm:-1},{xMm:3,yMm:-1},{xMm:3,yMm:1}]});
    await check('library.footprint.copy',{file:fp,output:path.join(dir,'Parts.pretty','Copy.kicad_mod')});await check('library.footprint.delete',{file:path.join(dir,'Parts.pretty','Copy.kicad_mod'),confirm:true});
    const lib=path.join(dir,'Parts.kicad_sym');await check('library.symbol.create',{file:lib,name:'One',pins:[{number:'1',name:'IN',xMm:-5,yMm:0}]});
    await check('library.symbol.build',{file:lib,name:'Two',pins:[{number:'1',xMm:-5,yMm:0},{number:'2',xMm:5,yMm:0,angleDeg:180}],body:{x1Mm:-2,y1Mm:-2,x2Mm:2,y2Mm:2}});
    await check('library.symbol.export_source',{file:lib,name:'Two',output:path.join(dir,'Two.kicad_sym')});await check('library.symbol.delete',{file:lib,name:'One',confirm:true});
    fs.writeFileSync(path.join(dir,'sym-lib-table'),`(sym_lib_table (version 7) (lib (name "Parts") (type "KiCad") (uri "${lib}") (options "") (descr "")))`);
    const libraries=await check('library.list',{directory:dir,configDirectory:path.join(dir,'none')});assert.equal(libraries.libraries[0].name,'Parts');
    const before=fs.readFileSync(board),dry=await check('board.delete',{file:board,confirm:true,dryRun:true});assert.equal(dry.applied,false);assert.deepEqual(fs.readFileSync(board),before);
    assert.equal((await runtime.dispatch('project.create',{directory:dir,name:'Test'})).error.code,'FILE_EXISTS');
    assert.equal((await runtime.dispatch('board.rename',{file:board,newName:'../escape'})).ok,false);
    const openRuntime=new Runtime({ipc:{async action(action){if(action==='document.list')return {ok:true,data:{documents:[{type:'DOCTYPE_PCB',boardFilename:'Test.kicad_pcb',project:{path:dir}}]}};},close(){}}});
    const blocked=await openRuntime.dispatch('board.delete',{file:board,confirm:true});assert.equal(blocked.error.code,'DOCUMENT_OPEN');assert.deepEqual(fs.readFileSync(board),before);openRuntime.close();
  }finally{runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

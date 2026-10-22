// SPDX-License-Identifier: GPL-3.0-or-later
// Execute every native CLI catalog entry on isolated fixtures and retain results.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {frontendFixture} from './frontend-fixture.mjs';
import {outputIsDirectory} from '../cli.mjs';
import {listActions} from '../runtime.mjs';
import {blankBoard} from '../native-files.mjs';
const output=path.resolve(process.argv[3]);fs.mkdirSync(output,{recursive:true});
let source=blankBoard(),nodes=['(net 1 "GND")',`(gr_rect (start 20 20) (end 50 50) (stroke (width 0.05) (type default)) (fill none) (layer "Edge.Cuts") (uuid ${randomUUID()}))`,
 `(footprint "Test" (layer "F.Cu") (at 30 30) (uuid ${randomUUID()}) (attr smd) (fp_text reference "R1" (at 0 -2) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15)))) (fp_text value "10k" (at 0 2) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15)))) (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask" "F.Paste") (net 1 "GND")))`];
source=source.slice(0,source.lastIndexOf(')'))+nodes.join('\n')+'\n)';
const fixture=await frontendFixture(path.resolve(process.argv[2]),{boardSource:source}),{root,runtime}=fixture,records=[];
const board=path.join(root,'fixture.kicad_pcb'),sch=path.join(root,'fixture.kicad_sch'),gerber=path.join(root,'fixture.gbr');
const sym=path.join(root,'Device.kicad_sym');fs.copyFileSync(new URL('../../../../qa/data/libraries/Device.kicad_sym',import.meta.url),sym);
const pretty=path.join(root,'Test.pretty');fs.mkdirSync(pretty);const footprint=path.join(pretty,'Test.kicad_mod');fs.writeFileSync(footprint,'(footprint "Test" (version 20260206) (layer "F.Cu") (attr smd) (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask" "F.Paste")))');
try{
 for(const action of listActions().filter(a=>a.backend==='cli')){
  const name=action.name,command=action.cliSchema,folder=path.join(root,name);fs.mkdirSync(folder);
  let input=name.startsWith('schematic.')?sch:name.startsWith('library.symbol.')?sym:name.startsWith('library.footprint.')?pretty:name.startsWith('gerber.')?gerber:board;
  const p={timeoutMs:45000};
  const ext=name.split('.').at(-1),directory=outputIsDirectory(name,{});
  if(command?.positionals.length===1)p[command.positionals[0].name]=command.positionals[0].multiple?[input]:input;
  else if(command?.positionals.length>1)for(const pos of command.positionals)p[pos.name]=input;
  if(command?.options.some(o=>o.long==='--output'))p.output=directory?path.join(folder,'output')+path.sep:path.join(folder,'output.'+({pythonbom:'xml',position:'csv',bom:'csv',netlist:'net',convert_png:'png',diff:'json',export_svg:'svg',import:name.startsWith('schematic')?'kicad_sch':'kicad_pcb',run:'out',mergetool:'kicad_pcb'}[ext]??ext));
  if(command?.options.some(o=>o.long==='--layers'))p.layers='F.Cu,F.SilkS,Edge.Cuts';
  if(name==='board.render')Object.assign(p,{width:128,height:128,quality:'basic',output:path.join(folder,'render.png')});
  if(name==='library.symbol.export_svg')p.symbol='R';
  if(name==='library.footprint.export_svg')p.footprint='Test';
  if(name==='library.footprint.upgrade')p.output=path.join(folder,'Upgraded.pretty');
  if(name==='project.import')p.output=path.join(folder,'Imported');
  if(name==='schematic.import')p.INPUT_FILE=new URL('../../../../qa/data/eeschema/io/eagle/issue24483_pin_tag.sch',import.meta.url).pathname;
  if(name==='project.jobset.run'){
   const job={jobs:[{id:'native-drc',type:'pcb_drc',settings:{fail_on_error:false,format:'report',output_filename:'native-drc.txt',parity:false,severity:48,units:'mm'}}],meta:{version:1},outputs:[{id:'acceptance',type:'folder',settings:{output_path:path.join(folder,'job-output')}}]};
   const file=path.join(folder,'native.kicad_jobset');fs.writeFileSync(file,JSON.stringify(job));p.INPUT_FILE=path.join(root,'fixture.kicad_pro');p.file=file;p.output='acceptance';
  }
  if(name==='gerber.convert_png')p.dpi=100;
  if(name==='board.drc.run'||name==='schematic.erc.run')Object.assign(p,{format:'json',full:true});
  if(name==='board.upgrade'||name==='schematic.upgrade'){input=path.join(folder,path.basename(input));fs.copyFileSync(name.startsWith('board')?board:sch,input);p.INPUT_FILE=input;}
  const started=Date.now(),result=await runtime.dispatch(name,p);records.push({action:name,payload:p,elapsedMs:Date.now()-started,result});
  fs.writeFileSync(path.join(output,'cli-catalog.json'),JSON.stringify(records,null,2));
  console.log(name,result.ok?'PASS':result.error?.code,result.error?.message??'');
 }
 const artifacts=[];const visit=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())visit(f);else if(fs.statSync(f).size&&dir!==root)artifacts.push({path:path.relative(root,f),bytes:fs.statSync(f).size});}};visit(root);
 fs.writeFileSync(path.join(output,'artifacts.json'),JSON.stringify(artifacts,null,2));
 console.log(JSON.stringify({executed:records.length,successful:records.filter(r=>r.result.ok).length,failures:records.filter(r=>!r.result.ok).map(r=>r.action)}));
}finally{await fixture.close();}

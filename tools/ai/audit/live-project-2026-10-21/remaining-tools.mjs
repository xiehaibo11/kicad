import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {frontendFixture} from '../../direct/scripts/frontend-fixture.mjs';import {blankBoard} from '../../direct/native-files.mjs';
const binary=path.resolve('build/kicad/KiCad.app/Contents/MacOS/kicad-cli'),out=path.dirname(new URL(import.meta.url).pathname),records=[];
const record=async(runtime,action,payload)=>{const result=await runtime.dispatch(action,payload,{timeoutMs:120000});records.push({action,payload,result});fs.writeFileSync(path.join(out,'remaining-tools.json'),JSON.stringify(records,null,2));console.log(action,result.ok?'PASS':result.error?.code);return result;};
let source=blankBoard();const nodes=['(net 1 "GND")','(net 2 "VDD")'];
for(const [ref,x,y]of [['U1',30,30],['C1',65,65]])nodes.push(`(footprint "Test" (layer "F.Cu") (at ${x} ${y}) (uuid ${randomUUID()}) (attr smd) (fp_text reference "${ref}" (at 0 -2) (layer "F.SilkS") (effects (font (size 1 1)))) (fp_text value "Test" (at 0 2) (layer "F.Fab") (effects (font (size 1 1)))) (pad "1" smd rect (at 0 0) (size 0.5 0.5) (layers "F.Cu" "F.Mask") (net 2 "VDD")) (pad "2" smd rect (at 2 0) (size 0.5 0.5) (layers "F.Cu" "F.Mask") (net 1 "GND")))`);
nodes.push(`(gr_rect (start 20 20) (end 100 100) (stroke (width 0.05) (type default)) (fill none) (layer "Edge.Cuts") (uuid ${randomUUID()}))`);source=source.slice(0,source.lastIndexOf(')'))+nodes.join('\n')+'\n)';
let fixture=await frontendFixture(binary,{boardSource:source});
try{
 const {runtime,root}=fixture,document=path.join(root,'fixture.kicad_pcb');
 await record(runtime,'board.decap.place',{document,apply:true,offsetMm:0.3,maxDistanceMm:5});
 await record(runtime,'board.decap.check',{document,maxDistanceMm:5});
 await record(runtime,'board.via.create',{document,net:'GND',position:{xMm:50,yMm:50},diameterMm:0.6,drillMm:0.3});
 const plane=await record(runtime,'board.plane.create',{document,net:'GND',layers:['BL_F_Cu'],outline:[{xMm:25,yMm:25},{xMm:80,yMm:25},{xMm:80,yMm:80},{xMm:25,yMm:80}],fill:true});
 if(plane.data?.plane?.zone)await record(runtime,'board.plane.verify',{document,zone:plane.data.plane.zone});
 const calc=await record(runtime,'board.impedance.calculate',{document,layer:'F.Cu',targetOhm:100});
 if(calc.ok){await record(runtime,'board.items.create',{document,items:[{type:'track',json:{start:{xNm:40000000,yNm:90000000},end:{xNm:60000000,yNm:90000000},width:{valueNm:Math.round(calc.data.widthMm*1e6)},layer:'BL_F_Cu',net:{name:'GND'}}}]});await record(runtime,'board.impedance.check',{document,layer:'F.Cu',targetOhm:100});}
 await record(runtime,'document.save',{document});await record(runtime,'board.export.step',{input:document,output:path.join(out,'fixture.step'),boardOnly:true});
 await record(runtime,'external.step.meshcheck',{input:path.join(out,'fixture.step')});
 await record(runtime,'external.step.meshcheck',{input:'--self-test'});
}finally{await fixture.close();}
// A mechanical coupon intentionally contains no electrical assembly/fiducials.
source=blankBoard();source=source.slice(0,source.lastIndexOf(')'))+`(gr_rect (start 20 20) (end 100 100) (stroke (width 0.05) (type default)) (fill none) (layer "Edge.Cuts") (uuid ${randomUUID()})))`;
fixture=await frontendFixture(binary,{boardSource:source});
try{await record(fixture.runtime,'board.check.unified',{document:path.join(fixture.root,'fixture.kicad_pcb'),fiducials:0});}finally{await fixture.close();}

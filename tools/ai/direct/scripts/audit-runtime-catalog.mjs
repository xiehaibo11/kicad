// SPDX-License-Identifier: GPL-3.0-or-later
// Execute remaining JS/offline/composite/optional-tool actions against native fixtures.
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {frontendFixture} from './frontend-fixture.mjs';import {blankBoard} from '../native-files.mjs';import {listActions} from '../runtime.mjs';
import topics from '../data/catalog.json' with {type:'json'};import native from '../data/native-enriched.json' with {type:'json'};
const output=path.resolve(process.argv[3]);fs.mkdirSync(output,{recursive:true});
let source=blankBoard(),nodes=['(net 1 "USB_P")','(net 2 "USB_N")','(net 3 "GND")','(net 4 "VDD")'];
for(const [ref,x,y,nets]of [['U1',30,30,[1,2,4,3]],['U2',60,30,[1,2]],['C1',60,60,[4,3]]])nodes.push(`(footprint "Test" (layer "F.Cu") (at ${x} ${y}) (uuid ${randomUUID()}) (attr smd) (fp_text reference "${ref}" (at 0 -2) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15)))) (fp_text value "Test" (at 0 2) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15)))) ${nets.map((net,i)=>`(pad "${i+1}" smd rect (at ${i*2} 0) (size 1 1) (layers "F.Cu" "F.Mask") (net ${net} "${['','USB_P','USB_N','GND','VDD'][net]}"))`).join(' ')})`);
nodes.push(`(gr_rect (start 20 20) (end 100 100) (stroke (width 0.05) (type default)) (fill none) (layer "Edge.Cuts") (uuid ${randomUUID()}))`);
nodes.push(`(segment (start 40 70) (end 60 70) (width 0.1) (layer "F.Cu") (net 3) (uuid ${randomUUID()}))`);
source=source.slice(0,source.lastIndexOf(')'))+nodes.join('\n')+'\n)';
const fixture=await frontendFixture(path.resolve(process.argv[2]),{boardSource:source}),{root,runtime}=fixture,records=[];
const document=path.join(root,'fixture.kicad_pcb'),schematic=path.join(root,'fixture.kicad_sch'),pretty=path.join(root,'Parts.pretty');fs.mkdirSync(pretty);
const mod=path.join(pretty,'Test.kicad_mod');fs.writeFileSync(mod,'(footprint "Test" (version 20260206) (layer "F.Cu") (attr smd) (fp_text reference "REF**" (at 0 -2) (layer "F.SilkS") (effects (font (size 1 1)))) (fp_text value "Test" (at 0 2) (layer "F.Fab") (effects (font (size 1 1)))) (fp_rect (start -1 -1) (end 1 1) (stroke (width 0.05) (type default)) (fill none) (layer "F.CrtYd")) (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask" "F.Paste")))');
fs.writeFileSync(path.join(root,'fp-lib-table'),`(fp_lib_table (version 7) (lib (name "Parts") (type "KiCad") (uri "${pretty}") (options "") (descr "")))`);
const circuit=path.join(root,'acceptance.cir');fs.writeFileSync(circuit,'KiCad native audit\nV1 in 0 DC 1\nR1 in 0 1k\n.op\n.end\n');
const args={
 'project.list':{directory:root},'project.resolve':{project:root},'project.switch':{project:document},
 'board.fanout.run':{document,reference:'U1',dryRun:false},
 'board.impedance.layers':{document},'board.impedance.calculate':{document,layer:'F.Cu',widthMm:0.3},'board.impedance.check':{document,layer:'F.Cu',targetOhm:100},
 'board.dfm.analyze':{document},'board.dfm.fix':{document,dryRun:false,minWidthMm:0.25},'board.dfm.full':{document},
 'board.route.autoroute':{document,nets:['USB_P'],planner:'grid',gridMm:0.5,dryRun:false},'board.route.diff_pair':{document,pairs:[{p_start:'U1.1',p_end:'U2.1',n_start:'U1.2',n_end:'U2.2'}]},
 'board.route.length_report':{document,net:'GND'},'board.route.tune_length':{document,net:'GND',targetMm:22,dryRun:false},'board.route.length_match':{document,nets:['USB_P','GND'],dryRun:true},
 'board.check.3d':{document,heights:{U1:1,U2:1,C1:1}},'board.check.unified':{document,full:true},
 'library.search.footprints':{query:'Test',project:root,limit:5},'kicad.cli.run':{args:['version']},
 'external.freerouting.run':{input:path.join(root,'acceptance.dsn'),timeoutMs:20000},'external.ngspice.run':{input:circuit,timeoutMs:20000},'external.step.check':{command:'freecadcmd',input:path.join(root,'native.step'),timeoutMs:20000},'external.step.meshcheck':{input:path.join(root,'native.step'),timeoutMs:20000},'external.command.run':{command:process.argv[2],args:['version']},
 'spec.validate':{spec:{modules:[{name:'Power',kind:'POWER'}]}},'workflow.init':{project:root},'workflow.status':{project:root},'workflow.advance':{project:root,stage:'spec'},'workflow.confirm':{project:root,confirmation:'temporary fixture tested'},'workflow.reset':{project:root,resetAll:true},
 'blocks.list':{},'blocks.search':{query:'ldo'},'blocks.show':{id:'block.ams1117_ldo_3v3'},'pipeline.run':{project:root,stages:['health']},'pipeline.status':{project:root},
 'editor.native.search':{query:'zoom',limit:2},'editor.native.list':{editor:'pcbnew',limit:2},'editor.native.show':{name:native.tools[0].name},'editor.native.categories':{},
 'system.manifest':{},'audit.rules':{},'audit.run':{board:document,schematic,output:path.join(root,'audit.json')},'audit.footprint':{input:mod},
 'web.search':{query:'KiCad native IPC API',timeoutMs:15000},'web.fetch':{url:'https://1.1.1.1/cdn-cgi/trace',timeoutMs:15000},
 'reference.search':{query:'power'},'reference.get':{id:topics.topics[0].id},'reference.plan':{query:'schematic'},'reference.examples':{query:'power'},
 'release.snapshot':{project:root},'release.template':{project:root},'release.check':{project:root},
 'board.layers.type.get':{document},'board.layers.type.set':{document,layers:{'F.Cu':'signal'},saveFirst:true},
 'board.plane.build':{document,net:'GND',layers:['F.Cu'],outline:[{xMm:25,yMm:25},{xMm:80,yMm:25},{xMm:80,yMm:80},{xMm:25,yMm:80}]},
 'board.keepout.antenna':{document,reference:'U2',layers:['F.Cu']},'board.fiducial.add':{document,count:1,libId:'Parts:Test'},'board.decap.check':{document},'board.decap.place':{document,apply:true},
};
try{
 await runtime.dispatch('document.save',{document});await runtime.dispatch('board.export.step',{input:document,output:path.join(root,'native.step'),boardOnly:true});await runtime.dispatch('pcb.export.dsn',{document,output:path.join(root,'acceptance.dsn')});
 const actions=listActions().filter(a=>!['cli','ipc','native'].includes(a.backend)&&!a.name.startsWith('pcb.')&&!a.name.startsWith('schematic.')&&Object.hasOwn(args,a.name)||a.name==='system.health'||a.name==='external.tools.list');
 for(const a of actions){const p=args[a.name]??{};if(a.name==='project.switch')await runtime.dispatch('document.close',{document,confirm:true});const result=await runtime.dispatch(a.name,p,{timeoutMs:45000});records.push({action:a.name,payload:p,result});fs.writeFileSync(path.join(output,'runtime-catalog.json'),JSON.stringify(records,null,2));console.log(a.name,result.ok?'PASS':result.error?.code,result.error?.message??'');}
 console.log(JSON.stringify({executed:records.length,successful:records.filter(r=>r.result.ok).length,negative:records.filter(r=>!r.result.ok).map(r=>({action:r.action,error:r.result.error}))}));
}finally{await fixture.close();}

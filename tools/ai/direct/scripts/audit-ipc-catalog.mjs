// SPDX-License-Identifier: GPL-3.0-or-later
// Native IPC coverage beyond the workflow suites. Failures remain in the report.
import fs from 'node:fs';
import path from 'node:path';
import {frontendFixture} from './frontend-fixture.mjs';
import {listActions} from '../runtime.mjs';
import {idOf} from '../board-common.mjs';
const output=path.resolve(process.argv[3]);fs.mkdirSync(output,{recursive:true});
const fixture=await frontendFixture(path.resolve(process.argv[2])),{runtime,root}=fixture,board=path.join(root,'fixture.kicad_pcb'),sch=path.join(root,'fixture.kicad_sch');
const records=[],seen=new Set(),saved={};
if(process.argv[4])for(const line of fs.readFileSync(process.argv[4],'utf8').trim().split('\n')){const r=JSON.parse(line);if(r.ok)seen.add(r.action);}
const invoke=async(action,p)=>{const result=await runtime.dispatch(action,p);records.push({action,payload:p,result});fs.writeFileSync(path.join(output,'ipc-catalog.json'),JSON.stringify(records,null,2));console.log(action,result.ok?'PASS':result.error?.code,result.error?.message??'');return result;};
try{
 const via=await runtime.dispatch('board.via.create',{document:board,position:{xMm:10,yMm:12}}),id=via.data?.ids?.[0];
 const listed=await runtime.dispatch('board.items.get',{document:board,types:['via']});const ids=listed.data?.items?.map(idOf)||[];
 const args={
  'system.plugin_settings_path':{identifier:'org.kicad.acceptance'},'project.open':{path:board},'project.info':{},'library.search.symbols':{query:'R',library:'Device'},
  'schematic.annotate':{start:1},'editor.run_action':{action:'common.Control.zoomFitScreen',editor:'pcbnew'},
  'editor.selection.add':{ids},'editor.selection.remove':{ids},'editor.selection.clear':{},'editor.selection.get':{},
  'board.items.by_net':{nets:['']},'board.items.connected':{ids},'board.items.by_netclass':{netClasses:['Default']},
  'board.origin.set':{xMm:5,yMm:7},'board.bbox.get':{ids},'board.hittest':{id:ids[0],xMm:10,yMm:12,tolerance:1000000},
  'board.layers.name.get':{layer:'BL_F_Cu'},'board.layers.by_name.get':{name:'F.Cu'},'board.netclasses.get':{nets:['']},
  'board.pad.polygon.get':{pads:[],layer:'BL_F_Cu'},'board.text.expand':{text:['${KICAD_VERSION}','acceptance'],expandEnvVars:false},
  'board.layers.enabled.set':{layers:['BL_F_Cu','BL_B_Cu','BL_Edge_Cuts','BL_F_SilkS','BL_B_SilkS']},
  'project.textvars.set':{variables:{variables:{ACCEPTANCE:'native'}},mergeMode:'MMM_MERGE'},
  'board.layers.visible.set':{layers:['BL_F_Cu','BL_Edge_Cuts']},'board.layers.active.set':{layer:'BL_F_Cu'},
  'board.embedded.add':{files:{files:[]}},'board.embedded.set':{files:{files:[]}},
  'board.drc.marker.add':{severity:'DRS_INFO',message:'temporary acceptance marker',position:{xNm:'10000000',yNm:'12000000'}},
  'board.padstack.presence':{items:ids,layers:['BL_F_Cu','BL_B_Cu']},'board.move.interactive':{items:ids},
  'editor.nets.highlight':{netName:['']},'editor.crossprobe.announce':{frameType:'FT_PCB_EDITOR',socketPath:fixture.env.KICAD_API_SOCKET},
  'editor.selection.sync':{items:[]},'editor.library.open':{type:'DOCTYPE_FOOTPRINT',identifier:{libraryNickname:'Test',entryName:'Test'}},
  'document.text.shapes':{text:[]},
  'schematic.variants.add':{name:'Acceptance',description:'native test'},
  'schematic.variants.copy':{oldName:'Acceptance',newName:'Copy',newDescription:'copy'},
  'schematic.variants.rename':{oldName:'Copy',newName:'Renamed'},
  'schematic.variants.describe':{name:'Renamed',description:'updated'},
  'schematic.variants.current.set':{name:'Renamed'},'schematic.variants.delete':{name:'Acceptance'},
  'board.flip':{ids,direction:'x'},'document.close_all':{force:true},
 };
 const delayed=['editor.commit.end','document.revert','document.close','project.open','document.close_all','job.status','job.cancel'];
 const actions=listActions().filter(a=>a.backend==='ipc'&&!seen.has(a.name));
 const variantOrder=['add','copy','rename','describe','current.set','current.get','delete'];actions.sort((a,b)=>a.name.startsWith('schematic.variants.')&&b.name.startsWith('schematic.variants.')?variantOrder.indexOf(a.name.slice('schematic.variants.'.length))-variantOrder.indexOf(b.name.slice('schematic.variants.'.length)):0);
 const sequence=[...actions.filter(a=>!delayed.includes(a.name)),...delayed.map(n=>actions.find(a=>a.name===n)).filter(Boolean)];
 for(const a of sequence){
  const name=a.name,schema=a.inputSchema,p={...(args[name]??{}),timeoutMs:45000};
  const field=Object.keys(schema).find(k=>['board','document','schematic','header','jobSettings'].includes(k));
  if(field)p.document=name.startsWith('schematic.')?sch:board;
  if(name.startsWith('schematic.variants.'))p.document=sch;
  if(name.startsWith('project.textvars.'))p.document={type:'project',path:path.join(root,'fixture.kicad_pro')};
  if(name==='board.items.from_string'){const r=await runtime.dispatch('board.export.string',{document:board});p.contents=r.data.contents;}
  if(name==='schematic.items.delete'){const r=await runtime.dispatch('schematic.items.get',{document:sch,types:['symbol']});p.ids=r.data.items.map(idOf);}
  if(name==='board.plane.create')Object.assign(p,{layers:['BL_F_Cu'],outline:[{xMm:2,yMm:2},{xMm:30,yMm:2},{xMm:30,yMm:30},{xMm:2,yMm:30}],name:'Acceptance',fill:true});
  if(name==='board.plane.verify')p.zone=saved.zone;
  if(name.includes('.jobs.')){
   p.output=path.join(root,name.replaceAll('.','-'))+'.'+name.split('.').at(-1);
   if(schema.plotSettings)p.plotSettings=name.startsWith('board')?{layers:['BL_F_Cu','BL_Edge_Cuts']}:{};
   p.jobSettings={options:{deterministic:true}};
   for(const [key,value]of Object.entries(schema))if(value.values&&['format','units','side'].includes(key))p[key]=Object.keys(value.values).find(n=>!n.endsWith('_UNKNOWN')&&!n.endsWith('_UNSPECIFIED'));
   if(name==='board.jobs.3d')Object.assign(p,{exportBoardBody:true,boardOnly:true,output:path.join(root,'native.step')});
   if(name==='board.jobs.render')Object.assign(p,{width:128,height:128});
  }
  if(name==='board.rules.set'){const r=await runtime.dispatch('board.rules.get',{document:board});p.rules=r.data?.rules??r.data;}
  if(name==='board.pagesettings.set'){const r=await runtime.dispatch('board.pagesettings.get',{document:board});p.pageSettings=r.data?.settings??r.data?.pageSettings??r.data;}
  if(name==='board.plotsettings.set'){const r=await runtime.dispatch('board.plotsettings.get',{document:board});p.plotSettings=r.data?.plotSettings??r.data;}
  if(name==='board.appearance.set'){const r=await runtime.dispatch('board.appearance.get',{});if(r.ok)p.settings=r.data?.settings??r.data;}
  if(name==='editor.commit.end'){p.id=saved.commit;p.action='commit';p.message='native acceptance';}
  if(name==='job.status'||name==='job.cancel')p.jobId=saved.jobId??'nonexistent-acceptance-job';
  if(['document.close','document.close_all','document.revert'].includes(name)){p.confirm=true;await runtime.dispatch('document.save',{document:board});}
  const r=await invoke(name,p);if(name==='editor.commit.begin')saved.commit=r.data?.id;if(name==='board.plane.create')saved.zone=r.data?.plane?.zone;if(r.data?.jobId)saved.jobId=r.data.jobId;
 }
 console.log(JSON.stringify({executed:records.length,successful:records.filter(r=>r.result.ok).length,failed:records.filter(r=>!r.result.ok).length}));
}finally{await fixture.close();}

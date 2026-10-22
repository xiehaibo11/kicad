// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { bad,ok,required,positive,nm,number,DirectError,hashFile } from './utils.mjs';
import { call,idOf,kindOf,xy,point,layerEnum,netOf,padsOf } from './board-common.mjs';
import { getNativeItems,mutateItems,selectItems } from './native-items.mjs';
import { loadGeometry,blocked,trackItem,cross } from './geometry.mjs';
import { applyVia } from './vias.mjs';
export const boardRouteNames=['pcb.route.via_hop','pcb.pour.rebuild','pcb.beautify','pcb.export.dsn','pcb.import_autoroute'];
export async function boardRouteNative(action,p,dispatch){
  const document=required(p,'document');
  if(action==='pcb.pour.rebuild'){
    if(p.dryRun)return ok(action,{dryRun:true,applied:false});await call(dispatch,'board.zones.refill',{document});const zones=await getNativeItems(dispatch,document,false,['zone']);
    return ok(action,{verified:true,zones,connectivity:await dispatch('board.connectivity.prove',{document,requireFilledZones:true})});
  }
  if(action==='pcb.export.dsn'){
    const output=path.resolve(required(p,'output'));if(!output.endsWith('.dsn')||fs.existsSync(output))bad('output must be a new .dsn filename');
    if(p.dryRun)return ok(action,{dryRun:true,applied:false,output});fs.mkdirSync(path.dirname(output),{recursive:true});await call(dispatch,'board.specctra.export',{document,outputPath:output});
    if(!fs.existsSync(output)||!/^\s*\(pcb\s/.test(fs.readFileSync(output,'utf8')))throw new DirectError('EXPORT_UNPROVEN','Native DSN exporter did not produce a valid board');return ok(action,{verified:true,output,sha256:hashFile(output),source:'native DSN::ExportBoardToSpecctraFile'},[output]);
  }
  if(action==='pcb.import_autoroute'){
    const file=path.resolve(required(p,'file'));if(!file.endsWith('.ses')||!fs.statSync(file).size)bad('file must be a nonempty native Specctra .ses session');
    if(p.dryRun)return ok(action,{dryRun:true,applied:false,file,sha256:hashFile(file)});
    await call(dispatch,'board.specctra.import',{document,sessionPath:file});const items=await getNativeItems(dispatch,document,false,['track','via','arc']);
    return ok(action,{verified:true,file,sha256:hashFile(file),routingItems:items,connectivity:await dispatch('board.connectivity.prove',{document,requireFilledZones:false}),validation:'Import read back; DRC and design acceptance remain required'});
  }
  const all=await getNativeItems(dispatch,document);
  if(action==='pcb.beautify'){
    const tracks=all.filter(s=>kindOf(s)==='Track'&&s.locked!=='LS_LOCKED'&&!/[PN+\-][_\d]*$/.test(netOf(s))),pins=all.filter(s=>kindOf(s)==='FootprintInstance').flatMap(padsOf),merges=[],used=new Set();
    const eq=(a,b)=>Number(a?.xNm)===Number(b?.xNm)&&Number(a?.yNm)===Number(b?.yNm);
    for(const a of tracks)for(const b of tracks){if(a===b||used.has(idOf(a))||used.has(idOf(b))||a.layer!==b.layer||netOf(a)!==netOf(b)||a.width.valueNm!==b.width.valueNm)continue;
      const common=[a.start,a.end].find(x=>[b.start,b.end].some(y=>eq(x,y)));if(!common)continue;
      if(all.filter(t=>['Track','Arc','Via'].includes(kindOf(t))).some(t=>t!==a&&t!==b&&[t.start,t.end,t.position].some(x=>x&&eq(x,common)))||pins.some(pad=>Math.hypot(pad.x-Number(common.xNm),pad.y-Number(common.yNm))<=Math.max(pad.sizeX,pad.sizeY)/2))continue;
      const start=eq(common,a.start)?a.end:a.start,end=eq(common,b.start)?b.end:b.start;
      if(Math.abs(cross(xy(start),xy(common),xy(end)))>1||Math.hypot(Number(start.xNm)-Number(end.xNm),Number(start.yNm)-Number(end.yNm))<1)continue;
      // Only merge when the shared point lies strictly between endpoints (no overlapping reversal).
      const dot=(Number(start.xNm)-Number(common.xNm))*(Number(end.xNm)-Number(common.xNm))+(Number(start.yNm)-Number(common.yNm))*(Number(end.yNm)-Number(common.yNm));if(dot>=0)continue;
      used.add(idOf(a));used.add(idOf(b));merges.push({a,b,next:{...a,start,end}});
    }
    if(p.dryRun!==false)return ok(action,{dryRun:true,applied:false,merges:merges.map(m=>({update:idOf(m.a),remove:idOf(m.b)})),method:'Conservative collinear merge; copper geometry preserved; differential nets excluded'});
    const applied=[];for(const m of merges){await mutateItems(action,p,dispatch,[m.next]);try{await mutateItems(action,p,dispatch,[m.b],{operation:'delete'});applied.push({updated:idOf(m.a),deleted:idOf(m.b)});}catch(err){throw new DirectError('CLEANUP_PARTIAL',err.message,{applied,updated:idOf(m.a),cause:err.detail});}}
    return ok(action,{applied:true,verified:true,merges:applied,geometryPreserved:true});
  }
  const start=xy(point(required(p,'start'))),end=xy(point(required(p,'end'))),a=xy(point(required(p,'via1'))),b=xy(point(required(p,'via2'))),layer=layerEnum(required(p,'layer')),hop=layerEnum(required(p,'hopLayer')),net=required(p,'net'),width=nm(positive(p.widthMm,0.25)),clearance=nm(positive(p.clearanceMm,0.2));
  if(layer===hop)bad('hopLayer must differ from layer');const enabled=(await call(dispatch,'board.layers.get',{document})).layers;if(!enabled.includes(layer)||!enabled.includes(hop)||!layer.endsWith('_Cu')||!hop.endsWith('_Cu'))bad('Hop layers must be enabled copper layers');
  if(!(await call(dispatch,'board.nets.get',{document})).nets?.some(n=>n.name===net))bad('Unknown net');
  const geometry=await loadGeometry(dispatch,document),diameter=nm(positive(p.diameterMm,0.6)),segments=[[start,a,layer],[a,b,hop],[b,end,layer]];
  if(segments.some(([x,y])=>Math.hypot(x.x-y.x,x.y-y.y)<diameter))bad('Hop segments are too short for via diameter');
  for(const[x,y,l]of segments)if(blocked(x,y,net,l,width,clearance,geometry))bad('Hop track conflicts with native copper, keepout or edge');
  for(const at of [a,b])for(const l of enabled.filter(l=>l.endsWith('_Cu')))if(blocked(at,at,net,l,diameter,clearance,geometry))bad('Hop via conflicts on '+l);
  const native=segments.map(([x,y,l])=>{const t=trackItem(x,y,width,l,net);return {'@type':'kiapi.board.types.Track',...t.json};}).concat([a,b].map(at=>({'@type':'kiapi.board.types.Via',...applyVia({position:{xNm:at.x,yNm:at.y},net:{name:net}},p)})));
  return mutateItems(action,p,dispatch,native,{operation:'create'});
}

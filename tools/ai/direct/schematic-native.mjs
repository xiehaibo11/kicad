// SPDX-License-Identifier: GPL-3.0-or-later
import path from 'node:path';
import { bad,ok,required,nm,number,DirectError,sha256 } from './utils.mjs';
import { idOf,kindOf,call,point } from './board-common.mjs';
import { contains,getNativeItems,selectItems,mutateItems,fieldsOf,textOf,moveItem,imageNative } from './native-items.mjs';
import { liveCopy } from './live.mjs';
export const schematicNames=['schematic.titleblock.get','schematic.titleblock.modify','schematic.attribute.inspect','schematic.attribute.move','schematic.designators.list','schematic.image.create','schematic.image.list','schematic.image.modify','schematic.group.move','schematic.pin.disconnect','schematic.check','schematic.bridgeCheck','schematic.export.image','schematic.power.connect_pin','schematic.rebind.footprint','schematic.rebind.symbol','schematic.component.replace','schematic.visible_text.bboxes'];
function pins(s){return (s.definition?.items??[]).filter(v=>(!v.unit||v.unit.unit===0||v.unit.unit===s.unit?.unit)&&kindOf(v.item)==='SchematicPin').map(v=>v.item);}
export function pinPosition(s,number){
  const matches=pins(s).filter(p=>p.number===String(number));if(matches.length!==1)bad('Pin is missing or ambiguous on selected unit');
  let x=Number(matches[0].position.xNm),y=Number(matches[0].position.yNm),t=s.transform??{};
  const angle={SO_0:0,SO_90:90,SO_180:180,SO_270:270,SSO_0:0,SSO_90:90,SSO_180:180,SSO_270:270}[t.orientation]??0,r=-angle*Math.PI/180;
  const xx=x*Math.cos(r)-y*Math.sin(r),yy=x*Math.sin(r)+y*Math.cos(r);
  return {xNm:Math.round(Number(s.position.xNm)+(t.mirrorY?-xx:xx)),yNm:Math.round(Number(s.position.yNm)+(t.mirrorX?-yy:yy))};
}
export async function schematicNative(action,p,dispatch){
  if(action.includes('.image.')&&!action.endsWith('export.image'))return imageNative(action,p,dispatch,true);
  const document=required(p,'document');
  if(action.startsWith('schematic.titleblock.')){
    const before=await call(dispatch,'board.titleblock.get',{document});
    if(action.endsWith('.get'))return ok(action,before);
    if(p.dryRun)return ok(action,{dryRun:true,applied:false,before,changes:p.titleBlock});
    const titleBlock={...before,...required(p,'titleBlock')};await call(dispatch,'board.titleblock.set',{document,titleBlock});
    const readback=await call(dispatch,'board.titleblock.get',{document});if(!contains(readback,titleBlock))throw new DirectError('READBACK_MISMATCH','Title block readback differs',{readback,titleBlock});
    return ok(action,{verified:true,readback});
  }
  if(['schematic.check','schematic.bridgeCheck'].includes(action)){
    const hierarchy=await call(dispatch,'schematic.hierarchy.get',{document}),netlist=await call(dispatch,'schematic.netlist.get',{document});
    const erc=await dispatch('schematic.erc.live',{document,full:true,severityAll:true});
    if(!erc.ok)return {...erc,action};return ok(action,{hierarchy,netlist,erc:erc.data,source:'native KiCad IPC + ERC',passed:erc.data.summary?.total===0});
  }
  if(action==='schematic.export.image'){
    if(p.dryRun)return ok(action,{dryRun:true,applied:false});const snapshot=await liveCopy(p,dispatch,true);
    const result=await dispatch('schematic.export.svg',{input:snapshot.copy,output:required(p,'output')});return {...result,action,data:{...result.data,source:'native rendered schematic',checkedCopy:snapshot.copy}};
  }
  const all=await getNativeItems(dispatch,document,true),symbols=all.filter(s=>kindOf(s)==='SchematicSymbolInstance');
  if(action==='schematic.designators.list')return ok(action,{designators:symbols.map(s=>({id:idOf(s),reference:textOf(s.referenceField),unit:s.unit?.unit??1}))});
  if(action==='schematic.visible_text.bboxes'){
    const boxes=[];for(const s of all){const texts=kindOf(s)==='SchematicSymbolInstance'?fieldsOf(s).filter(x=>x.field.visible).map(x=>({field:x.field.name,text:x.field.text})):s.text?[{text:s.text}]:[];for(const t of texts){const box=await call(dispatch,'document.text.extents',{text:t.text});boxes.push({id:idOf(s),field:t.field,text:t.text.text,box});}}
    return ok(action,{source:'native font extents',boxes});
  }
  if(action==='schematic.group.move'){
    const selected=selectItems(all,p),delta=point(required(p,'delta'));return mutateItems(action,p,dispatch,selected.map(s=>moveItem(s,delta)),{schematic:true});
  }
  const selected=selectItems(symbols,p);
  if(action==='schematic.attribute.inspect')return ok(action,{symbols:selected.map(s=>({id:idOf(s),reference:textOf(s.referenceField),stateSha256:sha256(JSON.stringify(s)),fields:fieldsOf(s)}))});
  if(action==='schematic.attribute.move'){
    const name=required(p,'field');const updates=selected.map(s=>{
      const expected=p.expectedSha256;if(!expected||expected!==sha256(JSON.stringify(s)))throw new DirectError('SOURCE_CHANGED','Inspect attribute state and supply its exact expectedSha256 before moving');
      const next=structuredClone(s),f=fieldsOf(next).find(v=>v.field.name===name||v.key===name);if(!f)bad('Unknown symbol field');f.field.text.position=point(required(p,'position'));if(p.angleDeg!==undefined)f.field.text.attributes={...f.field.text.attributes,angle:{valueDegrees:number(p.angleDeg)}};return next;
    });return mutateItems(action,p,dispatch,updates,{schematic:true});
  }
  if(action==='schematic.rebind.footprint'){
    const libId=required(p,'libId');if(!/^[^:]+:[^:]+$/.test(libId))bad('libId must be Library:Footprint');
    return mutateItems(action,p,dispatch,selected.map(s=>({...s,footprintField:{...s.footprintField,text:{...s.footprintField?.text,text:libId}}})),{schematic:true});
  }
  if(['schematic.rebind.symbol','schematic.component.replace'].includes(action)){
    const libId=required(p,'libId'),lib=await call(dispatch,'library.get.symbol',{libId});
    const signature=s=>pins(s).map(pin=>[pin.number,pin.position]).sort((a,b)=>a[0].localeCompare(b[0]));
    const updates=selected.map(s=>{const next={...s,definition:lib.definition,libId:lib.definition.id};if(JSON.stringify(signature(s))!==JSON.stringify(signature(next)))bad('Replacement changes pin geometry/identity; reconnect explicitly before replacing');if(p.value!==undefined)next.valueField={...s.valueField,text:{...s.valueField.text,text:String(p.value)}};return next;});
    return mutateItems(action,p,dispatch,updates,{schematic:true});
  }
  if(selected.length!==1)bad('Select one symbol for pin operation');const s=selected[0],at=pinPosition(s,required(p,'pin'));
  if(action==='schematic.power.connect_pin'){
    const name=required(p,'net');return mutateItems(action,p,dispatch,[{'@type':'kiapi.schematic.types.GlobalLabel',position:at,text:{text:name},shape:'SLSH_INPUT'}],{schematic:true,operation:'create'});
  }
  // Disconnect by removing only explicitly enumerated wires touching this pin, then add an NC marker.
  const equal=v=>Number(v?.xNm)===at.xNm&&Number(v?.yNm)===at.yNm;
  const contacts=all.filter(i=>['LocalLabel','GlobalLabel','HierarchicalLabel','Junction'].includes(kindOf(i))&&equal(i.position));
  const interior=all.filter(i=>kindOf(i)==='SchematicLine'&&i.start&&i.end&&!equal(i.start)&&!equal(i.end)&&Math.abs((at.xNm-Number(i.start.xNm))*(Number(i.end.yNm)-Number(i.start.yNm))-(at.yNm-Number(i.start.yNm))*(Number(i.end.xNm)-Number(i.start.xNm)))<1&&at.xNm>=Math.min(Number(i.start.xNm),Number(i.end.xNm))&&at.xNm<=Math.max(Number(i.start.xNm),Number(i.end.xNm))&&at.yNm>=Math.min(Number(i.start.yNm),Number(i.end.yNm))&&at.yNm<=Math.max(Number(i.start.yNm),Number(i.end.yNm)));
  if(contacts.length||interior.length)bad('Remove attached labels/junctions or split crossing wires explicitly before disconnecting this pin');
  if(all.some(i=>kindOf(i)==='NoConnectMarker'&&equal(i.position)))bad('Pin already has a no-connect marker');
  const wires=all.filter(i=>kindOf(i)==='SchematicLine'&&[i.start,i.end].some(v=>Number(v?.xNm)===at.xNm&&Number(v?.yNm)===at.yNm));
  if(!Array.isArray(p.wireIds)||p.wireIds.length!==wires.length||wires.some(w=>!p.wireIds.includes(idOf(w))))bad('wireIds must exactly list all wire endpoints touching the selected pin');
  if(p.dryRun)return ok(action,{dryRun:true,applied:false,pinPosition:at,deleteIds:wires.map(idOf),createNoConnect:true});
  const deleted=wires.length?await mutateItems(action,p,dispatch,wires,{schematic:true,operation:'delete'}):null;
  try{return await mutateItems(action,p,dispatch,[{'@type':'kiapi.schematic.types.NoConnectMarker',position:at}],{schematic:true,operation:'create'});}catch(err){throw new DirectError(err.code??'DISCONNECT_PARTIAL',err.message,{deleted,cause:err.detail});}
}

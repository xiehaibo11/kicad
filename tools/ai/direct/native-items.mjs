// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import { bad,ok,required,positive,DirectError,unwrap } from './utils.mjs';
import { idOf,kindOf,itemsOf,call,point,layerEnum } from './board-common.mjs';
export const contains=(actual,expected)=>expected&&typeof expected==='object' ? actual&&Object.entries(expected).every(([key,val])=>contains(actual[key],val)) : String(actual)===String(expected);
export const fieldsOf=s=>['referenceField','valueField','footprintField','datasheetField','descriptionField'].flatMap(k=>s[k]?[{key:k,field:s[k]}]:[]).concat((s.userFields??[]).map((field,i)=>({key:'userFields',index:i,field})));
export const textOf=f=>f?.text?.text??'';
export async function getNativeItems(dispatch,document,schematic=false,types){return itemsOf(await call(dispatch,schematic?'schematic.items.get':'board.items.get',{document,...(types?{types}:{})}));}
export function selectItems(all,p){const ids=p.ids??(p.id?[p.id]:[]);if(!ids.length)bad('Explicit ids[] are required');if(new Set(ids).size!==ids.length)bad('Duplicate item IDs');const selected=ids.map(id=>all.find(s=>idOf(s)===id));if(selected.some(x=>!x))bad('Unknown item ID');if(!p.overrideLocks&&selected.some(s=>s.locked==='LS_LOCKED'))bad('Selected item is locked');return selected;}
export async function mutateItems(action,p,dispatch,plan,{schematic=false,operation='update'}={}){
  const document=required(p,'document'),prefix=schematic?'schematic':'board';
  if(p.dryRun)return ok(action,{dryRun:true,applied:false,operation,items:plan});
  const ids=operation==='delete'?plan.map(idOf):undefined;
  const result=await call(dispatch,prefix+'.items.'+operation,{document,...(ids?{ids}:{items:plan})});
  const affected=ids??itemsOf(result).map(idOf);if(affected.length!==plan.length||affected.some(id=>!id))throw new DirectError('NATIVE_ITEM_INCOMPLETE','Native response was incomplete',{result});
  const back=await getNativeItems(dispatch,document,schematic),found=back.filter(s=>affected.includes(idOf(s)));
  if(operation==='delete'?found.length!==0:found.length!==affected.length)throw new DirectError('READBACK_MISMATCH','Native item readback did not match',{affected,found});
  if(operation==='update')for(const item of plan){const actual=found.find(s=>idOf(s)===idOf(item));for(const key of ['position','start','end','imageData','imageScale','referenceField','valueField','footprintField','userFields','libId','transform','definition','text','layer'])if(item[key]!==undefined&&!contains(actual[key],item[key]))throw new DirectError('READBACK_MISMATCH','Native field did not persist: '+key,{id:idOf(item),expected:item[key],actual:actual[key]});}
  return ok(action,{applied:true,verified:true,ids:affected,items:found});
}
export function moveItem(item,delta){
  const next=structuredClone(item),dx=delta.xNm,dy=delta.yNm;
  const move=v=>{if(v&&v.xNm!==undefined){v.xNm=String(Number(v.xNm)+dx);v.yNm=String(Number(v.yNm)+dy);}};
  // Symbol fields have absolute coordinates; embedded definition geometry remains local.
  for(const key of ['position','start','end','mid'])move(next[key]);
  if(next.text?.position)move(next.text.position);
  if(kindOf(next)==='SchematicSymbolInstance')for(const {field} of fieldsOf(next))move(field.text?.position);
  return next;
}
// Native footprint children serialize in board coordinates. Move their geometry too,
// while padstack shapes, text sizes and 3D-model offsets remain local.
export function moveFootprint(item,delta){
  const next=structuredClone(item),dx=delta.xNm,dy=delta.yNm;
  const coordinateKeys=new Set(['position','start','end','mid','center','radiusPoint','topLeft','bottomRight','point','control1','control2']);
  function visit(node){if(!node||typeof node!=='object')return;for(const[key,value]of Object.entries(node)){
    if(['padStack','attributes','models','overrides','transformOriginOffset'].includes(key))continue;
    if(coordinateKeys.has(key)&&value&&value.xNm!==undefined){value.xNm=String(Number(value.xNm)+dx);value.yNm=String(Number(value.yNm)+dy);}
    else if(Array.isArray(value))for(const child of value)visit(child);else if(value&&typeof value==='object')visit(value);
  }}
  visit(next.position?{position:next.position}:{});
  for(const key of ['referenceField','valueField','datasheetField','descriptionField'])visit(next[key]);
  for(const child of next.definition?.items??[])if(kindOf(child)!=='Footprint3DModel')visit(child);
  return next;
}
export async function imageNative(action,p,dispatch,schematic){
  const all=(await getNativeItems(dispatch,required(p,'document'),schematic)).filter(i=>kindOf(i)===(schematic?'SchematicImage':'ReferenceImage'));
  const operation=action.split('.').at(-1);
  if(operation==='list')return ok(action,{images:all});
  if(operation==='delete')return mutateItems(action,p,dispatch,selectItems(all,p),{schematic,operation:'delete'});
  let bytes;if(p.imageFile){const size=fs.statSync(p.imageFile).size;if(size>16*1024*1024)bad('Raster exceeds 16 MiB');bytes=fs.readFileSync(p.imageFile);}else if(p.imageBase64){bytes=Buffer.from(p.imageBase64,'base64');}
  if(bytes&&(bytes.length>16*1024*1024||!(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes[0]===255&&bytes[1]===216)))bad('Use PNG/JPEG raster image bytes');
  const updates={...(p.position?{position:point(p.position)}:{}),...(p.scale!==undefined?{imageScale:{value:positive(p.scale)}}:{}),...(bytes?{imageData:bytes.toString('base64')}:{})};
  if(operation==='create'){
    if(!bytes||!p.position)bad('imageFile/imageBase64 and position are required');
    const item={'@type':'kiapi.'+(schematic?'schematic.types.SchematicImage':'board.types.ReferenceImage'),...(!schematic?{layer:layerEnum(p.layer??'Dwgs.User')}:{}),...updates};
    return mutateItems(action,p,dispatch,[item],{schematic,operation:'create'});
  }
  if(!Object.keys(updates).length)bad('No image change requested');
  return mutateItems(action,p,dispatch,selectItems(all,p).map(i=>({...i,...updates})),{schematic});
}

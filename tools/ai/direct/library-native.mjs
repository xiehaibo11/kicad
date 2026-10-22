// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { bad,ok,required,number,positive } from './utils.mjs';
import { fileOf,nameOf,parse,head,child,children,value,quote,replace,raw,transaction,randomUUID } from './native-files.mjs';
export const libraryNames=['library.list','library.footprint.create','library.footprint.get','library.footprint.copy','library.footprint.delete','library.footprint.build','library.footprint.region_create','library.symbol.create','library.symbol.build','library.symbol.export_source','library.symbol.delete'];
const n=(v,d)=>number(v,d), pos=p=>`${n(p.xMm,0)} ${n(p.yMm,0)}`;
function layer(v,def='F.SilkS'){v??=def;if(!/^(F|B|In\d+)\.(Cu|SilkS|Mask|Paste|Fab|CrtYd)$|^(Edge.Cuts|User\.\d+|Cmts.User)$/.test(v))bad('Invalid native layer');return quote(v);}
export function footprintSource(p){
  const name=nameOf(required(p,'name')),pads=p.pads??[],lines=p.lines??[];
  if(!Array.isArray(pads)||!Array.isArray(lines))bad('pads and lines must be arrays');
  const numbers=new Set();
  const out=[`(footprint ${quote(name)} (version 20260206) (generator "kicad-native-js") (layer "F.Cu") (attr ${p.throughHole?'through_hole':'smd'})`];
  out.push('(fp_text reference "REF**" (at 0 -3) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))');
  out.push(`(fp_text value ${quote(name)} (at 0 3) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))`);
  for(const pad of pads){
    const no=String(required(pad,'number'));if(numbers.has(no))bad('Duplicate pad number '+no);numbers.add(no);
    const type=pad.type??'smd',shape=pad.shape??'rect';if(!['smd','thru_hole','np_thru_hole'].includes(type)||!['rect','circle','oval','roundrect'].includes(shape))bad('Unsupported pad type/shape');
    const sx=positive(pad.widthMm),sy=positive(pad.heightMm??sx),drill=type!=='smd'?positive(pad.drillMm):null;if(drill&&drill>Math.min(sx,sy))bad('Drill exceeds pad copper');
    out.push(`(pad ${quote(no)} ${type} ${shape} (at ${pos(pad)} ${n(pad.angleDeg,0)}) (size ${sx} ${sy}) ${drill?`(drill ${drill})`:''} (layers ${type==='smd'?`${layer(pad.layer,'F.Cu')} ${layer((pad.layer??'F.Cu').replace('.Cu','.Paste'))} ${layer((pad.layer??'F.Cu').replace('.Cu','.Mask'))}`:'"*.Cu" "*.Mask"'}) ${shape==='roundrect'?'(roundrect_rratio 0.25)':''} (uuid ${randomUUID()}))`);
  }
  for(const line of lines){const a=required(line,'start'),b=required(line,'end');out.push(`(fp_line (start ${pos(a)}) (end ${pos(b)}) (stroke (width ${positive(line.widthMm,0.15)}) (type default)) (layer ${layer(line.layer)}) (uuid ${randomUUID()}))`);}
  out.push(')');return out.join('\n');
}
export function symbolSource(p){
  const name=nameOf(required(p,'name')),reference=p.referencePrefix??'U',pins=p.pins??[];
  if(!Array.isArray(pins))bad('pins must be an array');const seen=new Set();
  const out=[`(symbol ${quote(name)} (pin_names (offset 1.016)) (in_bom yes) (on_board yes) (property "Reference" ${quote(reference)} (at 0 5.08 0) (effects (font (size 1.27 1.27)))) (property "Value" ${quote(name)} (at 0 2.54 0) (effects (font (size 1.27 1.27))))`];
  if(p.body){const b=p.body;out.push(`(symbol ${quote(name+'_0_1')} (rectangle (start ${n(b.x1Mm)} ${n(b.y1Mm)}) (end ${n(b.x2Mm)} ${n(b.y2Mm)}) (stroke (width 0.254) (type default)) (fill (type background))))`);}
  const types=['input','output','bidirectional','tri_state','passive','free','unspecified','power_in','power_out','open_collector','open_emitter','no_connect'];
  const pinNodes=pins.map(pin=>{const no=String(required(pin,'number'));if(seen.has(no))bad('Duplicate pin '+no);seen.add(no);const type=pin.type??'passive';if(!types.includes(type))bad('Invalid pin electrical type');const angle=n(pin.angleDeg,0);if(![0,90,180,270].includes(angle))bad('Pin angle must be a multiple of 90');return `(pin ${type} line (at ${pos(pin)} ${angle}) (length ${positive(pin.lengthMm,2.54)}) (name ${quote(pin.name??no)} (effects (font (size 1.27 1.27)))) (number ${quote(no)} (effects (font (size 1.27 1.27)))))`;});
  out.push(`(symbol ${quote(name+'_1_1')} ${pinNodes.join('\n')})`,')');return out.join('\n');
}
function libraryTables(p){
  const dirs=[p.directory??p.project??'.',p.configDirectory??path.join(os.homedir(),'Library/Preferences/kicad/10.99')];
  return dirs.flatMap(d=>['sym-lib-table','fp-lib-table'].map(f=>path.join(d,f))).filter(fs.existsSync);
}
export async function libraryNative(action,p,dispatch){
  if(action==='library.list'){
    const libraries=libraryTables(p).flatMap(file=>{const text=fs.readFileSync(file,'utf8');return children(parse(text),'lib').map(node=>({name:value(node,'name'),type:value(node,'type'),uri:value(node,'uri').replaceAll('${KIPRJMOD}',path.dirname(file)),table:file}));});
    return ok(action,{libraries});
  }
  const file=fileOf(p);
  if(action.startsWith('library.footprint.')){
    if(!file.endsWith('.kicad_mod'))bad('file must be a .kicad_mod inside a native .pretty library');
    const exists=fs.existsSync(file),text=exists?fs.readFileSync(file,'utf8'):null;
    if(action.endsWith('.get')){const root=parse(text??'');return ok(action,{file,name:root.children[1]?.value,pads:children(root,'pad').map(s=>({number:s.children[1]?.value,type:s.children[2]?.value,shape:s.children[3]?.value,position:child(s,'at')?.children.slice(1).map(n=>Number(n.value))})),source:text});}
    if(action.endsWith('.delete')){if(p.confirm!==true)bad('confirm:true required');if(!exists)bad('Footprint not found');return transaction(action,p,[{file,text:null}],dispatch);}
    if(action.endsWith('.copy')){
      if(!exists)bad('Source footprint not found');const target=path.resolve(required(p,'output'));if(!target.endsWith('.kicad_mod'))bad('output must be .kicad_mod');const root=parse(text),name=nameOf(p.name??path.basename(target,'.kicad_mod'));
      const result=replace(text,[{start:root.children[1].start,end:root.children[1].end,text:quote(name)}]);return transaction(action,p,[{file:target,text:result,exclusive:true}],dispatch);
    }
    if(action.endsWith('.region_create')){
      if(!exists)bad('Footprint not found');const points=required(p,'points');if(!Array.isArray(points)||points.length<3)bad('A polygon needs at least 3 points');
      const node=`(fp_poly (pts ${points.map(v=>`(xy ${pos(v)})`).join(' ')}) (stroke (width ${n(p.widthMm,0)}) (type default)) (fill solid) (layer ${layer(p.layer)}) (uuid ${randomUUID()}))`;
      const root=parse(text);return transaction(action,p,[{file,text:replace(text,[{start:root.end-1,end:root.end-1,text:'\n'+node+'\n'}])}],dispatch);
    }
    // A build replaces only a structurally empty target; populated library items are protected.
    if(exists&&(children(parse(text),'pad').length||children(parse(text),'fp_line').length||children(parse(text),'fp_poly').length))bad('Build target must be empty; copy/delete explicitly to replace a library item');
    const source=p.source??footprintSource({...p,name:p.name??path.basename(file,'.kicad_mod')});
    return transaction(action,p,[{file,text:source,exclusive:action.endsWith('.create')}],dispatch);
  }
  if(!file.endsWith('.kicad_sym'))bad('file must be a .kicad_sym native symbol library');
  const text=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'(kicad_symbol_lib (version 20250114) (generator "kicad-native-js"))',root=parse(text),name=nameOf(required(p,'name'));
  if(head(root)!=='kicad_symbol_lib')bad('Invalid symbol library');
  const existing=children(root,'symbol').find(s=>s.children[1]?.value===name);
  if(action.endsWith('.export_source')){if(!existing)bad('Symbol not found');const source=raw(text,existing);if(!p.output)return ok(action,{name,file,source});return transaction(action,p,[{file:path.resolve(p.output),text:`(kicad_symbol_lib (version 20250114) (generator "kicad-native-js") ${source})`,exclusive:true}],dispatch);}
  if(action.endsWith('.delete')){if(!existing)bad('Symbol not found');if(p.confirm!==true)bad('confirm:true required');return transaction(action,p,[{file,text:replace(text,[{start:existing.start,end:existing.end,text:''}])}],dispatch);}
  if(existing)bad('Symbol already exists; never overwrite an existing library entry implicitly');
  const source=p.source??symbolSource(p);if(head(parse(source))!=='symbol'||parse(source).children[1]?.value!==name)bad('Source symbol identity does not match name');
  return transaction(action,p,[{file,text:replace(text,[{start:root.end-1,end:root.end-1,text:'\n'+source+'\n'}])}],dispatch);
}

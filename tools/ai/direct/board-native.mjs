// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { bad,ok,required,number,positive,nm,hashFile,DirectError } from './utils.mjs';
import { call,idOf,kindOf,refOf,padsOf,point,layerEnum } from './board-common.mjs';
import { moveFootprint,contains,getNativeItems,selectItems,mutateItems,imageNative,textOf } from './native-items.mjs';
import { fileOf,transaction } from './native-files.mjs';
import { svgShapes } from './svg-native.mjs';
import { liveCopy } from './live.mjs';
export const boardNames=['pcb.stackup.set','pcb.silk.align','pcb.silk.import_svg','pcb.image.create','pcb.image.list','pcb.image.modify','pcb.image.delete','pcb.silk.netnames','pcb.silk.label_pads','pcb.report','pcb.board.info','system.notify','pcb.import_changes','pcb.component.attrs_backfill','pcb.page.clear','pcb.components.arrange','pcb.config.set','pcb.net.color.set','pcb.view.filter.get','pcb.snapshot'];
function merge(target,source){for(const[k,v]of Object.entries(source)){if(['__proto__','prototype','constructor'].includes(k))bad('Invalid configuration key');if(v&&typeof v==='object'&&!Array.isArray(v))target[k]=merge(target[k]&&typeof target[k]==='object'?target[k]:{},v);else target[k]=v;}return target;}
export async function boardNative(action,p,dispatch,options={}){
  if(action==='system.notify'){
    const message=String(required(p,'message'));if(message.length>10000)bad('Notification exceeds 10000 characters');
    if(p.dryRun)return ok(action,{dryRun:true,applied:false,message});
    if(options.notify)await options.notify(message,p.level??'info');else process.stderr.write('[KiCad] '+message+'\n');
    return ok(action,{delivered:true,destination:options.notify?'frontend':'terminal',message});
  }
  if(['pcb.config.set','pcb.net.color.set'].includes(action)&&!p.rules){
    let file=p.project?path.resolve(p.project):fileOf(p).replace(/\.kicad_pcb$/,'.kicad_pro');if(!file.endsWith('.kicad_pro'))bad('project must be a .kicad_pro file');
    const settings=JSON.parse(fs.readFileSync(file,'utf8'));
    if(action==='pcb.net.color.set'){
      const net=String(required(p,'net')),color=required(p,'color');if(!/^#[\da-fA-F]{6}([\da-fA-F]{2})?$|^rgba?\([\d., %]+\)$/.test(color))bad('Use #RRGGBB, #RRGGBBAA or rgba() color');
      settings.net_settings??={};settings.net_settings.net_colors??={};settings.net_settings.net_colors[net]=color;
    }else{
      const patch=required(p,'settings');if(!patch||typeof patch!=='object'||Array.isArray(patch))bad('settings must be an object');
      if(Object.keys(patch).some(k=>!['board','net_settings','pcbnew','text_variables'].includes(k)))bad('Allowed native project sections: board, net_settings, pcbnew, text_variables');merge(settings,patch);
    }
    return transaction(action,p,[{file,text:JSON.stringify(settings,null,2)+'\n'}],dispatch);
  }
  const document=required(p,'document');
  if(action==='pcb.config.set')return {...await dispatch('board.rules.set',{document,rules:p.rules,dryRun:p.dryRun}),action};
  if(action==='pcb.view.filter.get')return ok(action,{appearance:await call(dispatch,'board.appearance.get',{}),visibleLayers:await call(dispatch,'board.layers.visible.get',{document}),activeLayer:await call(dispatch,'board.layers.active.get',{document})});
  if(action==='pcb.stackup.set'){
    if(p.dryRun)return ok(action,{dryRun:true,applied:false,stackup:required(p,'stackup')});
    await call(dispatch,'board.stackup.write',{document,stackup:required(p,'stackup')});const readback=await call(dispatch,'board.stackup.read',{document});if(!contains(readback.stackup,p.stackup))throw new DirectError('READBACK_MISMATCH','Stackup readback differs',{readback});return ok(action,{verified:true,readback});
  }
  if(action.startsWith('pcb.image.'))return imageNative(action,p,dispatch,false);
  if(action==='pcb.import_changes'){
    if(p.dryRun&&!p.netlist)return ok(action,{dryRun:true,applied:false,schematic:required(p,'schematic'),exportNetlist:true});
    let netlist=p.netlist;if(!netlist){const output=p.output??path.join(path.dirname(fileOf(p)),'native-import.net');await call(dispatch,'schematic.export.netlist',{input:required(p,'schematic'),output});netlist=output;}
    const result=await dispatch('board.netlist.import',{document,netlist,dryRun:p.dryRun,matchMode:p.matchMode??'NMM_UUID',deleteExtraFootprints:p.deleteExtraFootprints??false,updateFootprints:p.updateFootprints??true});
    return {...result,action,data:{...result.data,netlist,verified:result.ok&&!p.dryRun,readback:result.ok&&!p.dryRun?await getNativeItems(dispatch,document,false,['footprint']):undefined}};
  }
  if(['pcb.snapshot','pcb.report','pcb.board.info'].includes(action)){
    const items=await getNativeItems(dispatch,document),counts={};for(const i of items)counts[kindOf(i)]=(counts[kindOf(i)]??0)+1;
    const data={document,counts,nets:await call(dispatch,'board.nets.get',{document}),layers:await call(dispatch,'board.layers.get',{document}),stackup:await call(dispatch,'board.stackup.read',{document}),source:'native live document'};
    if(action==='pcb.board.info')return ok(action,data);
    if(p.dryRun)return ok(action,{...data,dryRun:true,applied:false});
    const copy=await liveCopy(p,dispatch);data.checkedCopy=copy.copy;data.sourceSha256=hashFile(copy.copy);
    if(action==='pcb.snapshot'){
      const output=path.resolve(required(p,'output'));await call(dispatch,'board.export.svg',{input:copy.copy,output,layers:p.layers??'F.Cu,F.SilkS,Edge.Cuts'});
      return ok(action,{...data,output,sha256:hashFile(output),imageKind:'native board render; not a viewport screenshot'},[output,copy.copy]);
    }
    data.connectivity=await dispatch('board.connectivity.prove',{document,requireFilledZones:true});data.drc=await dispatch('board.drc.live',{document,full:true,severityAll:true});
    if(!p.output)return ok(action,data,[copy.copy]);const output=path.resolve(p.output);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});return ok(action,{...data,output},[output,copy.copy]);
  }
  if(action==='pcb.silk.import_svg')return mutateItems(action,p,dispatch,svgShapes(p),{operation:'create'});
  const all=await getNativeItems(dispatch,document),fps=all.filter(i=>kindOf(i)==='FootprintInstance');
  if(action==='pcb.page.clear'){
    if(p.confirm!==true)bad('confirm:true required');const selected=p.ids?selectItems(all,p):all;
    if(!p.overrideLocks&&selected.some(i=>i.locked==='LS_LOCKED'))bad('Board contains locked items');return mutateItems(action,p,dispatch,selected,{operation:'delete'});
  }
  if(action==='pcb.components.arrange'){
    const selected=selectItems(fps,p),origin=point(required(p,'position')),columns=p.columns??Math.ceil(Math.sqrt(selected.length)),spacing=nm(positive(p.spacingMm,10));
    if(!Number.isInteger(columns)||columns<1)bad('columns must be positive integer');
    const updates=selected.map((f,i)=>{const position={xNm:Number(origin.xNm)+i%columns*spacing,yNm:Number(origin.yNm)+Math.floor(i/columns)*spacing};return moveFootprint(f,{xNm:position.xNm-Number(f.position.xNm),yNm:position.yNm-Number(f.position.yNm)});});
    return mutateItems(action,p,dispatch,updates);
  }
  if(action==='pcb.component.attrs_backfill'){
    const symbols=(await getNativeItems(dispatch,required(p,'schematic'),true)).filter(i=>kindOf(i)==='SchematicSymbolInstance'),selected=p.ids?selectItems(fps,p):fps;
    const updates=selected.map(fp=>{const matches=symbols.filter(s=>textOf(s.referenceField)===refOf(fp));if(!matches.length)bad('Schematic reference missing: '+refOf(fp));const values=new Set(matches.map(s=>textOf(s.valueField)));if(values.size!==1)bad('Multi-unit symbol values disagree');const next=structuredClone(fp);next.valueField={...fp.valueField,text:{...fp.valueField?.text,text:{...fp.valueField?.text?.text,text:[...values][0]}}};return next;});
    return mutateItems(action,p,dispatch,updates);
  }
  if(['pcb.silk.netnames','pcb.silk.label_pads'].includes(action)){
    const selected=p.ids?selectItems(fps,p):fps,size=nm(positive(p.sizeMm,0.8)),offset=nm(number(p.offsetMm,1));
    const labels=selected.flatMap(fp=>padsOf(fp).filter(pad=>action.endsWith('label_pads')||pad.net).map(pad=>({'@type':'kiapi.board.types.BoardText',layer:layerEnum(p.layer??'F.SilkS'),text:{position:{xNm:pad.x,yNm:pad.y+offset},text:action.endsWith('label_pads')?refOf(fp)+'.'+pad.number:pad.net,attributes:{size:{xNm:size,yNm:size},strokeWidth:{valueNm:nm(0.12)}}}})));
    if(!labels.length)bad('No native pads found for labelling');return mutateItems(action,p,dispatch,labels,{operation:'create'});
  }
  if(action==='pcb.silk.align'){
    const selected=selectItems(all,p),axis=p.axis??'y';if(!['x','y'].includes(axis))bad('axis must be x or y');const coordinate=nm(number(required(p,'coordinateMm')));
    const updates=selected.map(i=>{const next=structuredClone(i),text=kindOf(i)==='FootprintInstance'?next.referenceField?.text?.text:next.text,layer=kindOf(i)==='FootprintInstance'?next.referenceField?.text?.layer:next.layer;if(!text||!['BL_F_SilkS','BL_B_SilkS'].includes(layer))bad('Select silkscreen text or footprint reference fields');text.position={...text.position,[axis+'Nm']:coordinate};return next;});
    return mutateItems(action,p,dispatch,updates);
  }
  bad('Unknown board workflow');
}

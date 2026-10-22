// SPDX-License-Identifier: GPL-3.0-or-later
import { bad,ok,required,positive,nm,DirectError } from './utils.mjs';
import { call } from './board-common.mjs';
export const ruleNames=['pcb.net_class.list','pcb.net_class.create','pcb.constraint.list','pcb.differential_pair.create','pcb.differential_pair.delete','pcb.differential_pair.rename','pcb.equal_length_group.create','pcb.equal_length_group.add_nets','pcb.equal_length_group.delete'];
const contains=(actual,expected)=>expected&&typeof expected==='object'?actual&&Object.entries(expected).every(([k,v])=>contains(actual[k],v)):String(actual)===String(expected);
function safeName(v){if(typeof v!=='string'||!v.trim()||/['\\\x00-\x1f]/.test(v))bad('Name contains invalid rule-expression characters');return v;}
export function pairComplement(net){const match=/^(.*)([PN+\-])([_\d]*)$/.exec(net);return match?match[1]+({P:'N',N:'P','+':'-','-':'+'}[match[2]])+match[3]:null;}
const condition=nets=>nets.map(n=>`A.NetName == '${safeName(n)}'`).join(' || ');
export async function rulesNative(action,p,dispatch){
  if(action==='pcb.net_class.list')return {...await dispatch('project.netclasses.get',{}),action};
  if(action==='pcb.net_class.create'){
    const name=safeName(required(p,'name')),before=(await call(dispatch,'project.netclasses.get',{})).netClasses??[];
    if(before.some(c=>c.name===name))bad('Netclass already exists');
    const board={};for(const [key,native]of Object.entries({clearanceMm:'clearance',trackWidthMm:'trackWidth',diffPairWidthMm:'diffPairTrackWidth',diffPairGapMm:'diffPairGap',diffPairViaGapMm:'diffPairViaGap'}))if(p[key]!==undefined)board[native]={valueNm:nm(positive(p[key]))};
    const target={name,type:'NCT_EXPLICIT',board,...(p.priority!==undefined?{priority:p.priority}:{})};
    if(p.dryRun)return ok(action,{dryRun:true,applied:false,netClass:target});
    await call(dispatch,'project.netclasses.set',{netClasses:[target],mergeMode:'MMM_MERGE'});
    const back=(await call(dispatch,'project.netclasses.get',{})).netClasses??[];
    if(!back.some(c=>contains(c,target))||before.some(c=>!back.some(v=>v.name===c.name)))throw new DirectError('READBACK_MISMATCH','Netclasses were not preserved');
    return ok(action,{verified:true,netClasses:back,note:'Native class created; assign nets using KiCad net labels or project netclass patterns'});
  }
  const document=required(p,'document'),current=(await call(dispatch,'board.rules.custom.get',{document})).rules??[];
  if(action==='pcb.constraint.list')return ok(action,{rules:current,design:await call(dispatch,'board.rules.get',{document})});
  const diff=action.includes('.differential_pair.'),prefix='KiCadNative:'+(diff?'diff:':'length:'),name=prefix+safeName(required(p,'name')),existing=current.find(r=>r.name===name);let replacement;
  if(action.endsWith('.delete')){if(!existing)bad('Owned native rule not found');}
  else if(action.endsWith('.rename')){
    if(!existing)bad('Owned native rule not found');const newName=prefix+safeName(required(p,'newName'));if(current.some(r=>r.name===newName))bad('Destination rule already exists');replacement={...existing,name:newName};
  }else{
    if(action.endsWith('.create')&&existing)bad('Owned rule already exists');
    let nets=p.nets??(diff?[required(p,'positiveNet'),required(p,'negativeNet')]:undefined);
    if(action.endsWith('.add_nets')){
      if(!existing)bad('Owned group rule not found');const old=[...existing.condition.matchAll(/A\.NetName == '([^']+)'/g)].map(m=>m[1]);nets=[...new Set([...old,...required(p,'nets')])];
    }
    if(!Array.isArray(nets)||nets.length<2||new Set(nets).size!==nets.length)bad('At least two distinct nets are required');nets.forEach(safeName);
    const known=(await call(dispatch,'board.nets.get',{document})).nets??[];for(const net of nets)if(!known.some(n=>n.name===net))bad('Unknown native net: '+net);
    if(diff&&(nets.length!==2||pairComplement(nets[0])!==nets[1]))bad('KiCad derives differential pairs from complementary P/N or +/- net names');
    if(diff&&(p.minGapMm>p.gapMm||p.minWidthMm>p.widthMm))bad('Minimum pair width/gap must not exceed the optimum');
    const constraints=existing?.constraints??(diff?[{type:'CRCT_DIFF_PAIR_GAP',numeric:{opt:nm(positive(p.gapMm)),min:nm(positive(p.minGapMm??p.gapMm))}},{type:'CRCT_TRACK_WIDTH',numeric:{opt:nm(positive(p.widthMm)),min:nm(positive(p.minWidthMm??p.widthMm))}}]:[{type:'CRCT_SKEW',numeric:{max:nm(positive(p.maxSkewMm))}}]);
    replacement={name,condition:condition(nets),constraints};
  }
  const rules=[...current.filter(r=>r.name!==name),...(replacement?[replacement]:[])];
  if(p.dryRun)return ok(action,{dryRun:true,applied:false,rules,derivedPairing:diff});
  await call(dispatch,'board.rules.custom.set',{document,rules});const back=(await call(dispatch,'board.rules.custom.get',{document})).rules??[];
  if(back.length!==rules.length||rules.some(r=>!back.some(v=>contains(v,r))))throw new DirectError('READBACK_MISMATCH','Native rules were not preserved',{readback:back});
  return ok(action,{verified:true,rules:back,note:diff?'This manages native pair constraints; KiCad continues to derive pairing from net names':'Native skew constraint applies across this net group'});
}

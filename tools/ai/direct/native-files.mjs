// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { bad, DirectError, sha256, ok, required, unwrap } from './utils.mjs';
import { parse, head, child, children, value, quote, replace } from './sexpr.mjs';
export { parse, head, child, children, value, quote, replace, randomUUID };
export const raw = (text, node) => text.slice(node.start, node.end);
export const fileOf = p => path.resolve(typeof (p.file ?? p.document ?? p.input) === 'object' ? (p.file ?? p.document ?? p.input).path : required({file:p.file ?? p.document ?? p.input},'file'));
export function nameOf(name) {
  if (typeof name !== 'string' || !name.trim() || /[\x00-\x1f/\\:]/.test(name) || name === '.' || name === '..') bad('name must be a plain nonempty filename');
  return name;
}
export function blankSchematic() { return `(kicad_sch (version 20250114) (generator kicad) (uuid ${randomUUID()}) (paper "A4") (lib_symbols)\n)`; }
export function blankBoard() { return `(kicad_pcb (version 20241229) (generator "pcbnew") (general (thickness 1.6)) (paper "A4") (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (36 "B.SilkS" user "b.silkscreen") (37 "F.SilkS" user "f.silkscreen") (38 "B.Mask" user) (39 "F.Mask" user) (40 "Dwgs.User" user) (47 "F.CrtYd" user) (49 "F.Fab" user) (44 "Edge.Cuts" user)) (setup (pad_to_mask_clearance 0))\n)`; }
export function setNode(text, node, key, expression) {
  const found = child(node,key);
  return replace(text,[found ? {start:found.start,end:found.end,text:expression} : {start:node.end-1,end:node.end-1,text:'\n'+expression+'\n'}]);
}
export function validateNative(file, text) {
  if (/\.(kicad_pro|kicad_prl)$/.test(file)) { JSON.parse(text); return; }
  const root = parse(text), expected = {'.kicad_pcb':'kicad_pcb','.kicad_sch':'kicad_sch','.kicad_mod':'footprint','.kicad_sym':'kicad_symbol_lib'}[path.extname(file)];
  if (expected && head(root) !== expected) bad('Invalid native file root; expected '+expected);
}
export async function openDocuments(dispatch) {
  const docs=[];
  for (const type of ['pcb','schematic']) {
    const r=await dispatch('document.list',{type,timeoutMs:1000});
    if (r.ok) docs.push(...(r.data.documents??[]));
    else if (!['IPC_UNAVAILABLE','NOT_SUPPORTED','UNIMPLEMENTED','UNHANDLED'].includes(r.error?.code)) throw new DirectError('EDITOR_STATE_UNKNOWN','Cannot establish native editor state',r);
  }
  return docs;
}
export function documentFile(d) { return d.path ?? path.join(d.project?.path??'', d.boardFilename ?? ((d.project?.name??'')+'.kicad_sch')); }
export async function guardFiles(files, dispatch) {
  const docs=await openDocuments(dispatch), affected=[];
  for(const d of docs) for(const file of files) {
    if (path.resolve(documentFile(d))===path.resolve(file) || (/\.(kicad_pro|kicad_prl|kicad_dru)$/.test(file)&&path.dirname(path.resolve(file))===path.resolve(d.project?.path??'.')) || (d.type==='DOCTYPE_SCHEMATIC'&&file.endsWith('.kicad_sch')&&path.resolve(file).startsWith(path.resolve(d.project?.path??'.')+path.sep))) affected.push(d);
  }
  if(affected.length) throw new DirectError('DOCUMENT_OPEN','Close the affected native document before changing its source files; live edits use IPC instead',{documents:affected});
}
// Source comparisons prevent stale plans. Every destructive file edit has a recoverable backup.
export async function transaction(action, p, changes, dispatch) {
  const seen=new Set(), plan=changes.map(c=>{
    const file=path.resolve(c.file); if(seen.has(file)) bad('Duplicate transaction path');seen.add(file);
    const before=fs.existsSync(file)?fs.readFileSync(file):null;
    if(before && fs.lstatSync(file).isSymbolicLink()) bad('Refusing to rewrite a symbolic link');
    if(c.exclusive && before) throw new DirectError('FILE_EXISTS','Target already exists: '+file);
    if(c.text!==null) validateNative(file,c.text);
    return {...c,file,before,beforeSha256:before?sha256(before):null,afterSha256:c.text===null?null:sha256(c.text)};
  });
  const summary=plan.map(({file,beforeSha256,afterSha256})=>({file,beforeSha256,afterSha256}));
  if(p.dryRun) return ok(action,{dryRun:true,applied:false,files:summary});
  if(p.expectedSha256 && plan[0].beforeSha256!==p.expectedSha256) throw new DirectError('SOURCE_CHANGED','Expected file hash no longer matches');
  await guardFiles(plan.map(c=>c.file),dispatch);
  const backup=path.join(path.dirname(plan[0].file),'.kicad-native-backups',randomUUID()); fs.mkdirSync(backup,{recursive:true,mode:0o700});
  const applied=[];
  try {
    for(let i=0;i<plan.length;i++){
      const c=plan[i], now=fs.existsSync(c.file)?sha256(fs.readFileSync(c.file)):null;
      if(now!==c.beforeSha256) throw new DirectError('SOURCE_CHANGED','File changed during transaction: '+c.file);
      if(c.before) fs.writeFileSync(path.join(backup,i+'-'+path.basename(c.file)),c.before,{flag:'wx',mode:0o600});
      fs.mkdirSync(path.dirname(c.file),{recursive:true});
      if(c.text===null) fs.unlinkSync(c.file);
      else { const temp=c.file+'.'+randomUUID()+'.tmp'; try {fs.writeFileSync(temp,c.text,{flag:'wx',mode:c.before?fs.statSync(c.file).mode:0o600});fs.renameSync(temp,c.file);}finally{fs.rmSync(temp,{force:true});} }
      applied.push(c);
    }
    for(const c of plan) if((fs.existsSync(c.file)?sha256(fs.readFileSync(c.file)):null)!==c.afterSha256) throw new DirectError('READBACK_MISMATCH','File readback differs: '+c.file);
    fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify(summary,null,2));
    return ok(action,{applied:true,verified:true,backup,files:summary,activation:'Native source persisted; reopen documents to load file changes'});
  } catch(err) {
    for(const c of applied.reverse()){if(c.before)fs.writeFileSync(c.file,c.before);else fs.rmSync(c.file,{force:true});}
    throw new DirectError(err.code??'TRANSACTION_FAILED',err.message,{backup,rolledBack:true});
  }
}
export function walkSheets(file, ancestry=[]) {
  file=path.resolve(file);if(ancestry.includes(file)) bad('Cyclic schematic hierarchy: '+file);
  const text=fs.readFileSync(file,'utf8'),root=parse(text);
  if(head(root)!=='kicad_sch') bad('Expected a KiCad schematic');
  return {file,uuid:value(root,'uuid'),name:path.basename(file),children:children(root,'sheet').map(s=>{
    const properties=children(s,'property'),get=k=>properties.find(x=>x.children[1]?.value===k)?.children[2]?.value;
    const childFile=path.resolve(path.dirname(file),get('Sheetfile')??'');
    const subtree=walkSheets(childFile,[...ancestry,file]);
    return {...subtree,name:get('Sheetname'),sheetId:value(s,'uuid'),parent:file};
  })};
}
export const flattenSheets = tree => [tree,...tree.children.flatMap(flattenSheets)];

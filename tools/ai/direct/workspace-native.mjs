// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { ok, bad, required, DirectError } from './utils.mjs';
import { guardFiles,fileOf,nameOf,blankSchematic,blankBoard,transaction,parse,child,children,value,quote,replace,randomUUID,walkSheets,flattenSheets,openDocuments,documentFile } from './native-files.mjs';
export const workspaceNames=['project.create','schematic.pages.list','schematic.page.open','schematic.page.create','schematic.page.rename','schematic.page.delete','schematic.page.clear','schematic.rename','board.list','board.current','board.create','board.new_pcb','board.rename','board.copy','board.delete','board.rebind'];
export async function workspaceNative(action,p,dispatch){
  if(action==='project.create'){
    const directory=path.resolve(required(p,'directory')),name=nameOf(required(p,'name')),base=path.join(directory,name);
    const changes=[{file:base+'.kicad_pro',text:JSON.stringify({meta:{filename:name+'.kicad_pro',version:1}},null,2),exclusive:true},{file:base+'.kicad_sch',text:blankSchematic(),exclusive:true},{file:base+'.kicad_pcb',text:blankBoard(),exclusive:true}];
    return transaction(action,p,changes,dispatch);
  }
  if(action==='board.list'){
    const directory=path.resolve(p.directory??'.');return ok(action,{boards:fs.readdirSync(directory).filter(x=>x.endsWith('.kicad_pcb')).sort().map(x=>path.join(directory,x))});
  }
  if(action==='board.current'){
    const docs=(await openDocuments(dispatch)).filter(d=>d.type==='DOCTYPE_PCB');if(docs.length!==1)bad('Exactly one open board is required');return ok(action,{document:docs[0],file:documentFile(docs[0])});
  }
  if(['board.create','board.new_pcb'].includes(action)&&!fileOf(p).endsWith('.kicad_pcb'))bad('file must be a .kicad_pcb');
  if(['board.create','board.new_pcb'].includes(action))return transaction(action,p,[{file:fileOf(p),text:blankBoard(),exclusive:true}],dispatch);
  if(action.startsWith('schematic.page')||action==='schematic.pages.list'){
    const file=fileOf(p),tree=walkSheets(file),all=flattenSheets(tree);
    if(action==='schematic.pages.list')return ok(action,{hierarchy:tree,pages:all});
    if(action==='schematic.page.open'){
      const matches=all.filter(s=>p.sheetId?s.sheetId===p.sheetId:p.page?s.file===path.resolve(p.page):p.name?s.name===p.name:s.file===file);
      if(matches.length!==1)bad('Select one native sheet by page path, sheetId or name');
      if(p.dryRun)return ok(action,{dryRun:true,applied:false,root:file,file:matches[0].file});
      let opened=(await openDocuments(dispatch)).find(d=>path.resolve(documentFile(d))===file);
      if(!opened){const result=await dispatch('project.open',{path:file});if(!result.ok)return {...result,action};opened=(await openDocuments(dispatch)).find(d=>path.resolve(documentFile(d))===file);}
      if(!opened)bad('Native root schematic did not open');
      const hierarchy=await dispatch('schematic.hierarchy.get',{document:opened});if(!hierarchy.ok)return {...hierarchy,action};
      const nodes=(hierarchy.data.topLevelSheets??[]).flatMap(function flatten(s){return [s,...(s.children??[]).flatMap(flatten)];});
      const candidates=matches[0].sheetId?nodes.filter(s=>s.path?.path?.at(-1)?.value===matches[0].sheetId):(hierarchy.data.topLevelSheets??[]);
      if(candidates.length!==1)bad('Native hierarchy did not resolve one sheet instance');
      const document={...opened,sheetPath:candidates[0].path},readback=await dispatch('schematic.items.get',{document});
      if(!readback.ok)return {...readback,action};
      return ok(action,{verified:true,document,file:matches[0].file,itemCount:readback.data.items?.length??0,activation:'Native sheet context selected for subsequent IPC requests; GUI viewport navigation is not requested'});
    }
    const text=fs.readFileSync(file,'utf8'),root=parse(text);
    if(action==='schematic.page.create'){
      const name=nameOf(required(p,'name')),target=path.resolve(path.dirname(file),required(p,'page'));
      if(path.extname(target)!=='.kicad_sch')bad('page must end in .kicad_sch');
      const id=randomUUID(),x=p.xMm??30,y=p.yMm??30;
      if(!Number.isFinite(x)||!Number.isFinite(y))bad('Invalid sheet position');
      const node=`(sheet (at ${x} ${y}) (size 25.4 12.7) (stroke (width 0) (type default)) (fill (color 0 0 0 0)) (uuid ${id}) (property "Sheetname" ${quote(name)} (at ${x} ${y-1} 0) (effects (font (size 1.27 1.27)) (justify left bottom))) (property "Sheetfile" ${quote(path.relative(path.dirname(file),target))} (at ${x} ${y+13.7} 0) (effects (font (size 1.27 1.27)) (justify left top))))`;
      return transaction(action,p,[{file,text:replace(text,[{start:root.end-1,end:root.end-1,text:'\n'+node+'\n'}])},{file:target,text:blankSchematic(),exclusive:true}],dispatch);
    }
    if(action==='schematic.page.clear'){
      if(p.confirm!==true)bad('confirm:true required to clear sheet');
      const keep=new Set(['kicad_sch','version','generator','generator_version','uuid','paper','title_block','lib_symbols','sheet_instances','embedded_fonts']);
      return transaction(action,p,[{file,text:replace(text,root.children.filter(n=>n.children&&!keep.has(n.children[0]?.value)).map(n=>({start:n.start,end:n.end,text:''})))}],dispatch);
    }
    const matches=children(root,'sheet').filter(s=>value(s,'uuid')===p.sheetId || children(s,'property').some(n=>n.children[1]?.value==='Sheetname'&&n.children[2]?.value===p.name));
    if(matches.length!==1)bad('Select one child sheet by sheetId or current name');const s=matches[0];
    if(action==='schematic.page.delete'){
      if(p.confirm!==true)bad('confirm:true required');
      // Remove the parent sheet link only. Shared child files remain recoverable and reusable.
      return transaction(action,p,[{file,text:replace(text,[{start:s.start,end:s.end,text:''}])}],dispatch);
    }
    const prop=children(s,'property').find(n=>n.children[1]?.value==='Sheetname');
    return transaction(action,p,[{file,text:replace(text,[{start:prop.children[2].start,end:prop.children[2].end,text:quote(nameOf(required(p,'newName')))}])}],dispatch);
  }
  const file=fileOf(p);if(action.startsWith('board.')&&!file.endsWith('.kicad_pcb')||action==='schematic.rename'&&!file.endsWith('.kicad_sch'))bad('Expected a native document filename');
  if(!p.dryRun&&['board.copy','board.rebind'].includes(action))await guardFiles([file],dispatch);
  const text=fs.readFileSync(file,'utf8');
  if(action==='board.rebind'){
    const target=path.resolve(required(p,'project'));if(!target.endsWith('.kicad_pro'))bad('project must be a .kicad_pro file');
    const destination=target.replace(/\.kicad_pro$/,'.kicad_pcb');
    if(!fs.existsSync(target))bad('Destination native project does not exist');
    return transaction(action,p,[{file:destination,text,exclusive:true}],dispatch);
  }
  if(action==='board.delete'){
    if(p.confirm!==true)bad('confirm:true required');return transaction(action,p,[{file,text:null}],dispatch);
  }
  const extension=path.extname(file),target=p.output?path.resolve(p.output):path.join(path.dirname(file),nameOf(required(p,'newName'))+extension);
  if(path.extname(target)!==extension||target===file)bad('Target must be a distinct file of the same native type');
  if(action==='schematic.rename'){
    // Update an explicitly supplied parent link together with the renamed child file.
    const changes=[{file:target,text,exclusive:true},{file,text:null}];
    if(p.parent){const parent=path.resolve(p.parent),parentText=fs.readFileSync(parent,'utf8'),root=parse(parentText),edits=[];for(const s of children(root,'sheet'))for(const prop of children(s,'property'))if(prop.children[1]?.value==='Sheetfile'&&path.resolve(path.dirname(parent),prop.children[2]?.value??'')===file)edits.push({start:prop.children[2].start,end:prop.children[2].end,text:quote(path.relative(path.dirname(parent),target))});if(!edits.length)bad('Parent does not reference this sheet');changes.unshift({file:parent,text:replace(parentText,edits)});}
    return transaction(action,p,changes,dispatch);
  }
  const changes=[{file:target,text,exclusive:true}];if(action==='board.rename')changes.push({file,text:null});return transaction(action,p,changes,dispatch);
}

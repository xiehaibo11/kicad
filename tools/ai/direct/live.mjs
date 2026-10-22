// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { tempDir, ok, fail } from './utils.mjs';
import { doc, docPath, call } from './board-common.mjs';
import { parse, children, child, values, quote, replace } from './sexpr.mjs';
export function copyLibraryContext(sourceDir, destinationDir) {
  for (const name of ['fp-lib-table','sym-lib-table']) {
    const file=path.join(sourceDir,name);if(!fs.existsSync(file))continue;
    const text=fs.readFileSync(file,'utf8'),edits=[];
    for(const lib of children(parse(text),'lib')) {
      const uri=child(lib,'uri');if(!uri)continue;
      let value=values(uri)[0];if(!value)continue;
      value=value.replaceAll('${KIPRJMOD}',sourceDir);
      if(!/\$\{|^[a-z]+:\/\//i.test(value)&&!path.isAbsolute(value))value=path.resolve(sourceDir,value);
      edits.push({start:uri.start,end:uri.end,text:'(uri '+quote(value)+')'});
    }
    fs.writeFileSync(path.join(destinationDir,name),replace(text,edits),{mode:0o600});
  }
  for(const name of fs.readdirSync(sourceDir).filter(name=>name.endsWith('.kicad_wks')))fs.copyFileSync(path.join(sourceDir,name),path.join(destinationDir,name));
}
export async function liveCopy(p, dispatch, schematic = false) {
  const document = doc(p), source = docPath(document), dir = tempDir('kicad-live-'), copy = path.join(dir, path.basename(source));
  await call(dispatch, 'document.save_copy', { document, path: copy, ...(schematic ? { type: 'schematic' } : {}) });
  if (!fs.existsSync(copy) || !fs.statSync(copy).size) throw Object.assign(new Error('KiCad reported save-copy success but no document was written'), { code: 'LIVE_COPY_FAILED' });
  const stem = source.slice(0, -path.extname(source).length), dest = copy.slice(0, -path.extname(copy).length);
  for (const ext of ['.kicad_pro', '.kicad_dru']) if (fs.existsSync(stem + ext) && !fs.existsSync(dest + ext)) fs.copyFileSync(stem + ext, dest + ext);
  if (!schematic && p.schematicParity && fs.existsSync(stem+'.kicad_sch')) {
    await call(dispatch,'document.save_copy',{document:stem+'.kicad_sch',path:dest+'.kicad_sch',options:{includeProject:false}});
  }
  copyLibraryContext(path.dirname(source),dir);
  return { document, source, copy, dir };
}
export async function liveRules(action, p, dispatch) {
  const schematic = action.startsWith('schematic.'), q = { ...p }; delete q.document;
  if (p.dryRun) return ok(action, { dryRun: true, applied: false, operation: 'Check a temporary copy of the live document' });
  const snapshot = await liveCopy(p, dispatch, schematic);
  const result = await dispatch(schematic ? 'schematic.erc.run' : 'board.drc.run', { ...q, input: snapshot.copy, output: q.output ?? path.join(snapshot.dir, 'report.json'), format: 'json' });
  return { ...result, action, data: { ...result.data, source: 'live', document: snapshot.source, checkedCopy: snapshot.copy } };
}

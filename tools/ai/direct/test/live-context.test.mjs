// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {copyLibraryContext} from '../live.mjs';import {Runtime} from '../runtime.mjs';
test('native snapshot library paths retain source project resolution',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-context-')),source=path.join(dir,'source'),dest=path.join(dir,'copy');fs.mkdirSync(source);fs.mkdirSync(dest);
 const text='(fp_lib_table (lib (name "Local") (uri "${KIPRJMOD}/Parts.pretty")) (lib (name "Relative") (uri "Other.pretty")) (lib (name "Global") (uri "${KICAD10_FOOTPRINT_DIR}/Global.pretty")))';
 try{fs.writeFileSync(path.join(source,'fp-lib-table'),text);copyLibraryContext(source,dest);const copied=fs.readFileSync(path.join(dest,'fp-lib-table'),'utf8');assert.ok(copied.includes(source+'/Parts.pretty'));assert.ok(copied.includes(source+'/Other.pretty'));assert.ok(copied.includes('${KICAD10_FOOTPRINT_DIR}/Global.pretty'));assert.equal(fs.readFileSync(path.join(source,'fp-lib-table'),'utf8'),text);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('removed native formats return explicit alternatives without executing',async()=>{
 const runtime=new Runtime();try{for(const action of ['board.export.hpgl','schematic.export.hpgl']){const r=await runtime.dispatch(action,{});assert.equal(r.error.code,'CAPABILITY_REMOVED');assert.equal(r.data.alternatives.length,4);}}finally{runtime.close();}
});

// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {searchFootprints} from '../library.mjs';import {footprintFile} from '../footprints.mjs';
test('footprint placement and search use the document project table and library nickname',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kn-fp-table-'));
 try{fs.mkdirSync(path.join(root,'Vendor.pretty'));const file=path.join(root,'Vendor.pretty','Test.kicad_mod'),document=path.join(root,'fixture.kicad_pcb');fs.writeFileSync(file,'(footprint "Test" (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu")))');fs.writeFileSync(document,'(kicad_pcb)');
 fs.writeFileSync(path.join(root,'fp-lib-table'),'(fp_lib_table (version 7) (lib (name "ProjectAlias") (type "KiCad") (uri "${KIPRJMOD}/Vendor.pretty") (options "") (descr "")))');
 assert.equal(footprintFile({document,libId:'ProjectAlias:Test'}),fs.realpathSync(file));
 const results=searchFootprints({document,query:'ProjectAlias',library:'ProjectAlias'});assert.equal(results.length,1);assert.equal(results[0].libId,'ProjectAlias:Test');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

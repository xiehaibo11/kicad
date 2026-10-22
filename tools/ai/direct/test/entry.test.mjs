// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const main=fileURLToPath(new URL('../main.mjs',import.meta.url));
test('standalone entry executes through symlink paths including macOS /var aliases',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-entry-test-'));
 try {
  const link=path.join(directory,'native tools.mjs');fs.symlinkSync(main,link);
  const result=JSON.parse(execFileSync(process.execPath,[link,'manifest'],{encoding:'utf8'}));
  assert.equal(result.ok,true);assert.equal(result.data.actionCount,333);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('importing the shared module never runs its command entry',()=>{
 const source=`const direct=await import(${JSON.stringify(pathToFileURL(main).href)});console.log(JSON.stringify({imported:typeof direct.Runtime,tools:direct.toolsList().length}));`;
 const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','--eval',source],{encoding:'utf8',env:{...process.env,KICAD_DIRECT_BUNDLED:'1'}}));
 assert.deepEqual(result,{imported:'function',tools:20});
});

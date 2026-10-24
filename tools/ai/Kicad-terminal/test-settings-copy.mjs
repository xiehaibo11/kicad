import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';

// Load the modules actually shipped into the upstream tree, including relative dependencies.
const source=path.resolve(process.argv[2]||new URL('./cache/Kicad',import.meta.url).pathname);
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'ki-settings-copy-'));
const previous=process.env.KICAD_HISTORY_DIR;
process.env.KICAD_HISTORY_DIR=path.join(tmp,'history');
try{
  const {readSettings,writeMemorySetting}=await import(pathToFileURL(path.join(source,'packages/core/src/kicad/settings.ts')).href);
  const options={home:tmp,managedPath:path.join(tmp,'no-managed-settings')};
  assert.equal(readSettings(tmp,{},options).settings.memory.globalEnabled,true);
  writeMemorySetting('globalEnabled',false);
  assert.equal(readSettings(tmp,{},options).settings.memory.globalEnabled,false);
  writeMemorySetting('projectEnabled',false);
  assert.equal(readSettings(tmp,{},options).settings.memory.projectEnabled,false);
  console.log('Shipped terminal settings passed: relative modules resolve and live memory switches apply.');
}finally{
  if(previous===undefined)delete process.env.KICAD_HISTORY_DIR;else process.env.KICAD_HISTORY_DIR=previous;
  await fs.rm(tmp,{recursive:true,force:true});
}

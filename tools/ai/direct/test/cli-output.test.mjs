// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {KiCadCLI} from '../cli.mjs';import {Runtime} from '../runtime.mjs';
test('CLI file outputs create parents, multi-file outputs create directories, import validates project extension',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kn-output-'));
 try{for(const [action,extra,isDir,suffix] of [['board.export.pdf',{layers:'F.Cu'},false,'.pdf'],['board.export.svg',{layers:'F.Cu'},false,'.svg'],['board.export.svg',{layers:'F.Cu',modeMulti:true},true,''],['board.export.pdf',{layers:'F.Cu',modeSeparate:true},true,''],['project.import',{},false,'.kicad_pro']]){
  const output=path.join(root,action+Object.keys(extra).join(''), 'result'+(action==='project.import'?'.pro':suffix)),actual=action==='project.import'?output.replace(/\.pro$/,'.kicad_pro'):output;
  const cli=new KiCadCLI({run:async()=>{assert.equal(fs.existsSync(actual),isDir);if(isDir)fs.writeFileSync(path.join(actual,'native.svg'),'native');else fs.writeFileSync(actual,'native');return{exitCode:0,stdout:'',stderr:''};}});
  const result=await cli.action(action,{input:'fixture',output,...extra});assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(result.artifacts,[actual]);
 }}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('jobset destination ID survives working directory resolution in direct runtime',async()=>{
 let args;const runtime=new Runtime({cli:new KiCadCLI({run:async(_binary,received)=>{args=received;return{exitCode:0,stdout:'',stderr:''};}}),ipc:{close(){}}});
 try{const result=await runtime.dispatch('project.jobset.run',{input:'fixture.kicad_jobset',output:'acceptance'},{directory:'/tmp/kicad-working-directory'});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(args[args.indexOf('--output')+1],'acceptance');assert.ok(args.includes('/tmp/kicad-working-directory/fixture.kicad_jobset'));assert.equal(result.artifacts,undefined);}finally{runtime.close();}
});

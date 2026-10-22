// SPDX-License-Identifier: GPL-3.0-or-later
// Launches and terminates only its own isolated PCB editor. Requires a desktop session.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {Runtime,listActions} from '../../direct/runtime.mjs';import{blankBoard}from '../../direct/native-files.mjs';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../../../',import.meta.url)).replace(/\/$/,''),dir=fs.mkdtempSync('/tmp/kn-pcb-gui-'),config=path.join(dir,'config/10.99'),document=path.join(dir,'acceptance.kicad_pcb'),socket=path.join(dir,'api.sock');
fs.mkdirSync(config,{recursive:true});for(const name of ['pcbnew','kicad_common']){const data=JSON.parse(fs.readFileSync(repo+'/qa/data/config/10.99/'+name+'.json'));if(name==='kicad_common'){data.api={enable_server:true};data.do_not_show_again={...data.do_not_show_again,update_check_prompt:true,data_collection_prompt:true};}if(name==='pcbnew')data.system={...data.system,first_run_shown:true};fs.writeFileSync(path.join(config,name+'.json'),JSON.stringify(data));}
fs.writeFileSync(path.join(config,'fp-lib-table'),'(fp_lib_table (version 7))');fs.writeFileSync(path.join(config,'sym-lib-table'),'(sym_lib_table (version 7))');fs.writeFileSync(path.join(config,'design-block-lib-table'),'(design_block_lib_table (version 1))');fs.writeFileSync(document,blankBoard());fs.writeFileSync(path.join(dir,'acceptance.kicad_pro'),'{}');
fs.writeFileSync('/tmp/kicad-79-gui-path',dir);console.log({dir,document,socket});
 const pretty=path.join(dir,'Test.pretty');fs.mkdirSync(pretty);fs.writeFileSync(path.join(pretty,'Test.kicad_mod'),'(footprint "Test" (version 20260206) (layer "F.Cu") (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask")))');
 fs.writeFileSync(path.join(config,'fp-lib-table'),`(fp_lib_table (version 7) (lib (name "Test") (type "KiCad") (uri "${pretty}") (options "") (descr "")))`);
 const fpSettings=JSON.parse(fs.readFileSync(repo+'/qa/data/config/10.99/fpedit.json'));fpSettings.system={...fpSettings.system,first_run_shown:true};fs.writeFileSync(path.join(config,'fpedit.json'),JSON.stringify(fpSettings));

const child=spawn(repo+'/build/pcbnew/pcbnew.app/Contents/MacOS/pcbnew',[document],{env:{...process.env,KICAD_CONFIG_HOME:path.join(dir,'config'),KICAD_API_SOCKET:socket,KICAD_RUN_FROM_BUILD_DIR:'1'},stdio:['ignore','pipe','pipe']});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);const runtime=new Runtime({socket}),records=[];
const report=()=>fs.writeFileSync(process.env.KICAD_GUI_TEST_RESULT??'/tmp/kicad-79-gui-result.json',JSON.stringify({dir,records},null,2));
const call=async(action,p={})=>{const result=await runtime.dispatch(action,{...(Object.keys(listActions().find(a=>a.name===action)?.inputSchema??{}).some(k=>['document','board','header'].includes(k))||action==='pcb.view.filter.get'||action==='board.via.create'?{document}:{}),...p});records.push({action,result});report();console.log(action,result.ok?'PASS':JSON.stringify(result.error));assert.equal(result.ok,true,JSON.stringify(result));return result.data;};
try{
 let result;for(let i=0;i<180;i++){result=await runtime.dispatch('pcb.view.filter.get',{document,timeoutMs:1000});if(result.ok)break;await new Promise(r=>setTimeout(r,500));}
 assert.equal(result.ok,true,JSON.stringify(result));await call('pcb.view.filter.get');
 await call('editor.run_action',{action:'common.Control.showFootprintEditor',editor:'pcbnew'});
 let opened;for(let n=0;n<80;n++){opened=await runtime.dispatch('editor.library.open',{type:'DOCTYPE_FOOTPRINT',identifier:{libraryNickname:'Test',entryName:'Test'},timeoutMs:1000});if(opened.ok)break;await new Promise(r=>setTimeout(r,250));}
 records.push({action:'editor.library.open',result:opened});report();assert.equal(opened.ok,true,JSON.stringify(opened));
 const docs=await call('document.list',{type:'DOCTYPE_FOOTPRINT'});assert.ok(docs.documents?.some(d=>d.libId?.entryName==='Test'),JSON.stringify(docs));
 console.log(JSON.stringify({ok:true,footprintLibraryOpened:true,readback:docs}));
}finally{runtime.close();child.kill('SIGTERM');}

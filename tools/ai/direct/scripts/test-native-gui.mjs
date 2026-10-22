// SPDX-License-Identifier: GPL-3.0-or-later
// Launches and terminates only its own isolated PCB editor. Requires a desktop session.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {Runtime,listActions} from '../runtime.mjs';import{blankBoard}from '../native-files.mjs';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../../../',import.meta.url)).replace(/\/$/,''),dir=fs.mkdtempSync('/tmp/kn-pcb-gui-'),config=path.join(dir,'config/10.99'),document=path.join(dir,'acceptance.kicad_pcb'),socket=path.join(dir,'api.sock');
fs.mkdirSync(config,{recursive:true});for(const name of ['pcbnew','kicad_common']){const data=JSON.parse(fs.readFileSync(repo+'/qa/data/config/10.99/'+name+'.json'));if(name==='kicad_common'){data.api={enable_server:true};data.do_not_show_again={...data.do_not_show_again,update_check_prompt:true,data_collection_prompt:true};}if(name==='pcbnew')data.system={...data.system,first_run_shown:true};fs.writeFileSync(path.join(config,name+'.json'),JSON.stringify(data));}
fs.writeFileSync(path.join(config,'fp-lib-table'),'(fp_lib_table (version 7))');fs.writeFileSync(path.join(config,'sym-lib-table'),'(sym_lib_table (version 7))');fs.writeFileSync(path.join(config,'design-block-lib-table'),'(design_block_lib_table (version 1))');fs.writeFileSync(document,blankBoard());fs.writeFileSync(path.join(dir,'acceptance.kicad_pro'),'{}');
fs.writeFileSync('/tmp/kicad-79-gui-path',dir);console.log({dir,document,socket});
const child=spawn(repo+'/build/pcbnew/pcbnew.app/Contents/MacOS/pcbnew',[document],{env:{...process.env,KICAD_CONFIG_HOME:path.join(dir,'config'),KICAD_API_SOCKET:socket,KICAD_RUN_FROM_BUILD_DIR:'1'},stdio:['ignore','pipe','pipe']});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);const runtime=new Runtime({socket}),records=[];
const report=()=>fs.writeFileSync(process.env.KICAD_GUI_TEST_RESULT??'/tmp/kicad-79-gui-result.json',JSON.stringify({dir,records},null,2));
const call=async(action,p={})=>{const result=await runtime.dispatch(action,{...(Object.keys(listActions().find(a=>a.name===action)?.inputSchema??{}).some(k=>['document','board','header'].includes(k))||action==='pcb.view.filter.get'||action==='board.via.create'?{document}:{}),...p});records.push({action,result});report();console.log(action,result.ok?'PASS':JSON.stringify(result.error));assert.equal(result.ok,true,JSON.stringify(result));return result.data;};
try{
 let result;for(let i=0;i<180;i++){result=await runtime.dispatch('pcb.view.filter.get',{document,timeoutMs:1000});if(result.ok)break;await new Promise(r=>setTimeout(r,500));}
 assert.equal(result.ok,true,JSON.stringify(result));await call('pcb.view.filter.get');
 const created=await call('board.via.create',{position:{xMm:10,yMm:12}}),ids=created.createdIds;
 assert.ok(ids?.length);await call('editor.selection.clear');await call('editor.selection.add',{ids});
 const selection=await call('editor.selection.get');assert.ok(selection.items?.length,'selected native via must be read back');
 const exported=await call('editor.selection.export');assert.ok(exported.contents?.includes('via'));
 await call('editor.selection.remove',{ids});const empty=await call('editor.selection.get');assert.equal(empty.items.length,0);
 await call('editor.selection.sync',{context:'SSC_EXPLICIT',mode:'SSM_ITEMS_ONLY',items:[]});
 await call('editor.nets.highlight',{netName:[]});
 const visible=await call('board.layers.visible.get');await call('board.layers.visible.set',{layers:['BL_F_Cu','BL_Edge_Cuts']});
 const changed=await call('board.layers.visible.get');assert.deepEqual([...changed.layers].sort(),['BL_Edge_Cuts','BL_F_Cu']);await call('board.layers.visible.set',{layers:visible.layers.filter(l=>l!=='BL_UNKNOWN')});
 const active=await call('board.layers.active.get');await call('board.layers.active.set',{layer:'BL_B_Cu'});assert.equal((await call('board.layers.active.get')).layer,'BL_B_Cu');await call('board.layers.active.set',{layer:active.layer});
 const appearance=await call('board.appearance.get');await call('board.appearance.set',{settings:appearance.settings??appearance});
 assert.deepEqual(await call('board.appearance.get'),appearance);
 await call('editor.run_action',{action:'common.Control.zoomFitScreen',editor:'pcbnew'});
 // Native interactive move is asynchronous; cancel it by terminating this isolated editor only.
 await call('board.move.interactive',{items:ids});
 if(process.env.KICAD_WORKFLOW_EVIDENCE)fs.appendFileSync(process.env.KICAD_WORKFLOW_EVIDENCE,JSON.stringify({action:'pcb.view.filter.get',ok:true,mode:'native-gui-ipc'})+'\n');
 console.log(JSON.stringify({executed:records.length,successful:records.filter(r=>r.result.ok).length,selectionReadback:true,layerRoundtrip:true,appearanceRoundtrip:true}));
}finally{runtime.close();child.kill('SIGTERM');}

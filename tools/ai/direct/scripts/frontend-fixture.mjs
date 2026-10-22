// SPDX-License-Identifier: GPL-3.0-or-later
// Real native documents shared by chat/terminal acceptance. No user files/keys.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Runtime} from '../runtime.mjs';
export async function frontendFixture(binary, options={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-tools-acceptance-'));
  const document=path.join(root,'fixture.kicad_pcb'),schematic=path.join(root,'fixture.kicad_sch'),socket=path.join(root,'api.sock');
  fs.copyFileSync(new URL('../../../../qa/data/pcbnew/drc_courtyard/overlap/empty_board.kicad_pcb',import.meta.url),document);
  if(options.boardSource)fs.writeFileSync(document,options.boardSource);
  fs.writeFileSync(path.join(root,'fixture.kicad_pro'),'{}');
  const library=new URL('../../../../qa/data/libraries/Device.kicad_sym',import.meta.url).pathname;
  fs.writeFileSync(path.join(root,'sym-lib-table'),`(sym_lib_table (version 7) (lib (name "Device") (type "KiCad") (uri "${library}") (options "") (descr "")))`);
  const spec=path.join(root,'spec.json');fs.writeFileSync(spec,JSON.stringify({modules:[{name:'Power',kind:'POWER'}]}));
  const gerber=path.join(root,'fixture.gbr');
  fs.writeFileSync(gerber,'G04 KiCad direct tool test*\n%FSLAX46Y46*%\n%MOMM*%\n%ADD10C,1.000000*%\nD10*\nX10000000Y10000000D03*\nM02*\n');
  const env={...process.env,KICAD_CLI:binary,KICAD_API_SOCKET:socket,KICAD_RUN_FROM_BUILD_DIR:'1',KICAD_CONFIG_HOME:path.join(root,'kicad-config')};
  const child=spawn(binary,['api-server','--socket',socket,document],{env,stdio:['ignore','pipe','pipe']});let log='';
  child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  const runtime=new Runtime({binary,socket});
  const check=async(action,p={})=>{const result=await runtime.dispatch(action,p);assert.equal(result.ok,true,JSON.stringify(result)+'\n'+log);return result.data;};
  async function close(){runtime.close();child.kill('SIGTERM');if(child.exitCode===null)await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL');fs.rmSync(root,{recursive:true,force:true});}
  try {
    for(let n=0;n<100;n++){const ping=await runtime.dispatch('system.ping',{timeoutMs:500});if(ping.ok)break;if(child.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}
    await check('schematic.generate',{document:schematic,project:root,new:true,noErc:true,spec:{components:[{reference:'R1',libId:'Device:R',position:{xMm:50,yMm:50}}],nets:[{name:'SIGNAL',pins:['R1.1']}]}});
    const cases=[
      ['kicad_health',{}],['kicad_actions',{search:'board.via.create'}],
      ['kicad_call',{action:'board.via.create',payload:{document,position:{xMm:10,yMm:12},diameterMm:0.6,drillMm:0.3}}],
      ['kicad_spec_validate',{file:spec}],['kicad_blocks',{operation:'show',id:'block.ams1117_ldo_3v3'}],
      ['kicad_workflow',{operation:'init',project:root}],['kicad_pipeline',{operation:'run',project:root,stages:['health']}],
      ['kicad_native_tools',{operation:'list',editor:'pcbnew',limit:2}],
      ['kicad_system',{action:'system.ping'}],['kicad_project',{action:'project.info',payload:{project:root}}],
      ['kicad_document',{action:'document.list'}],
      ['kicad_schematic',{action:'schematic.export.netlist',payload:{input:schematic,output:path.join(root,'frontend.net')}}],
      ['kicad_board',{action:'board.items.get',payload:{document,types:['via']}}],
      ['kicad_library',{action:'library.list',payload:{project:root}}],['kicad_external',{action:'external.tools.list'}],
      ['kicad_editor',{action:'editor.native.categories'}],['kicad_reference',{action:'reference.plan',payload:{query:'schematic power'}}],
      ['kicad_audit',{action:'audit.rules'}],['kicad_web',{action:'web.fetch',payload:{url:'https://1.1.1.1/cdn-cgi/trace',timeoutMs:20000}}],
      ['kicad_gerber',{action:'gerber.info',payload:{input:gerber,format:'json'}}],
    ].map(([name,args])=>({name,args}));
    return {root,env,runtime,cases,close,async verify(){
      const vias=await check('board.items.get',{document,types:['via']});assert.equal(vias.items.length,1,'frontend mutation must reach native editor');
      assert.match(fs.readFileSync(path.join(root,'frontend.net'),'utf8'),/SIGNAL/);
      assert.ok(fs.existsSync(path.join(root,'.kicad-agent/workflow.json')));
      assert.ok(fs.existsSync(path.join(root,'.kicad-agent/pipeline-report.json')));
      return {nativeViaCount:vias.items.length,schematicNetlistReadback:true,workflowPersisted:true,pipelinePersisted:true};
    }};
  }catch(error){await close();throw error;}
}

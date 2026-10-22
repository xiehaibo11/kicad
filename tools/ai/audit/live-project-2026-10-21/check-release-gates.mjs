import fs from 'node:fs';import path from 'node:path';import {Runtime} from '../../direct/dist/kicad-direct.mjs';
const out=path.dirname(new URL(import.meta.url).pathname),stem=path.resolve('projects/RK3308B_IPC 摄像头模块/RK3308B_IPC 摄像头模块'),runtime=new Runtime({binary:path.resolve('build/kicad/KiCad.app/Contents/MacOS/kicad-cli')});
try{for(const [action,p]of [['audit.run',{board:stem+'.kicad_pcb',output:path.join(out,'actual-design-audit.json')}],['release.check',{project:stem+'.kicad_pro',output:path.join(out,'actual-release-check.json')}]] ){
 const r=await runtime.dispatch(action,p,{timeoutMs:120000});fs.writeFileSync(path.join(out,action+'-result.json'),JSON.stringify(r,null,2));console.log(JSON.stringify({action,ok:r.ok,error:r.error,pendingEvidence:r.data?.pendingEvidence?.length}));
}}finally{runtime.close();}

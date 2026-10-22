// SPDX-License-Identifier: GPL-3.0-or-later
// Test preload: coverage from actual native test dispatches, not mocked inputs.
import fs from 'node:fs';
import {Runtime} from '../runtime.mjs';
const dispatch=Runtime.prototype.dispatch;
Runtime.prototype.dispatch=async function(action,payload,options){
 const result=await dispatch.call(this,action,payload,options);
 if(process.env.KICAD_NATIVE_TRACE)fs.appendFileSync(process.env.KICAD_NATIVE_TRACE,JSON.stringify({action,ok:result.ok,error:result.error?.code,nativeIPC:this.ipc.constructor.name==='KiCadIPC',nativeCLI:this.cli.constructor.name==='KiCadCLI'})+'\n');
 return result;
};

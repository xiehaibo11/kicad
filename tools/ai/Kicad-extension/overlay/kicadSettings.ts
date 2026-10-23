import * as vscode from 'vscode';
import {parse,ParseError} from 'jsonc-parser';
import {readSettings} from './shared/kicadSettings';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function claudeSettingsArgument(attribution:boolean){
  const file=path.join(os.homedir(),'.claude/claudix.json');
  if(attribution)return file;
  let saved:Record<string,unknown>={};
  try{
    const errors:ParseError[]=[];saved=parse(fs.readFileSync(file,'utf8'),errors,{allowTrailingComma:true});
    if(errors.length||!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('Invalid Claude settings: '+file);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  return JSON.stringify({...saved,includeCoAuthoredBy:false,attribution:{commit:'',pr:''}});
}
export function agentSettings(cwd=process.cwd()){
  const cfg=vscode.workspace.getConfiguration('kicadAgent',vscode.Uri.file(cwd));
  const overrides:Record<string,unknown>={};
  for(const key of ['autoMode','deniedModels','maxEffortLevel','modelSettings','maxProseWidth','commitAttribution','mcpVerification','autoModeSuggestions']){
    // Only explicit host settings override shared settings files, not VS Code schema defaults.
    const setting=cfg.inspect?.(key);
    const value=setting?.workspaceFolderValue??setting?.workspaceValue??setting?.globalValue;
    if(value!==undefined)overrides[key]=value;
  }
  return readSettings(cwd,overrides,{parse(raw){const errors:ParseError[]=[];const value=parse(raw,errors,{allowTrailingComma:true});if(errors.length)throw Error('Invalid JSONC');return value;}});
}

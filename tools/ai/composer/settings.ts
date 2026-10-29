// Shared host policy. Settings are data; loading them never starts a tool or model.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {historyRoot} from './history.ts';

const MEMORY_KEYS=['globalEnabled','projectEnabled','autoLearn'];
// One atomic file per switch avoids lost updates between editor processes.
export function writeMemorySetting(key:string,enabled:boolean){
  if(!MEMORY_KEYS.includes(key)||typeof enabled!=='boolean')throw Error('Invalid memory setting.');
  const directory=path.join(historyRoot(),'memory-policy'),file=path.join(directory,key+'.json'),tmp=file+'.'+randomUUID()+'.tmp';
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  try{fs.writeFileSync(tmp,JSON.stringify({memory:{[key]:enabled}})+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}finally{fs.rmSync(tmp,{force:true});}
}

export const EFFORT_LEVELS = ['off','minimal','low','medium','high','xhigh','max','ultra'];
export interface AgentSettings {
  autoMode: boolean;
  deniedModels: string[];
  maxEffortLevel?: string;
  modelSettings: Record<string,{maxEffortLevel?:string}>;
  maxProseWidth: number;
  commitAttribution: boolean;
  mcpVerification: boolean;
  autoModeSuggestions: boolean;
  memory: {globalEnabled:boolean;projectEnabled:boolean;autoLearn:boolean};
}
export type SettingsLayer = {source:string;value:Record<string,any>;managed?:boolean};
const list = (value:unknown):string[] => Array.isArray(value) ? value.filter((v):v is string=>typeof v==='string'&&!!v.trim()).map(v=>v.trim()) : [];
const effort = (value:unknown) => typeof value==='string'&&EFFORT_LEVELS.includes(value) ? value : undefined;
const lower = (a?:string,b?:string) => !a?b:!b?a:EFFORT_LEVELS.indexOf(a)<EFFORT_LEVELS.indexOf(b)?a:b;

export function resolveSettings(layers:SettingsLayer[]):AgentSettings {
  const ordered=[...layers.filter(l=>!l.managed),...layers.filter(l=>l.managed)];
  const merged=Object.assign({},...ordered.map(l=>l.value));
  const memory=Object.assign({globalEnabled:true,projectEnabled:true,autoLearn:true},...ordered.map(l=>l.value.memory||{}));
  // A narrower scope cannot remove a model denial or raise an effort ceiling.
  const deniedModels=[...new Set(ordered.flatMap(l=>list(l.value.deniedModels)))];
  const modelSettings:AgentSettings['modelSettings']=Object.create(null);
  let maxEffortLevel:string|undefined;
  for(const {value} of ordered){
    maxEffortLevel=lower(maxEffortLevel,effort(value.maxEffortLevel));
    for(const [id,entry] of Object.entries(value.modelSettings||{})){
      const cap=effort((entry as any)?.maxEffortLevel);
      if(cap)modelSettings[id]={maxEffortLevel:lower(modelSettings[id]?.maxEffortLevel,cap)};
    }
  }
  return {autoMode:merged.autoMode!==false,deniedModels,maxEffortLevel,modelSettings,
    maxProseWidth:Number.isInteger(merged.maxProseWidth)&&merged.maxProseWidth>=0?merged.maxProseWidth:100,
    commitAttribution:merged.commitAttribution!==false,mcpVerification:merged.mcpVerification!==false,
    autoModeSuggestions:merged.autoModeSuggestions!==false,memory};
}
export function readSettings(cwd:string,overrides:Record<string,any>={},options:{home?:string;managedPath?:string;parse?:(s:string)=>any}={}){
  const home=options.home||os.homedir();
  const managed=options.managedPath||process.env.KICAD_MANAGED_SETTINGS||
    (process.platform==='darwin'?'/Library/Application Support/KicadAgent/managed-settings.json':'/etc/kicad-agent/managed-settings.json');
  const layers:SettingsLayer[]=[];
  for(const [source,isManaged] of [[path.join(home,'.config/kicad/settings.json'),false],
    [path.join(cwd,'.kicad/settings.json'),false],[path.join(cwd,'.kicad/settings.local.json'),false]] as const){
    load(source,isManaged);
  }
  for(const key of MEMORY_KEYS)load(path.join(historyRoot(),'memory-policy',key+'.json'),false);
  layers.push({source:'host settings',value:overrides});load(managed,true);
  return {settings:resolveSettings(layers),sources:layers.map(({source,managed})=>({source,managed:!!managed}))};
  function load(source:string,managed:boolean){
    let raw:string;try{raw=fs.readFileSync(source,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw Error('Cannot read agent settings: '+source);}
    try{
      const value=(options.parse||JSON.parse)(raw);
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
      if(value.deniedModels!==undefined&&(!Array.isArray(value.deniedModels)||value.deniedModels.some((v:unknown)=>typeof v!=='string'||!v.trim())))throw Error();
      if(value.maxEffortLevel!==undefined&&!effort(value.maxEffortLevel))throw Error();
      for(const key of ['autoMode','commitAttribution','mcpVerification','autoModeSuggestions'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw Error();
      if(value.maxProseWidth!==undefined&&(!Number.isInteger(value.maxProseWidth)||value.maxProseWidth<0))throw Error();
      if(value.memory!==undefined&&(!value.memory||typeof value.memory!=='object'||Array.isArray(value.memory)||Object.entries(value.memory).some(([key,v])=>!['globalEnabled','projectEnabled','autoLearn'].includes(key)||typeof v!=='boolean')))throw Error();
      if(value.modelSettings!==undefined){
        if(!value.modelSettings||typeof value.modelSettings!=='object'||Array.isArray(value.modelSettings))throw Error();
        for(const entry of Object.values(value.modelSettings))if(!entry||typeof entry!=='object'||(entry as any).maxEffortLevel!==undefined&&!effort((entry as any).maxEffortLevel))throw Error();
      }
      layers.push({source,value,managed});
    }catch{throw Error('Invalid agent settings: '+source+' (expected an object with valid policy values)');}
  }
}
function matches(pattern:string,value:string){
  const escaped=pattern.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*');
  return new RegExp('^'+escaped+'$','i').test(value);
}
export function assertModelAllowed(settings:AgentSettings,model:string|null|undefined){
  const id=model||'default',bare=id.replace(/^codex:/,'');
  if(settings.deniedModels.length&&/^(default|best|fable|opus|sonnet|haiku|opusplan)(\[1m\])?$/i.test(bare))throw Error('Choose a concrete model ID while deniedModels is configured; an unresolved alias cannot be checked: '+id);
  if(settings.deniedModels.some(pattern=>matches(pattern,id)||matches(pattern,bare)))throw Error('Model blocked by deniedModels: '+id);
}
export function capEffort(settings:AgentSettings,model:string,level:string,available:string[]){
  let cap=settings.maxEffortLevel;
  for(const [pattern,value] of Object.entries(settings.modelSettings))if(matches(pattern,model)||matches(pattern,model.replace(/^codex:/,'')))cap=lower(cap,value.maxEffortLevel);
  if(!cap)return level;
  const choices=EFFORT_LEVELS.filter(v=>available.includes(v)&&EFFORT_LEVELS.indexOf(v)<=EFFORT_LEVELS.indexOf(cap));
  if(!choices.length)throw Error('No supported reasoning effort fits maxEffortLevel for '+model);
  // Auto must also honor the cap; an unset provider default could exceed it.
  return level==='default_on'||!EFFORT_LEVELS.includes(level)||EFFORT_LEVELS.indexOf(level)>EFFORT_LEVELS.indexOf(cap)?choices.at(-1)!:level;
}

import * as vscode from 'vscode';
import {createDemandCatalog,kicadToolSettings} from './kicadRuntime';
import type {LocalSlashRequest,LocalSlashResponse,SlashCatalogRequest,SlashCatalogResponse} from './shared/kicadSlash';

export async function slashCatalog(request:SlashCatalogRequest,cwd:string,signal:AbortSignal):Promise<SlashCatalogResponse> {
  if(!['tool','skill'].includes(request.kind))throw Error('Invalid catalog kind');
  if(signal.aborted)throw Error('Cancelled');
  const settings=kicadToolSettings(cwd);
  // Metadata browsing never needs external servers. Native skills can also be
  // browsed here; an explicit off setting and disabled names still take precedence.
  const catalog=createDemandCatalog(cwd,{},[],[],10,{...settings,skillsMode:settings.skillsMode==='off'?'off':'onDemand'});
  catalog.setSkillRoots(settings.skillRoots);
  try {
    const result=await catalog.search({kind:request.kind,query:request.query,offset:request.offset});
    if(signal.aborted)throw Error('Cancelled');
    return {type:'slash_catalog_response',results:result.results.map(item=>({id:item.id,name:item.name,description:item.description||''})),nextOffset:result.nextOffset,total:result.total};
  } finally {await catalog.close();}
}
export async function localSlash(request:LocalSlashRequest,cwd:string,servers:Record<string,any>):Promise<LocalSlashResponse> {
  switch(request.action){
    case 'settings':await vscode.commands.executeCommand('kicad.openSettings');break;
    case 'doctor':await vscode.commands.executeCommand('kicadAgent.promptAudit');break;
    case 'mcp':{
      const settings=kicadToolSettings(cwd);
      // Omit command lines, environment, headers and URLs: these may contain secrets.
      const report={mode:settings.mcpMode,servers:Object.keys(servers).filter(name=>!['kicad','easyeda'].includes(name)).map(name=>({name,enabled:settings.mcpMode!=='off'&&!settings.disabledServers.includes(name)&&!servers[name]?.disabled})),note:'Configuration only. No server was started or contacted.'};
      const doc=await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify(report,null,2)});
      await vscode.window.showTextDocument(doc,{preview:true,preserveFocus:true});break;
    }
    default:throw Error('Unsupported local command');
  }
  return {type:'local_slash_response'};
}

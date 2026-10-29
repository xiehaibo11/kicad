import * as vscode from 'vscode';
import {MemoryStore,memoryInventory,type MemoryScope} from './shared/kicadMemory';
import {agentSettings} from './kicadSettings';
import {writeMemorySetting} from './shared/kicadSettings';

function workspace(){return (vscode.window.activeTextEditor&&vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)||vscode.workspace.workspaceFolders?.[0])?.uri.fsPath;}
const keys=['globalEnabled','projectEnabled','autoLearn'];
export async function memoryStatus(){
  const cwd=workspace(),cfg=vscode.workspace.getConfiguration('kicadAgent');
  const missingSettings=keys.filter(key=>cfg.inspect('memory.'+key)?.defaultValue===undefined);
  return {settings:agentSettings(cwd).settings.memory,stores:await memoryInventory(cwd),hasWorkspace:!!cwd,reloadRequired:missingSettings.length>0};
}
export async function memoryAction(action:string,value:any={}){
  const cwd=workspace(),cfg=vscode.workspace.getConfiguration('kicadAgent');
  if(action==='setting'){
    if(!keys.includes(value.key)||typeof value.enabled!=='boolean')throw Error('Invalid memory setting.');
    if(cfg.inspect('memory.'+value.key)?.defaultValue===undefined)throw Error('Reload this window to register the installed memory settings, then retry.');
    await cfg.update('memory.'+value.key,value.enabled,vscode.ConfigurationTarget.Global);
    writeMemorySetting(value.key,value.enabled);
    return {status:await memoryStatus()};
  }
  if(action==='reload'){await vscode.commands.executeCommand('workbench.action.reloadWindow');return {status:await memoryStatus()};}
  // Only store IDs from our inventory are accepted. A webview cannot supply a filesystem path.
  const target=(await memoryInventory(cwd)).find(s=>s.id===value.store);
  if(!target)throw Error('Memory store no longer exists. Refresh the list.');
  const scope=target.scope as MemoryScope,store=new MemoryStore(target.cwd||cwd||process.cwd(),()=>agentSettings(cwd).settings.memory,'settings');
  if(action==='list')return {records:await store.operate({operation:'list',scope,query:value.query,offset:value.offset,limit:50},'user')};
  if(action==='save'){
    await store.operate({operation:value.id?'replace':'append',scope,id:value.id,text:value.text,version:value.version,kind:value.kind},'user');
  }else if(action==='delete'){
    await store.operate({operation:'delete',scope,id:value.id,version:value.version},'user');
  }else if(action==='clear'){
    const confirmed=await vscode.window.showWarningMessage('Delete all memories in '+target.label+'?',{modal:true,detail:'This removes saved entries and pending usage signals. Conversation history is kept separately.'},'Delete Memories');
    if(confirmed==='Delete Memories')await store.clear(scope);
  }else if(action==='export'){
    const document=await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify({schemaVersion:2,scope,project:target.cwd||undefined,memories:await store.entries(scope)},null,2)});
    await vscode.window.showTextDocument(document,{preview:true,preserveFocus:true});
  }else throw Error('Unknown memory action.');
  return {status:await memoryStatus()};
}
export function registerMemorySettings(context:vscode.ExtensionContext){
  const sync=()=>{
    const cfg=vscode.workspace.getConfiguration('kicadAgent');
    for(const key of keys){const value=cfg.inspect<boolean>('memory.'+key)?.globalValue;if(value!==undefined)writeMemorySetting(key,value);}
  };
  // Explicit settings.json edits also apply to already-running terminal sessions.
  try{sync();}catch(error){console.warn('[Kicad Memory]',String(error));}
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event=>{if(event.affectsConfiguration('kicadAgent.memory')){try{sync();}catch(error){console.warn('[Kicad Memory]',String(error));}}}));
}

import fs from 'node:fs';
import path from 'node:path';
export function applyMemory(root,overlay){
  function patch(file,before,after){const target=path.join(root,file),text=fs.readFileSync(target,'utf8');if(text.split(before).length!==2)throw Error('Memory anchor missing/ambiguous: '+file+' '+before.slice(0,80));fs.writeFileSync(target,text.replace(before,()=>after));}
  fs.writeFileSync(path.join(root,'src/shared/kicadMemory.ts'),fs.readFileSync(path.join(overlay,'../../composer/memory.ts'),'utf8').replace("from './history.ts'","from './kicadHistory'").replace("from './intent.ts'","from './kicadIntent'").replace("from './settings.ts'","from './kicadSettings'"));
  // The helper is also re-exported for existing Context7 consumers.
  const local=path.join(root,'src/shared/kicadLocalTools.ts');fs.writeFileSync(local,fs.readFileSync(local,'utf8').replaceAll("from './memory.ts'","from './kicadMemory'"));
  patch('src/webview/src/pages/SettingsPage.vue',"label: 'Memory and Rules'","label: 'Rules and Agents'");
  patch('src/webview/src/components/settings/tabs/SettingsTabMemoryAndRules.vue','title="Memory and Rules"','title="Rules and Agents"');
  fs.copyFileSync(path.join(overlay,'kicadMemory.ts'),path.join(root,'src/kicadMemory.ts'));
  fs.copyFileSync(path.join(overlay,'settings/SettingsTabMemory.vue'),path.join(root,'src/webview/src/components/settings/tabs/SettingsTabMemory.vue'));
  patch('src/services/claude/ClaudeSdkService.ts','continuity.configure(kicadSession.settings);','continuity.configure({...kicadSession.settings,memorySettings:()=>agentSettings(cwdParam).settings.memory});');
  patch('src/kicadCodex.ts','continuity.configure(settings);','continuity.configure({...settings,memorySettings:()=>agentSettings(params.cwd).settings.memory});');
  const file=path.join(root,'package.json'),pkg=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const [key,description] of Object.entries({globalEnabled:'Read and update local personal memories across projects.',projectEnabled:'Read and update local memories isolated by project.',autoLearn:'Learn explicit preferences and repeated low-risk presentation habits from genuine user messages. No transcript import or model training.'}))pkg.contributes.configuration.properties['kicadAgent.memory.'+key]={type:'boolean',default:true,scope:'application',description};
  fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');
  patch('src/extension.ts',"import * as vscode from 'vscode';","import * as vscode from 'vscode';\nimport {registerMemorySettings} from './kicadMemory';");
  patch('src/extension.ts','export function activate(context: vscode.ExtensionContext) {','export function activate(context: vscode.ExtensionContext) {\n  registerMemorySettings(context);');
  patch('src/services/claude/ClaudeAgentService.ts','            case "open_config_file":',`            case "kicad_memory_status":
                return {type:'kicad_memory_status_response',status:await (await import('../../kicadMemory')).memoryStatus()};
            case "kicad_memory_action":
                return {type:'kicad_memory_action_response',...await (await import('../../kicadMemory')).memoryAction((request as any).action,(request as any).value)};
            case "open_config_file":`);
  patch('src/webview/src/transport/BaseTransport.ts','  protected async sendRequest<TResponse = any>(',`  kicadMemoryStatus(): Promise<any> { return this.sendRequest({type:'kicad_memory_status'} as any); }
  kicadMemoryAction(action:string,value?:any): Promise<any> { return this.sendRequest({type:'kicad_memory_action',action,value} as any); }

  protected async sendRequest<TResponse = any>(`);
  patch('src/webview/src/pages/SettingsPage.vue',"import SettingsTabMCPServers from '../components/settings/tabs/SettingsTabMCPServers.vue';","import SettingsTabMCPServers from '../components/settings/tabs/SettingsTabMCPServers.vue';\nimport SettingsTabMemory from '../components/settings/tabs/SettingsTabMemory.vue';");
  patch('src/webview/src/pages/SettingsPage.vue',"  { id: 'mcp-servers', label: 'MCP Servers', icon: 'codicon-cube-nodes' },","  { id: 'memory', label: 'Memory', icon: 'codicon-book' },\n  { id: 'mcp-servers', label: 'MCP Servers', icon: 'codicon-cube-nodes' },");
  patch('src/webview/src/pages/SettingsPage.vue',"    case 'mcp-servers':","    case 'memory':\n      return SettingsTabMemory;\n    case 'mcp-servers':");
}

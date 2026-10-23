import fs from 'node:fs';
import path from 'node:path';
export function applyComputerUse(root,overlay){
  function patch(file,before,after){const target=path.join(root,file),s=fs.readFileSync(target,'utf8');if(s.split(before).length!==2)throw Error('Computer control anchor missing/ambiguous: '+file+' '+before.slice(0,80));fs.writeFileSync(target,s.replace(before,()=>after));}
  for(const [source,target] of [['computer-use.ts','kicadComputerUse.ts'],['tool-result.ts','kicadToolResult.ts']])fs.copyFileSync(path.join(overlay,'../../composer',source),path.join(root,'src/shared',target));
  fs.copyFileSync(path.join(overlay,'kicadComputerUse.ts'),path.join(root,'src/kicadComputerUse.ts'));
  fs.copyFileSync(path.join(overlay,'settings/SettingsTabComputer.vue'),path.join(root,'src/webview/src/components/settings/tabs/SettingsTabComputer.vue'));
  const file=path.join(root,'package.json'),pkg=JSON.parse(fs.readFileSync(file,'utf8'));
  pkg.activationEvents=Array.from(new Set([...pkg.activationEvents,'onStartupFinished']));
  Object.assign(pkg.contributes.configuration.properties,{
    'kicadAgent.computer.enabled':{type:'boolean',default:false,scope:'application',markdownDescription:'Enable Cua Driver computer control. Starts a private signed macOS background service, supervised by launchd across conversations and editor restarts. Off immediately disconnects tools and removes this service. Does not start agents or capture screens by itself.'},
    'kicadAgent.computer.driverPath':{type:'string',default:'',scope:'application',description:'Installed Cua Driver executable. Empty searches PATH and ~/.local/bin. On macOS use the signed CuaDriver.app installation (tested with 0.38.0).'},
    'kicadAgent.computer.anyApp':{type:'boolean',default:false,scope:'application',description:'Allow Cua native screen control of any application. Otherwise only the bundle IDs in computer.allowedApps are accessible. Browser extensions and spreadsheet add-ins are separate integrations.'},
    'kicadAgent.computer.allowedApps':{type:'array',items:{type:'string'},uniqueItems:true,default:['org.kicad.kicad','org.kicad.pcbnew','org.kicad.eeschema'],scope:'application',description:'Application bundle IDs allowed for Cua native screen control. KiCad only by default. Checked again at every observation and input call.'}
  });
  fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');
  patch('src/extension.ts',"import * as vscode from 'vscode';","import * as vscode from 'vscode';\nimport {registerComputerControl} from './kicadComputerUse';");
  patch('src/extension.ts','export function activate(context: vscode.ExtensionContext) {','export function activate(context: vscode.ExtensionContext) {\n  registerComputerControl(context);');
  patch('src/services/claude/ClaudeAgentService.ts','            case "open_config_file":',`            case "kicad_computer_status":
                return {type:'kicad_computer_status_response',status:await (await import('../../kicadComputerUse')).computerStatus()};
            case "kicad_computer_setting":
                return {type:'kicad_computer_setting_response',status:await (await import('../../kicadComputerUse')).computerSetting((request as any).action,(request as any).value)};
            case "open_config_file":`);
  patch('src/webview/src/transport/BaseTransport.ts','  protected async sendRequest<TResponse = any>(',`  kicadComputerStatus(): Promise<any> { return this.sendRequest({type:'kicad_computer_status'} as any); }
  kicadComputerSetting(action:string,value?:any): Promise<any> { return this.sendRequest({type:'kicad_computer_setting',action,value} as any); }

  protected async sendRequest<TResponse = any>(`);
  patch('src/webview/src/pages/SettingsPage.vue',"import SettingsTabMCPServers from '../components/settings/tabs/SettingsTabMCPServers.vue';","import SettingsTabMCPServers from '../components/settings/tabs/SettingsTabMCPServers.vue';\nimport SettingsTabComputer from '../components/settings/tabs/SettingsTabComputer.vue';");
  patch('src/webview/src/pages/SettingsPage.vue',"  { id: 'mcp-servers', label: 'MCP Servers', icon: 'codicon-cube-nodes' },","  { id: 'mcp-servers', label: 'MCP Servers', icon: 'codicon-cube-nodes' },\n  { id: 'computer', label: 'Computer Control', icon: 'codicon-device-desktop' },");
  patch('src/webview/src/pages/SettingsPage.vue',"    case 'mcp-servers':","    case 'computer':\n      return SettingsTabComputer;\n    case 'mcp-servers':");
}

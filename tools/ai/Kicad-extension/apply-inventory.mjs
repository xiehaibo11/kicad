import fs from 'node:fs';
import path from 'node:path';
// Settings pages for Skills, Slash Commands, Hooks and Plugins (upstream placeholders),
// configured MCP servers and permission-rule cleanup, from one file-based inventory.
export function applyInventory(root,overlay){
  function patch(file,before,after){const target=path.join(root,file),s=fs.readFileSync(target,'utf8');if(s.split(before).length!==2)throw Error('Inventory anchor missing/ambiguous: '+file+' '+before.slice(0,90));fs.writeFileSync(target,s.replace(before,()=>after));}
  const settings=path.join(root,'src/webview/src/components/settings');
  fs.writeFileSync(path.join(root,'src/shared/kicadMcpSync.ts'),fs.readFileSync(path.join(overlay,'../../composer/mcp-sync.ts'),'utf8'));
  fs.writeFileSync(path.join(root,'src/shared/kicadInventory.ts'),fs.readFileSync(path.join(overlay,'../../composer/inventory.ts'),'utf8').replace("from './demand.ts'","from './kicadDemand'").replace("from './mcp-sync.ts'","from './kicadMcpSync'"));
  // MCP servers configured in other tools on this machine, read live (kicadAgent.mcp.sync).
  const manifest=path.join(root,'package.json'),pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));
  const blocks=[pkg.contributes?.configuration].flat().filter(Boolean),properties=blocks.find(block=>block.properties?.['kicadAgent.mcp.mode'])?.properties;
  if(!properties)throw Error('Inventory: kicadAgent.mcp.mode setting not found');
  const sources=['claude-code','claude-desktop','cursor','vscode','windsurf','codex','opencode'];
  properties['kicadAgent.mcp.sync']={type:'array',items:{type:'string',enum:sources},default:sources,order:11,uniqueItems:true,
    markdownDescription:'Use MCP servers configured in these tools on this machine, read live from their own files (`~/.claude.json` and `.mcp.json`, Claude Desktop, `~/.cursor/mcp.json`, VS Code `mcp.json`, Windsurf, `~/.codex/config.toml`, OpenCode). Nothing is copied. Repository files of other tools are never used; names in Kicad settings win.'};
  fs.writeFileSync(manifest,JSON.stringify(pkg,null,2)+'\n');
  fs.copyFileSync(path.join(overlay,'kicadInventoryHost.ts'),path.join(root,'src/kicadInventoryHost.ts'));
  fs.copyFileSync(path.join(overlay,'settings/kicadInventory.ts'),path.join(settings,'kicadInventory.ts'));
  fs.mkdirSync(path.join(settings,'kicad'),{recursive:true});
  for(const name of fs.readdirSync(path.join(overlay,'settings/kicad')))fs.copyFileSync(path.join(overlay,'settings/kicad',name),path.join(settings,'kicad',name));
  for(const name of fs.readdirSync(path.join(overlay,'settings/tabs'))){
    if(!fs.existsSync(path.join(settings,'tabs',name)))throw Error('Inventory replaces an upstream tab that no longer exists: '+name);
    fs.copyFileSync(path.join(overlay,'settings/tabs',name),path.join(settings,'tabs',name));
  }
  const host='src/services/claude/ClaudeAgentService.ts';
  patch(host,'            case "open_config_file":',`            case "kicad_inventory":
                return {type:'kicad_inventory_response',inventory:await (await import('../../kicadInventoryHost')).kicadInventory()};
            case "kicad_set_enabled":
                return {type:'kicad_set_enabled_response',...await (await import('../../kicadInventoryHost')).setKicadEnabled((request as any).kind,(request as any).name,(request as any).enabled!==false)};
            case "kicad_set_sync":
                return {type:'kicad_set_sync_response',...await (await import('../../kicadInventoryHost')).setKicadSync((request as any).source,(request as any).enabled!==false)};
            case "kicad_clean_permissions":
                return {type:'kicad_clean_permissions_response',...await (await import('../../kicadInventoryHost')).cleanKicadPermissions(this.handlerContext.configService as any,(request as any).rules)};

            case "open_config_file":`);
  patch('src/webview/src/transport/BaseTransport.ts','  protected async sendRequest<TResponse = any>(',`  kicadInventory(): Promise<any> { return this.sendRequest({ type: 'kicad_inventory' } as any); }
  kicadSetEnabled(kind: 'skill' | 'server', name: string, enabled: boolean): Promise<any> { return this.sendRequest({ type: 'kicad_set_enabled', kind, name, enabled } as any); }
  kicadSetSync(source: string, enabled: boolean): Promise<any> { return this.sendRequest({ type: 'kicad_set_sync', source, enabled } as any); }
  kicadCleanPermissions(rules: { scope: string; list: string; rule: string }[]): Promise<any> { return this.sendRequest({ type: 'kicad_clean_permissions', rules } as any); }

  protected async sendRequest<TResponse = any>(`);
  patch('src/webview/src/core/SettingsStore.ts','  private async fetchSettings() {','  /** Re-reads every settings layer after a change made outside this store. */\n  async reload() { await this.fetchSettings(); }\n\n  private async fetchSettings() {');
  const store='src/webview/src/composables/useSettingsStore.ts';
  patch(store,'  refreshSdkCapabilities: () => Promise<void>;\n}','  refreshSdkCapabilities: () => Promise<void>;\n  reloadSettings: () => Promise<void>;\n}');
  patch(store,'    refreshSdkCapabilities\n  };','    refreshSdkCapabilities,\n    reloadSettings: () => storeInstance!.reload()\n  };');
  const mcp='src/webview/src/components/settings/tabs/SettingsTabMCPServers.vue';
  patch(mcp,'    <!-- Section 1: Server Status (SDK probe, read-only) -->','    <KicadMcpInventory />\n\n    <!-- Section 1: Server Status (SDK probe, read-only) -->');
  // The settings probe deliberately loads no settings sources, so it cannot list configured servers.
  patch(mcp,'<span class="mcp-empty">No MCP servers configured</span>','<span class="mcp-empty">No live status: opening settings does not start MCP servers. Configured servers are listed above.</span>');
  patch(mcp,"import SettingsTab from '../SettingsTab.vue';","import SettingsTab from '../SettingsTab.vue';\nimport KicadMcpInventory from '../kicad/KicadMcpInventory.vue';");
  const permissions='src/webview/src/components/settings/tabs/SettingsTabPermissions.vue';
  patch(permissions,'  <SettingsTab title="Permissions">\n','  <SettingsTab title="Permissions">\n    <KicadPermissionCleanup />\n');
  patch(permissions,"import { useSettingsStore } from '../../../composables/useSettingsStore';","import { useSettingsStore } from '../../../composables/useSettingsStore';\nimport KicadPermissionCleanup from '../kicad/KicadPermissionCleanup.vue';");
}

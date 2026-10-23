<template>
  <SettingsSection title="Configured Servers">
    <SettingsSubSection caption="Read from Kicad settings and the other tools below without connecting. In on-demand mode a server connects only when the agent searches its tools.">
      <SettingsCell v-for="(server, index) in servers" :key="server.scope + (server.source || '') + server.name + (server.file || '')" :divider="index > 0">
        <template #label>
          <div class="kicad-server-label">
            <span class="kicad-server-name">{{ server.name }}</span>
            <Badge size="small" variant="subtle">{{ server.source || scopeLabel(server.scope) }}</Badge>
            <Badge v-if="server.scope !== 'builtin' && server.scope !== 'user'" size="small" variant="subtle">{{ scopeLabel(server.scope) }}</Badge>
            <Badge size="small" variant="subtle">{{ server.transport }}</Badge>
            <KicadFlag v-for="flag in server.flags" :key="flag.kind + flag.message" :kind="flag.kind" :message="flag.message" />
          </div>
        </template>
        <template #description>
          <span class="kicad-server-target">{{ server.target }}</span>
          <span v-if="server.tools?.length" class="kicad-server-tools">Tools: {{ server.tools.join(', ') }}</span>
          <span v-for="flag in notes(server)" :key="flag.message" class="kicad-server-note">{{ flag.message }}</span>
        </template>
        <template #trailing>
          <div class="kicad-server-actions">
            <Switch v-if="server.scope !== 'builtin' && !server.flags.some(f => f.kind === 'ignored')" :model-value="!disabledByKicad(server)"
              :title="'Let the agent use ' + server.name" @update:model-value="setEnabled('server', server.name, $event)" />
            <Button v-if="server.file" variant="tertiary" size="small" @click="open(server.file)">Open</Button>
          </div>
        </template>
      </SettingsCell>
      <SettingsCell v-if="externalCount === 0" :divider="servers.length > 0">
        <template #label><span class="kicad-server-empty">No external MCP servers found in Kicad settings or the tools below. Mode: {{ inventory?.mcpMode }}.</span></template>
      </SettingsCell>
    </SettingsSubSection>
  </SettingsSection>
  <SettingsSection title="Sync from Other Tools">
    <SettingsSubSection caption="Servers you add in these tools appear here automatically, read live from their own files; nothing is copied. Repository files of other tools are listed but never used. Changes apply to the next conversation.">
      <SettingsCell v-for="(source, index) in sources" :key="source.id" :divider="index > 0">
        <template #label>
          <div class="kicad-server-label"><span>{{ source.label }}</span><Badge size="small" variant="subtle">{{ count(source) }} server{{ count(source) === 1 ? '' : 's' }}</Badge></div>
        </template>
        <template #description>
          <span v-if="!source.files.length" class="kicad-source-missing">No configuration file found.</span>
          <span v-for="file in source.files" :key="file.file + file.scope" class="kicad-source-file">
            {{ shortPath(file.file, inventory?.home, inventory?.cwd) }}<template v-if="file.section"> · {{ file.section }}</template><template v-if="!file.used"> · repository file, not used</template><template v-if="file.error"> · {{ file.error }}</template>
          </span>
        </template>
        <template #trailing>
          <Switch :model-value="source.enabled" :title="'Use MCP servers configured in ' + source.label" @update:model-value="toggleSource(source.id, $event)" />
        </template>
      </SettingsCell>
      <p v-if="failure" class="kicad-server-error" role="alert">{{ failure }}</p>
    </SettingsSubSection>
  </SettingsSection>
</template>
<script setup lang="ts">
import {computed,ref} from 'vue';
import KicadFlag from './KicadFlag.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import SettingsCell from '../SettingsCell.vue';
import Badge from '../../Common/Badge.vue';
import Button from '../../Common/Button.vue';
import Switch from '../../Common/Switch.vue';
import {transport} from '../../../core/runtimeTransport';
import {scopeLabel,shortPath,useKicadInventory} from '../kicadInventory';
const {inventory,refresh,setEnabled,open}=useKicadInventory();
const failure=ref('');
const servers=computed(()=>inventory.value?.servers||[]);
const sources=computed(()=>inventory.value?.mcpSources||[]);
const externalCount=computed(()=>servers.value.filter(server=>server.scope!=='builtin').length);
type Flagged={flags:{kind:string;message:string}[]};
const disabledByKicad=(server:Flagged)=>server.flags.some(flag=>flag.kind==='disabled'&&flag.message.includes('kicadAgent.mcp.disabledServers'));
// Problems that keep a server from running are spelled out; states stay as flags.
const notes=(server:Flagged)=>server.flags.filter(flag=>flag.kind==='unusable'||flag.kind==='conflict'||flag.kind==='stale');
const count=(source:{files:{servers:number}[]})=>source.files.reduce((sum,file)=>sum+file.servers,0);
async function toggleSource(id:string,enabled:boolean){
  failure.value='';
  try{await (transport as any).kicadSetSync(id,enabled);await refresh();}
  catch(error){failure.value='Could not change sync: '+(error instanceof Error?error.message:String(error));}
}
</script>
<style scoped>
.kicad-server-label{display:flex;flex-wrap:wrap;align-items:center;gap:6px;}
.kicad-server-name,.kicad-server-target,.kicad-source-file{font-family:var(--vscode-editor-font-family,monospace);}
.kicad-server-target,.kicad-source-file{word-break:break-all;}
.kicad-server-tools,.kicad-source-file{display:block;margin-top:2px;}
.kicad-server-note{display:block;margin-top:2px;color:var(--vscode-editorWarning-foreground,#cca700);}
.kicad-source-file+.kicad-source-file{margin-top:0;}
.kicad-server-actions{display:flex;align-items:center;gap:8px;}
.kicad-source-missing{display:block;margin-top:2px;color:var(--cursor-text-tertiary);}
.kicad-server-empty{font-size:12px;color:var(--cursor-text-tertiary);font-style:italic;}
.kicad-server-error{margin:0;padding:8px 0;font-size:12px;color:var(--vscode-errorForeground,#f48771);}
</style>

<template>
  <SettingsTab title="Computer Control">
    <p class="computer-intro">Control application windows through the open-source Cua Driver. Tools load when the conversation needs them; keeping the service available does not start a task or capture the screen.</p>
    <SettingsSection title="Cua Driver">
      <SettingsSubSection caption="The signed macOS app owns Accessibility and Screen Recording permissions. Its private background service survives conversations and editor exit, and restarts at login.">
        <SettingsCell>
          <template #label>Enable Computer Control</template>
          <template #description>Independent of MCP, skills, reasoning and sub-agent settings. Turning it off revokes active tool connections and stops the extension's service.</template>
          <template #trailing><Switch :model-value="!!status?.enabled" :disabled="busy" title="Enable Computer Control" @update:model-value="change('enabled',$event)" /></template>
        </SettingsCell>
        <SettingsCell :divider="true">
          <template #label><span data-testid="computer-status">{{ status?.running ? 'Running in background' : status?.enabled ? 'Service unavailable' : 'Off' }}</span></template>
          <template #description><span class="computer-path">{{ status?.binary || 'Cua Driver not found' }}</span><span v-if="status?.socket" class="computer-path">{{ status.socket }}</span><span v-if="status?.platform !== 'darwin'">Managed service currently requires macOS.</span></template>
          <template #trailing><div class="computer-actions"><Button size="small" variant="secondary" :disabled="busy || !status?.enabled" @click="change('restart')">Restart</Button><Button size="small" variant="tertiary" :disabled="busy" @click="refresh">Refresh</Button></div></template>
        </SettingsCell>
        <SettingsCell :divider="true">
          <template #label>macOS Permissions</template>
          <template #description>Accessibility: {{ permission(status?.permissions?.accessibility) }} · Screen Recording: {{ permission(status?.permissions?.screen_recording) }}. After changing permissions, restart the service and refresh.</template>
          <template #trailing><Button size="small" variant="secondary" :disabled="busy || !status?.enabled" @click="change('permissions')">Grant Permissions</Button></template>
        </SettingsCell>
        <SettingsCell :divider="true">
          <template #label>Service Diagnostics</template>
          <template #description>No floating tool window or cursor overlay. Output follows the conversation's normal tool stream; diagnostics are available in the editor.</template>
          <template #trailing><Button size="small" variant="tertiary" :disabled="busy || !status?.running" @click="change('log')">View Log</Button></template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>
    <SettingsSection title="Application Access">
      <SettingsSubSection caption="Access is enforced on every window read and action. KiCad is allowed by default. These controls grant native mouse, keyboard and accessibility access; Chrome's browser extension and Excel's add-in are separate integrations.">
        <SettingsCell>
          <template #label>Any App</template><template #description>Allow all application windows. Full-desktop capture and unscoped scripts remain unavailable.</template>
          <template #trailing><Switch :model-value="!!status?.anyApp" :disabled="busy || !status?.enabled" title="Allow Any App" @update:model-value="change('anyApp',$event)" /></template>
        </SettingsCell>
        <SettingsCell v-for="(app,index) in apps" :key="app.label" :divider="true">
          <template #label>{{ app.label }}</template><template #description>{{ app.description }}</template>
          <template #trailing><Switch :model-value="status?.anyApp || app.ids.every(id=>status?.allowedApps?.includes(id))" :disabled="busy || !status?.enabled || status?.anyApp" :title="'Allow ' + app.label" @update:model-value="toggleApp(index,$event)" /></template>
        </SettingsCell>
        <SettingsCell :divider="true">
          <template #label>Other Applications</template><template #description>Additional bundle IDs, separated by commas. Changes revoke current connections and take effect on the next tool call.</template>
          <template #trailing><div class="computer-custom"><input v-model="extraApps" aria-label="Other application bundle IDs" placeholder="com.example.app" :disabled="busy" /><Button size="small" variant="secondary" :disabled="busy" @click="saveApps">Save</Button></div></template>
        </SettingsCell>
        <SettingsCell :divider="true">
          <template #label>Locked-Screen Use</template><template #description>Unavailable. Cua Driver cannot bypass the macOS lock screen. Unlock the Mac before using screen control; a background service does not grant locked-screen access.</template>
          <template #trailing><Switch :model-value="false" :disabled="true" title="Locked-screen use unavailable" /></template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>
    <p v-if="failure || status?.error" role="alert" class="computer-error">{{ failure || status.error }}</p>
    <p class="computer-footer">Install the signed Cua Driver app (tested version 0.38.0), then enable this switch. No driver, optional perception models, browser extension or application add-in is downloaded automatically. Text-only models can use accessibility trees; vision models also receive window screenshots.</p>
  </SettingsTab>
</template>
<script setup lang="ts">
import {ref,onMounted,onBeforeUnmount} from 'vue';
import SettingsTab from '../SettingsTab.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import SettingsCell from '../SettingsCell.vue';
import Switch from '../../Common/Switch.vue';
import Button from '../../Common/Button.vue';
import {transport} from '../../../core/runtimeTransport';
const status=ref<any>(),failure=ref(''),busy=ref(false),extraApps=ref('');
const apps=[{label:'KiCad',ids:['org.kicad.kicad','org.kicad.pcbnew','org.kicad.eeschema'],description:'Project manager, schematic editor and PCB editor.'},{label:'Google Chrome',ids:['com.google.Chrome'],description:'Native window control. This does not install a browser extension or attach to a logged-in browser profile.'},{label:'Microsoft Excel',ids:['com.microsoft.Excel'],description:'Native window control. This does not install the Excel add-in or expose workbook APIs.'}];
const known=apps.flatMap(app=>app.ids);
function apply(value:any){status.value=value;extraApps.value=(value.allowedApps||[]).filter((id:string)=>!known.includes(id)).join(', ');}
async function refresh(){try{apply((await (transport as any).kicadComputerStatus()).status);}catch(e){failure.value=String(e);}}
async function change(action:string,value?:any){busy.value=true;failure.value='';try{apply((await (transport as any).kicadComputerSetting(action,value)).status);}catch(e){failure.value=String(e);await refresh();}finally{busy.value=false;}}
function toggleApp(index:number,enabled:boolean){const ids=apps[index].ids,current=status.value?.allowedApps||[];return change('allowedApps',enabled?[...new Set([...current,...ids])]:current.filter((id:string)=>!ids.includes(id)));}
function saveApps(){const current=(status.value?.allowedApps||[]).filter((id:string)=>known.includes(id));return change('allowedApps',[...new Set([...current,...extraApps.value.split(',').map(id=>id.trim()).filter(Boolean)])]);}
const permission=(value:any)=>value===true?'Granted':value===false?'Not granted':'Unknown';
let timer:ReturnType<typeof setInterval>|undefined;
onMounted(async()=>{await refresh();timer=setInterval(()=>{if(!busy.value)void refresh();},10000);});
onBeforeUnmount(()=>clearInterval(timer));
</script>
<style scoped>
.computer-intro,.computer-footer{font-size:12px;color:var(--cursor-text-secondary);line-height:1.6;margin:0 0 16px;}
.computer-path{display:block;font-family:var(--vscode-editor-font-family,monospace);word-break:break-all;}
.computer-actions,.computer-custom{display:flex;align-items:center;gap:8px;}
.computer-custom input{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border, #555);border-radius:4px;padding:5px;width:160px;}
.computer-error{color:var(--vscode-errorForeground,#f48771);font-size:12px;white-space:pre-wrap;}
</style>

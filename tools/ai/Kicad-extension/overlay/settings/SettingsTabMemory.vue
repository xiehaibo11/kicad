<template>
  <SettingsTab title="Memory">
    <p class="memory-intro">Local memories shared by the terminal and extension, across models. The current request takes precedence.</p>
    <div v-if="status?.reloadRequired" role="alert" class="memory-error">Reload this window to register the installed memory settings.
      <Button size="small" variant="secondary" @click="act('reload')">Reload Window</Button>
    </div>
    <SettingsSection title="Memory Behavior">
      <SettingsSubSection>
        <SettingsCell v-for="(item,index) in controls" :key="item.key" :divider="index>0">
          <template #label>{{ item.label }}</template><template #description>{{ item.description }}</template>
          <template #trailing><Switch :model-value="!!status?.settings[item.key]" :disabled="busy || !status || status.reloadRequired" :title="item.label" @update:model-value="setting(item.key,$event)" /></template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>
    <p v-if="status && !status.hasWorkspace" class="memory-intro">Open a workspace to create its project memory.</p>
    <SettingsSection v-for="scope in ['global','project']" :key="scope" :title="scope==='global'?'Global Memory':'Project Memory'">
      <SettingsSubSection>
        <SettingsCell v-for="(store,index) in stores(scope)" :key="store.id" :divider="index>0" class="memory-store" :data-store="store.id">
          <template #label>{{ store.label }} <span v-if="store.current" class="memory-badge">Current project</span></template>
          <template #description>{{ store.count }} memories<span v-if="store.updatedAt"> · {{ date(store.updatedAt) }}</span><span v-if="store.cwd" class="memory-path">{{ store.cwd }}</span></template>
          <template #trailing><div class="memory-actions">
            <Button size="small" variant="secondary" :disabled="busy" @click="open(store)">View</Button>
            <Button size="small" variant="tertiary" :disabled="busy" @click="act('export',{store:store.id})">Export</Button>
            <Button size="small" variant="tertiary" :disabled="busy || !store.count" @click="clear(store)">Delete All</Button>
          </div></template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>
    <SettingsSection v-if="selected" :title="selected.label">
      <div class="memory-toolbar"><input v-model="query" aria-label="Search memories" placeholder="Search memories" @input="offset=0;void load()" /><Button size="small" variant="secondary" :disabled="busy" @click="edit({kind:'semantic'})">Add Memory</Button><Button size="small" variant="tertiary" @click="selected=undefined;draft=undefined">Close</Button></div>
      <p class="memory-intro" data-testid="memory-count">{{ total }} matching memories</p>
      <div v-if="draft" class="memory-editor">
        <textarea v-model="draft.text" aria-label="Memory text" maxlength="8000" rows="4" placeholder="A preference, verified fact or reusable workflow" />
        <div class="memory-actions"><Button size="small" variant="primary" :disabled="busy || !draft.text?.trim()" @click="save">Save Memory</Button><Button size="small" variant="tertiary" :disabled="busy" @click="draft=undefined">Cancel</Button></div>
      </div>
      <div v-for="record in records" :key="record.id" class="memory-entry">
        <p class="memory-text">{{ record.text }}</p><p class="memory-meta">{{ record.kind }} · {{ record.source }} · {{ Math.round(record.confidence*100) }}% · {{ date(record.time) }} · v{{ record.version }}<span v-if="record.expiresAt"> · Expires {{ date(record.expiresAt) }}</span></p>
        <div class="memory-actions"><Button size="small" variant="tertiary" :disabled="busy" @click="edit(record)">Edit</Button><Button size="small" variant="tertiary" :disabled="busy" @click="remove(record)">Delete</Button></div>
      </div>
      <div v-if="total>50" class="memory-actions"><Button size="small" variant="secondary" :disabled="busy || !offset" @click="offset-=50;void load()">Previous</Button><span>{{ offset+1 }}–{{ Math.min(offset+50,total) }} / {{ total }}</span><Button size="small" variant="secondary" :disabled="busy || offset+50>=total" @click="offset+=50;void load()">Next</Button></div>
    </SettingsSection>
    <p v-if="failure" role="alert" class="memory-error">{{ failure }}</p>
    <p class="memory-intro">Explicit preferences take effect immediately; inferred reply style needs three separate sessions. Memories are stored locally. Relevant entries are included in model requests.</p>
    <Button size="small" variant="tertiary" :disabled="busy" @click="refresh">Refresh</Button>
  </SettingsTab>
</template>
<script setup lang="ts">
import {ref,onMounted} from 'vue';
import SettingsTab from '../SettingsTab.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import SettingsCell from '../SettingsCell.vue';
import Switch from '../../Common/Switch.vue';
import Button from '../../Common/Button.vue';
import {transport} from '../../../core/runtimeTransport';
const status=ref<any>(),failure=ref(''),busy=ref(false),selected=ref<any>(),draft=ref<any>(),records=ref<any[]>([]),query=ref(''),offset=ref(0),total=ref(0);
const controls=[{key:'globalEnabled',label:'Global Memory',description:'Read and update personal preferences across projects. Off stops both reading and writing.'},{key:'projectEnabled',label:'Project Memory',description:'Read and update facts and workflows within each project. Off stops both reading and writing.'},{key:'autoLearn',label:'Learn from Usage',description:'Remember explicit preferences and repeated presentation habits. Off keeps manual memory tools available.'}];
const stores=(scope:string):any[]=>(status.value?.stores||[]).filter((s:any)=>s.scope===scope);
const date=(value:string)=>new Date(value).toLocaleString();
async function refresh(){try{status.value=(await (transport as any).kicadMemoryStatus()).status;}catch(e){failure.value=String(e);}}
let request=0;
async function load(){const ticket=++request,store=selected.value?.id;if(!store)return;try{const result=await (transport as any).kicadMemoryAction('list',{store,query:query.value,offset:offset.value});if(ticket===request&&store===selected.value?.id){records.value=result.records.memories;total.value=result.records.total;}}catch(e){if(ticket===request)failure.value=String(e);}}
async function act(action:string,value?:any){busy.value=true;failure.value='';try{const result=await (transport as any).kicadMemoryAction(action,value);if(result.status)status.value=result.status;return true;}catch(e){failure.value=String(e);await refresh();return false;}finally{busy.value=false;}}
async function setting(key:string,enabled:boolean){await act('setting',{key,enabled});}
async function open(store:any){selected.value=store;query.value='';offset.value=0;draft.value=undefined;await load();}
function edit(record:any){draft.value={...record,text:record.text||''};}
async function save(){if(await act('save',{store:selected.value.id,...draft.value})){draft.value=undefined;await load();}}
async function remove(record:any){if(await act('delete',{store:selected.value.id,id:record.id,version:record.version})){offset.value=0;await load();}}
async function clear(store:any){if(await act('clear',{store:store.id})){if(selected.value?.id===store.id){draft.value=undefined;offset.value=0;await load();}}}
onMounted(refresh);
</script>
<style scoped>
.memory-intro,.memory-meta{color:var(--cursor-text-secondary);font-size:12px;line-height:1.6;margin:0 0 14px;}
.memory-actions,.memory-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}.memory-toolbar{margin-bottom:12px;}
.memory-path{display:block;word-break:break-all;}.memory-badge{font-size:10px;color:var(--cursor-text-secondary);margin-left:8px;}
.memory-entry,.memory-editor{padding:12px;margin:10px 0;border:1px solid var(--vscode-panel-border,#444);border-radius:8px;}
.memory-text{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 8px;font-size:13px;}.memory-meta{font-size:11px;margin:0 0 6px;}
.memory-toolbar input,.memory-editor textarea{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#555);border-radius:4px;padding:8px;font:inherit;}
.memory-toolbar input{flex:1;min-width:120px;}.memory-editor textarea{box-sizing:border-box;width:100%;resize:vertical;margin-bottom:8px;}
.memory-error{color:var(--vscode-errorForeground,#f48771);font-size:12px;white-space:pre-wrap;}
</style>

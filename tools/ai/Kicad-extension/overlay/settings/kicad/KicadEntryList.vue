<template>
  <div class="kicad-entries">
    <div v-if="items.length > 12" class="kicad-entries-search">
      <TextInput v-model="query" placeholder="Filter by name, description or issue..." size="small" />
      <label class="kicad-entries-check"><input v-model="issuesOnly" type="checkbox"> Issues only ({{ issueCount }})</label>
    </div>
    <SettingsSection v-for="group in groups" :key="group.key" :title="group.title">
      <SettingsSubSection :caption="group.caption">
        <SettingsCell v-for="(item, index) in group.items" :key="item.file || item.name" :divider="index > 0" class="kicad-entry">
          <template #label>
            <div class="kicad-entry-label">
              <span class="kicad-entry-name">{{ prefix }}{{ item.name }}</span>
              <KicadFlag v-for="flag in item.flags" :key="flag.kind + flag.message" :kind="flag.kind" :message="flag.message" />
            </div>
          </template>
          <template #description>
            <span class="kicad-entry-description">{{ item.description || 'No description' }}</span>
            <span v-for="flag in warnings(item)" :key="flag.message" class="kicad-entry-warning">{{ flag.message }}</span>
          </template>
          <template #trailing>
            <div class="kicad-entry-actions">
              <Switch v-if="toggle && !item.flags.some(f => f.kind === 'manual')" :model-value="!item.flags.some(f => f.kind === 'disabled')"
                :title="'Let the agent load ' + item.name" @update:model-value="emit('toggle', item, $event)" />
              <Button v-if="item.file" variant="tertiary" size="small" @click="emit('open', item.file)">Open</Button>
            </div>
          </template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>
    <p v-if="!groups.length" class="kicad-entries-empty">{{ query || issuesOnly ? 'Nothing matches the filter.' : emptyText }}</p>
  </div>
</template>
<script setup lang="ts">
import KicadFlag from './KicadFlag.vue';
import {computed,ref} from 'vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import SettingsCell from '../SettingsCell.vue';
import Badge from '../../Common/Badge.vue';
import Button from '../../Common/Button.vue';
import Switch from '../../Common/Switch.vue';
import TextInput from '../../Common/TextInput.vue';
import {scopeLabel,shortPath} from '../kicadInventory';
type Item={name:string;description:string;scope:string;file?:string;root?:string;flags:{kind:string;message:string}[]};
const props=defineProps<{items:Item[];home?:string;cwd?:string;toggle?:boolean;prefix?:string;emptyText:string;captions?:Record<string,string>}>();
const emit=defineEmits<{(event:'open',file:string):void;(event:'toggle',item:Item,enabled:boolean):void}>();
const query=ref(''),issuesOnly=ref(false);
const ISSUES=new Set(['stale','conflict','duplicate']);
const issueCount=computed(()=>props.items.filter(item=>item.flags.some(flag=>ISSUES.has(flag.kind))).length);
// Problems are spelled out under the row; informational states stay as badges.
const warnings=(item:Item)=>item.flags.filter(flag=>flag.kind==='stale'||flag.kind==='conflict');
const order=['builtin','project','local','user','plugin'];
const groups=computed(()=>{
  const text=query.value.trim().toLowerCase();
  const shown=props.items.filter(item=>(!issuesOnly.value||item.flags.some(flag=>ISSUES.has(flag.kind)))&&(!text||[item.name,item.description,...item.flags.map(flag=>flag.kind+' '+flag.message)].join(' ').toLowerCase().includes(text)));
  const map=new Map<string,Item[]>();
  for(const item of shown){const key=item.scope+'|'+(item.root||'');map.set(key,[...(map.get(key)||[]),item]);}
  return [...map.entries()].sort(([a],[b])=>order.indexOf(a.split('|')[0])-order.indexOf(b.split('|')[0])||a.localeCompare(b)).map(([key,items])=>{
    const [scope,root]=key.split('|');
    return {key,title:scopeLabel(scope)+' · '+items.length,caption:props.captions?.[scope]??(root?shortPath(root,props.home,props.cwd):''),items};
  });
});
</script>
<style scoped>
.kicad-entries{display:flex;flex-direction:column;gap:20px;}
.kicad-entries-search{display:flex;align-items:center;gap:12px;padding:0 8px;}
.kicad-entries-search :deep(input){flex:1;min-width:0;}
.kicad-entries-check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--cursor-text-secondary);white-space:nowrap;}
.kicad-entry-label{display:flex;flex-wrap:wrap;align-items:center;gap:6px;}
.kicad-entry-name{font-family:var(--vscode-editor-font-family,monospace);}
.kicad-entry-description{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.kicad-entry-warning{display:block;margin-top:2px;color:var(--vscode-editorWarning-foreground,#cca700);}
.kicad-entry-actions{display:flex;align-items:center;gap:8px;}
.kicad-entries-empty{margin:0;padding:24px 8px;font-size:12px;color:var(--cursor-text-tertiary);}
</style>

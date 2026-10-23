<template>
  <SettingsTab title="Plugins">
    <KicadInventoryStatus>{{ installed.length }} installed · {{ marketplaces.length }} marketplaces · {{ available }} available</KicadInventoryStatus>
    <SettingsSection title="Installed">
      <SettingsSubSection caption="Enabled plugins come from enabledPlugins in the settings files; plugin skills are listed under Skills.">
        <SettingsCell v-for="(plugin, index) in installed" :key="plugin.id" :divider="index > 0" :description="plugin.version ? 'Version ' + plugin.version : ''">
          <template #label><span class="kicad-plugin-name">{{ plugin.id }}</span> <Badge size="small" :variant="plugin.enabled ? 'success' : 'subtle'">{{ plugin.enabled ? 'enabled' : 'off' }}</Badge></template>
        </SettingsCell>
        <p v-if="!installed.length" class="kicad-empty">No plugins installed. Install one with /plugin install name@marketplace in a conversation.</p>
      </SettingsSubSection>
    </SettingsSection>
    <SettingsSection v-for="market in marketplaces" :key="market.name" :title="market.name + ' · ' + market.available.length">
      <SettingsSubSection :caption="market.updated ? 'Updated ' + new Date(market.updated).toLocaleString() : ''">
        <div class="kicad-plugin-search"><TextInput v-model="query" placeholder="Search plugins..." size="small" /></div>
        <SettingsCell v-for="(plugin, index) in shown(market)" :key="plugin.name" :divider="index > 0" :description="plugin.description">
          <template #label><span class="kicad-plugin-name">{{ plugin.name }}</span> <Badge v-if="plugin.category" size="small" variant="subtle">{{ plugin.category }}</Badge></template>
          <template #trailing>
            <Button variant="tertiary" size="small" :title="'Copy /plugin install ' + plugin.name + '@' + market.name" @click="copy(plugin.name + '@' + market.name)">{{ copied === plugin.name + '@' + market.name ? 'Copied' : 'Copy install' }}</Button>
          </template>
        </SettingsCell>
        <p v-if="!shown(market).length" class="kicad-empty">Nothing matches.</p>
        <p v-else-if="matches(market).length > limit" class="kicad-empty">Showing {{ limit }} of {{ matches(market).length }}; refine the search to see others.</p>
      </SettingsSubSection>
    </SettingsSection>
  </SettingsTab>
</template>
<script setup lang="ts">
import {computed,ref} from 'vue';
import SettingsTab from '../SettingsTab.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import SettingsCell from '../SettingsCell.vue';
import Badge from '../../Common/Badge.vue';
import Button from '../../Common/Button.vue';
import TextInput from '../../Common/TextInput.vue';
import KicadInventoryStatus from '../kicad/KicadInventoryStatus.vue';
import {useKicadInventory} from '../kicadInventory';
const {inventory}=useKicadInventory();
const query=ref(''),copied=ref(''),limit=30;
const installed=computed(()=>inventory.value?.plugins.installed||[]);
const marketplaces=computed(()=>inventory.value?.plugins.marketplaces||[]);
const available=computed(()=>marketplaces.value.reduce((sum,market)=>sum+market.available.length,0));
type Market=(typeof marketplaces.value)[number];
const matches=(market:Market)=>{const text=query.value.trim().toLowerCase();return market.available.filter(plugin=>!text||(plugin.name+' '+plugin.description+' '+plugin.category).toLowerCase().includes(text));};
const shown=(market:Market)=>matches(market).slice(0,limit);
// Installing changes the CLI's plugin state, so it stays an explicit command in a conversation.
async function copy(id:string){const command='/plugin install '+id;try{await navigator.clipboard.writeText(command);}catch{const area=document.createElement('textarea');area.value=command;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();}copied.value=id;setTimeout(()=>{if(copied.value===id)copied.value='';},1500);}
</script>
<style scoped>
.kicad-plugin-name{font-family:var(--vscode-editor-font-family,monospace);}
.kicad-plugin-search{padding:8px 0;}
.kicad-empty{margin:0;padding:12px 0;font-size:12px;color:var(--cursor-text-tertiary);}
</style>

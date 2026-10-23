<template>
  <SettingsTab title="Skills">
    <KicadInventoryStatus>
      {{ skills.length }} skills · loading: {{ modeLabel }}<template v-if="issues"> · {{ issues }} with issues</template>
    </KicadInventoryStatus>
    <KicadEntryList :items="skills" :home="inventory?.home" :cwd="inventory?.cwd" toggle empty-text="No skills found in the skill folders."
      @open="open" @toggle="(item, on) => setEnabled('skill', item.name, on)" />
    <SettingsSection title="Sub-agents">
      <SettingsSubSection caption="Sub-agents start only when you ask for them in the current request. Edit custom agents under Memory and Rules.">
        <SettingsCell v-for="(agent, index) in inventory?.agents || []" :key="agent.file || agent.name" :divider="index > 0" :description="agent.description">
          <template #label><span class="kicad-agent-name">{{ agent.name }}</span> <Badge size="small" variant="subtle">{{ scopeLabel(agent.scope) }}</Badge></template>
          <template #trailing><Button v-if="agent.file" variant="tertiary" size="small" @click="open(agent.file)">Open</Button></template>
        </SettingsCell>
        <p v-if="!inventory?.agents.length" class="kicad-empty">No sub-agents. The built-in reviewers are off (kicadAgent.subagents.enabled).</p>
      </SettingsSubSection>
    </SettingsSection>
  </SettingsTab>
</template>
<script setup lang="ts">
import {computed} from 'vue';
import SettingsTab from '../SettingsTab.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import SettingsCell from '../SettingsCell.vue';
import Badge from '../../Common/Badge.vue';
import Button from '../../Common/Button.vue';
import KicadEntryList from '../kicad/KicadEntryList.vue';
import KicadInventoryStatus from '../kicad/KicadInventoryStatus.vue';
import {scopeLabel,useKicadInventory} from '../kicadInventory';
const {inventory,setEnabled,open}=useKicadInventory();
const skills=computed(()=>inventory.value?.skills||[]);
const issues=computed(()=>skills.value.filter(item=>item.flags.some(flag=>['stale','conflict','duplicate'].includes(flag.kind))).length);
const modeLabel=computed(()=>({onDemand:'on demand (capability_search)',native:'native (runtime loads skills)',off:'off'} as Record<string,string>)[inventory.value?.skillsMode||'onDemand']);
</script>
<style scoped>
.kicad-agent-name{font-family:var(--vscode-editor-font-family,monospace);}
.kicad-empty{margin:0;padding:12px 0;font-size:12px;color:var(--cursor-text-tertiary);}
</style>

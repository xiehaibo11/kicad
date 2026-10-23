<template>
  <SettingsTab title="Hooks">
    <KicadInventoryStatus>{{ configured.length }} configured hooks · {{ builtin.length }} built-in</KicadInventoryStatus>
    <SettingsSection title="Built-in">
      <SettingsSubSection caption="Registered by the Kicad extension for Claude conversations. They run in every permission mode.">
        <SettingsCell v-for="(hook, index) in builtin" :key="hook.event" :divider="index > 0" :label="hook.event" :description="hook.command" />
      </SettingsSubSection>
    </SettingsSection>
    <SettingsSection v-for="group in groups" :key="group.file" :title="group.title">
      <SettingsSubSection :caption="group.caption">
        <SettingsCell v-for="(hook, index) in group.hooks" :key="index" :divider="index > 0">
          <template #label>
            <div class="kicad-hook-label"><span>{{ hook.event }}</span><Badge size="small" variant="subtle">{{ hook.matcher }}</Badge>
              <KicadFlag v-for="flag in hook.flags" :key="flag.kind + flag.message" :kind="flag.kind" :message="flag.message" /></div>
          </template>
          <template #description><code class="kicad-hook-command">{{ hook.command }}</code></template>
        </SettingsCell>
      </SettingsSubSection>
    </SettingsSection>
    <SettingsSection v-if="!configured.length">
      <SettingsSubSection>
        <p class="kicad-empty">No hooks in settings.json, .claude/settings.json or .claude/settings.local.json. Hooks are defined under the "hooks" key of those files.</p>
        <div class="kicad-hook-files">
          <Button variant="secondary" size="small" @click="openConfig('settings')">Open ~/.claude/settings.json</Button>
        </div>
      </SettingsSubSection>
    </SettingsSection>
  </SettingsTab>
</template>
<script setup lang="ts">
import KicadFlag from '../kicad/KicadFlag.vue';
import {computed} from 'vue';
import SettingsTab from '../SettingsTab.vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import SettingsCell from '../SettingsCell.vue';
import Badge from '../../Common/Badge.vue';
import Button from '../../Common/Button.vue';
import KicadInventoryStatus from '../kicad/KicadInventoryStatus.vue';
import {scopeLabel,shortPath,useKicadInventory} from '../kicadInventory';
import {transport} from '../../../core/runtimeTransport';
const {inventory}=useKicadInventory();
const builtin=computed(()=>(inventory.value?.hooks||[]).filter(hook=>hook.scope==='builtin'));
const configured=computed(()=>(inventory.value?.hooks||[]).filter(hook=>hook.scope!=='builtin'));
const groups=computed(()=>{
  const map=new Map<string,typeof configured.value>();
  for(const hook of configured.value)map.set(hook.file||'',[...(map.get(hook.file||'')||[]),hook]);
  return [...map.entries()].map(([file,hooks])=>({file,hooks,title:scopeLabel(hooks[0].scope)+' · '+hooks.length,caption:shortPath(file,inventory.value?.home,inventory.value?.cwd)}));
});
const openConfig=(type:string)=>(transport as any).openConfigFile(type);
</script>
<style scoped>
.kicad-hook-label{display:flex;flex-wrap:wrap;align-items:center;gap:6px;}
.kicad-hook-command{font-family:var(--vscode-editor-font-family,monospace);font-size:11px;word-break:break-all;}
.kicad-empty{margin:0;padding:12px 0;font-size:12px;color:var(--cursor-text-tertiary);}
.kicad-hook-files{display:flex;gap:8px;padding-bottom:12px;}
</style>

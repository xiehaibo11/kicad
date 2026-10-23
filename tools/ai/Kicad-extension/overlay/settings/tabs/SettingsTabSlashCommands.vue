<template>
  <SettingsTab title="Slash Commands">
    <KicadInventoryStatus>
      {{ commands.length }} custom commands<template v-if="issues"> · {{ issues }} with issues</template>
    </KicadInventoryStatus>
    <KicadEntryList :items="commands" :home="inventory?.home" :cwd="inventory?.cwd" prefix="/" :captions="captions"
      empty-text="No custom commands. Add Markdown files to ~/.claude/commands or .claude/commands." @open="open" />
  </SettingsTab>
</template>
<script setup lang="ts">
import {computed} from 'vue';
import SettingsTab from '../SettingsTab.vue';
import KicadEntryList from '../kicad/KicadEntryList.vue';
import KicadInventoryStatus from '../kicad/KicadInventoryStatus.vue';
import {useKicadInventory} from '../kicadInventory';
const {inventory,open}=useKicadInventory();
const commands=computed(()=>inventory.value?.commands||[]);
const issues=computed(()=>commands.value.filter(item=>item.flags.some(flag=>['stale','conflict','duplicate'].includes(flag.kind))).length);
const captions={user:'~/.claude/commands — available in every project',project:'.claude/commands — shared with this repository'};
</script>

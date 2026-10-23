<template>
  <div class="kicad-inventory-status">
    <span v-if="loading">Reading configuration files...</span>
    <span v-else-if="error" class="kicad-inventory-error" role="alert">Could not read configuration: {{ error }}</span>
    <span v-else><slot /></span>
    <Button variant="tertiary" size="small" :disabled="loading" @click="refresh">Refresh</Button>
  </div>
</template>
<script setup lang="ts">
import Button from '../../Common/Button.vue';
import {useKicadInventory} from '../kicadInventory';
const {loading,error,refresh}=useKicadInventory();
</script>
<style scoped>
.kicad-inventory-status{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 8px;font-size:12px;color:var(--cursor-text-secondary);}
.kicad-inventory-error{color:var(--vscode-errorForeground,#f48771);}
</style>

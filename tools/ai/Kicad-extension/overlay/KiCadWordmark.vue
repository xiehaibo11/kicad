<template>
  <div class="kicad-wordmark" role="img" aria-label="Kicad">
    <KiCadIcon class="kicad-wordmark-icon" />
    <span>Kicad</span>
  </div>
</template>

<script setup lang="ts">
import KiCadIcon from './KiCadIcon.vue';
</script>

<style scoped>
.kicad-wordmark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family, system-ui, sans-serif);
  font-size: 36px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.8px;
}

.kicad-wordmark-icon {
  display: block;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
}
</style>

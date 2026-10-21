<template>
  <div class="kicad-tool-reference">
    <button
      type="button"
      @click="
        open = !open;
        open && load();
      "
    >
      工具参考
    </button>
    <div v-if="open" class="tool-catalog" aria-label="工具参考目录">
      <input
        v-model="query"
        placeholder="搜索工具名称或用途"
        aria-label="搜索工具"
      />
      <span v-if="loading" role="status">正在读取 KiCad MCP 工具…</span>
      <div v-if="error" role="alert">
        {{ error }} <button @click="load">重试</button>
      </div>
      <button
        v-for="tool in filtered"
        :key="tool.name"
        type="button"
        @click="select(tool)"
      >
        <strong>{{ tool.name }}</strong
        ><small>{{ tool.access }}</small
        ><span>{{ tool.description }}</span>
      </button>
      <span v-if="!loading && !error && !filtered.length">没有匹配工具</span>
      <small>选择仅插入名称、用途和参数说明，不执行工具。</small>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, computed } from "vue";
import { transport } from "../core/runtimeTransport";
import type { ToolReference } from "../../../kicadComposer";
const emit = defineEmits<{ (event: "insert", value: string): void }>();
const open = ref(false),
  loading = ref(false),
  error = ref(""),
  query = ref(""),
  tools = ref<ToolReference[]>([]);
const filtered = computed(() =>
  tools.value.filter((tool) =>
    (tool.name + " " + tool.description)
      .toLowerCase()
      .includes(query.value.toLowerCase()),
  ),
);
async function load() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    tools.value = (await transport.toolReferences()).tools;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}
function select(tool: ToolReference) {
  emit(
    "insert",
    `工具参考：${tool.name}\n用途：${tool.description}\n访问：${tool.access}\n参数 schema：\n${tool.schema}\n`,
  );
  open.value = false;
}
</script>
<style scoped>
.kicad-tool-reference {
  position: relative;
  font-size: 12px;
}
.kicad-tool-reference button {
  background: transparent;
  color: var(--vscode-textLink-foreground);
  border: 0;
  cursor: pointer;
  padding: 4px;
}
.tool-catalog {
  position: absolute;
  bottom: 100%;
  z-index: 50;
  background: var(--vscode-editor-background, #202020);
  border: 1px solid var(--vscode-input-border, #555);
  padding: 10px;
  max-height: 320px;
  overflow: auto;
  width: min(520px, 75vw);
  box-shadow: 0 3px 12px #0008;
}
.tool-catalog input {
  width: 100%;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  padding: 5px;
}
.tool-catalog > button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  width: 100%;
  border-bottom: 1px solid #5555;
}
.tool-catalog small {
  color: var(--vscode-descriptionForeground);
  display: block;
}
.tool-catalog span {
  white-space: normal;
}
</style>

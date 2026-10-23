<template>
  <template v-for="row in rows" :key="row.key">
    <MessageRenderer v-if="row.kind === 'message'" :message="row.message" :context="context" />
    <ExecutionTurn v-else :messages="row.messages" :context="context" :busy="row.active && busy" :disconnected="row.active && !!error" :awaiting-permission="row.active && awaitingPermission" :started-at="row.startedAt" />
  </template>
  <div v-if="waiting" class="execution-waiting">
    <ExecutionSteps :steps="[]" :context="context" :live="awaitingPermission?'等待确认':'思考中…'" />
  </div>
  <div v-if="error" class="execution-connection-error" role="alert">连接已中断：{{ error }}</div>
</template>
<script setup lang="ts">
import {computed} from 'vue';
import type {Message} from '../../models/Message';
import type {ToolContext} from '../../types/tool';
import {executionRows} from '../../utils/executionTimeline';
import MessageRenderer from './MessageRenderer.vue';
import ExecutionTurn from './ExecutionTurn.vue';
import ExecutionSteps from './ExecutionSteps.vue';
const props=defineProps<{messages:Message[];context:ToolContext;busy?:boolean;error?:string;awaitingPermission?:boolean}>();
const rows=computed(()=>executionRows(props.messages));
const waiting=computed(()=>props.busy&&!rows.value.some(row=>row.kind==='execution'&&row.active));
</script>
<style scoped>
.execution-connection-error{margin:6px 16px;color:var(--vscode-errorForeground,#f48771);font-size:12px;overflow-wrap:anywhere;}
.execution-waiting{margin:4px 16px 8px;min-width:0;}
</style>

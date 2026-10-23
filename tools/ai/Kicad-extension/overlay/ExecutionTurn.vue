<template>
  <section class="execution-turn">
    <!-- Render only received events, in order. The view never schedules tool calls. -->
    <div v-if="steps.length || live" class="execution-steps">
      <ExecutionSteps :steps="steps" :context="context" :live="live" />
    </div>
    <div v-if="view.resultError" class="execution-result-error" role="alert">{{ view.resultError }}</div>
    <div v-if="view.answers.length" class="execution-answer">
      <div v-for="(message,index) in view.answers" :key="index" class="execution-answer-block">
        <MessageRenderer :message="message" :context="context" />
        <MessageCopy v-if="messageText(message).trim()" class="execution-answer-actions" :text="messageText(message)" persistent />
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import type {Message} from '../../models/Message';
import type {ToolContext} from '../../types/tool';
import {executionView} from '../../utils/executionTimeline';
import {executionSteps,messageText} from '../../utils/executionSteps';
import MessageRenderer from './MessageRenderer.vue';
import MessageCopy from './MessageCopy.vue';
import ExecutionSteps from './ExecutionSteps.vue';
const props=defineProps<{messages:Message[];context:ToolContext;busy?:boolean;disconnected?:boolean;awaitingPermission?:boolean;startedAt?:number}>();
const view=computed(()=>executionView(props.messages,!!props.busy,!!props.disconnected));
// Tick only the live status. Individual steps stay mounted as later events arrive.
const now=ref(Date.now());let timer:ReturnType<typeof setInterval>|undefined;
watch(()=>view.value.status==='running',running=>{if(timer)clearInterval(timer);timer=running?setInterval(()=>{now.value=Date.now();},1000):undefined;now.value=Date.now();},{immediate:true});
onBeforeUnmount(()=>{if(timer)clearInterval(timer);});
const elapsed=(since:number)=>{const s=Math.max(0,Math.floor((now.value-since)/1000));return s<60?s+' 秒':Math.floor(s/60)+' 分 '+(s%60)+' 秒';};
const steps=computed(()=>executionSteps(view.value.timeline,view.value.status==='running',props.startedAt));
const live=computed(()=>{
  if(view.value.status!=='running')return '';
  if(props.awaitingPermission&&props.busy)return '等待确认';
  return view.value.running?'':'思考中… · '+elapsed(view.value.lastActivity);
});
</script>
<style scoped>
.execution-turn{min-width:0;margin-bottom:6px;}
.execution-steps{margin:4px 16px 8px;min-width:0;overflow-wrap:anywhere;}
/* Under the answer text (assistant messages indent 24px); the button's own padding makes up the rest. */
.execution-answer-actions{margin:-2px 0 6px 20px;}
.execution-result-error{margin:6px 16px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--vscode-errorForeground,#f48771);font-size:12px;max-height:200px;overflow:auto;}
</style>

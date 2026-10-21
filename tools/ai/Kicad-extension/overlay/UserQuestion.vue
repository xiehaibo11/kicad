<template>
  <form class="user-question" @submit.prevent="submit" @keydown.stop>
    <fieldset v-for="(question,index) in questions" :key="question.question">
      <legend>{{ question.question }}</legend>
      <label v-for="option in question.options || []" :key="option.label" class="question-option">
        <input :type="question.multiSelect?'checkbox':'radio'" :name="'question-'+index" :value="option.label" v-model="choices[index]" />
        <span>{{ option.label }}<small v-if="option.description">{{ option.description }}</small></span>
      </label>
      <input class="question-custom" v-model="custom[index]" placeholder="或输入你的具体需求" :aria-label="question.question+'：其他回答'" />
    </fieldset>
    <div class="question-actions"><button type="submit" :disabled="!complete">确认回答</button><button type="button" @click="cancel">取消</button></div>
  </form>
</template>
<script setup lang="ts">
import {computed,ref} from 'vue';
import type {PermissionRequest} from '../core/PermissionRequest';
const props=defineProps<{request:PermissionRequest}>();
type Question={question:string;multiSelect?:boolean;options?:{label:string;description?:string}[]};
const questions=computed(()=>Array.isArray(props.request.inputs.questions)?props.request.inputs.questions as Question[]:[]);
const choices=ref<(string|string[])[]>(questions.value.map(q=>q.multiSelect?[]:''));
const custom=ref<string[]>(questions.value.map(()=>''));
const answer=(i:number)=>custom.value[i]?.trim()||(Array.isArray(choices.value[i])?(choices.value[i] as string[]).join(', '):choices.value[i])||'';
const complete=computed(()=>questions.value.length>0&&questions.value.every((_,i)=>!!answer(i)));
function submit(){if(!complete.value)return;props.request.accept({...props.request.inputs,answers:Object.fromEntries(questions.value.map((q,i)=>[q.question,answer(i)]))},[]);}
function cancel(){props.request.reject('用户取消了需求澄清。停止执行并等待用户提交具体需求。',true);}
</script>
<style scoped>
.user-question{padding:14px;border:1px solid var(--vscode-input-border);border-radius:8px;margin-bottom:12px;background:var(--vscode-editor-background);display:flex;flex-direction:column;gap:12px}
fieldset{border:0;padding:0;min-width:0;display:flex;flex-direction:column;gap:8px}legend{font-weight:600;margin-bottom:10px}.question-option{display:flex;align-items:flex-start;gap:8px;padding:8px;border:1px solid var(--vscode-input-border);border-radius:5px;cursor:pointer}.question-option small{display:block;color:var(--vscode-descriptionForeground);margin-top:3px}.question-custom{padding:8px;box-sizing:border-box;max-width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:5px}.question-actions{display:flex;gap:10px}.question-actions button{cursor:pointer;padding:7px 12px;border:0;border-radius:4px;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button:disabled{opacity:.45;cursor:default}
</style>

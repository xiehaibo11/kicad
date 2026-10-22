import fs from 'node:fs';
import path from 'node:path';
export function applyExecution(root,overlay){
  function patch(file,before,after){const target=path.join(root,file),s=fs.readFileSync(target,'utf8');if(s.split(before).length!==2)throw Error('Execution anchor missing/ambiguous: '+file+' '+before.slice(0,90));fs.writeFileSync(target,s.replace(before,()=>after));}
  for(const name of ['executionTimeline.ts','executionSteps.ts'])fs.copyFileSync(path.join(overlay,name),path.join(root,'src/webview/src/utils',name));
  for(const name of ['ExecutionTimeline.vue','ExecutionTurn.vue','ExecutionSteps.vue','ExecutionIO.vue'])fs.copyFileSync(path.join(overlay,name),path.join(root,'src/webview/src/components/Messages',name));
  const page='src/webview/src/pages/ChatPage.vue';
  patch(page,`              <MessageRenderer
                v-for="(m, i) in messages"
                :key="m?.id ?? i"
                :message="m"
                :context="toolContext"
              />`,`              <ExecutionTimeline :messages="messages" :context="toolContext" :busy="isBusy" :error="session?.error.value" :awaiting-permission="permissionRequestsLen>0" />`);
  patch(page,"import MessageRenderer from '../components/Messages/MessageRenderer.vue';","import ExecutionTimeline from '../components/Messages/ExecutionTimeline.vue';");
  const model='src/webview/src/models/Message.ts';
  patch(model,'\n  is_error?: boolean;','\n  is_error?: boolean;\n  parentToolUseId?: string;');
  patch(model,'\n      is_error?: boolean;','\n      is_error?: boolean;\n      parentToolUseId?: string;');
  patch(model,'      this.is_error = extra.is_error;','      this.is_error = extra.is_error;\n      this.parentToolUseId = extra.parentToolUseId;');
  patch(model,'        raw.timestamp || Date.now()','        raw.timestamp || Date.now(),\n        {parentToolUseId:raw.parent_tool_use_id}');
  patch(model,`    // 不渲染 result 消息（仅用于结束标志/用量统计等状态更新）
    if (raw.type === 'result') {
      return null;
    }`,`    // Internal turn boundaries let the UI distinguish the final answer from progress.
    // Child results must never settle the main turn.
    if (raw.type === 'result') {
      if(raw.parent_tool_use_id)return null;
      const output=typeof raw.result==='string'?raw.result:Array.isArray(raw.errors)?raw.errors.join('\\n'):'';
      return new Message('result',{role:'result',content:output},raw.timestamp||Date.now(),{subtype:raw.subtype,is_error:raw.is_error});
    }`);
  const sdk='src/services/claude/ClaudeSdkService.ts';
  patch(sdk,'append: VS_CODE_APPEND_PROMPT',`append: VS_CODE_APPEND_PROMPT + '\\n\\nExecution communication: Keep routine tool activity, commands, subagent assignments, step-by-step plans and raw logs out of conversational progress reports; they are available in the expandable execution record. During execution, report only material blockers, risks, important findings or decisions needed from the user, concisely, using a paragraph beginning with 【重要问题】 or 【需要确认】 (or [Important] / [Action required] in English). Never withhold a necessary question, tool failure or verification limitation. On completion, give a concise final answer with outcomes, unresolved issues and relevant verification. If the user explicitly requests detailed plans or logs, provide them. This affects presentation only; retain all tools, permissions and capabilities.'`);
}

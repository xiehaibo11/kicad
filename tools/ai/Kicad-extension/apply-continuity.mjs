import fs from 'node:fs';
import path from 'node:path';
export function applyContinuity(root,overlay){
  function patch(file,before,after){const target=path.join(root,file),source=fs.readFileSync(target,'utf8');if(source.split(before).length!==2)throw Error('Continuity anchor missing/ambiguous: '+file+' '+before.slice(0,80));fs.writeFileSync(target,source.replace(before,()=>after));}
  fs.copyFileSync(path.join(overlay,'../../composer/intent.ts'),path.join(root,'src/shared/kicadIntent.ts'));
  fs.copyFileSync(path.join(overlay,'../../composer/history.ts'),path.join(root,'src/shared/kicadHistory.ts'));
  fs.copyFileSync(path.join(overlay,'../../composer/harness.ts'),path.join(root,'src/shared/kicadHarness.ts'));
  fs.copyFileSync(path.join(overlay,'sessionContinuity.ts'),path.join(root,'src/services/claude/sessionContinuity.ts'));
  fs.copyFileSync(path.join(overlay,'UserQuestion.vue'),path.join(root,'src/webview/src/components/UserQuestion.vue'));
  const sdk='src/services/claude/ClaudeSdkService.ts';
  patch(sdk,"import * as vscode from 'vscode';","import * as vscode from 'vscode';\nimport {SessionContinuity} from './sessionContinuity';");
  patch(sdk,'        // 构建 SDK Options',`        const continuity=new SessionContinuity();
        // Compact before exhausting the window. Respect explicit runtime tuning.
        if(!env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE)env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE='85';
        // 构建 SDK Options`);
  patch(sdk,'            canUseTool,',`            canUseTool:async (tool,input,options)=>continuity.validateAnswer(tool,input,await canUseTool(tool,input,options)),`);
  patch(sdk,'            // Hooks\n            hooks: {',`            // Hooks
            hooks: {
                UserPromptSubmit:[{hooks:[async input=>continuity.prompt(input)]}],
                PostToolUseFailure:[{hooks:[async input=>continuity.failedTool(input)]}],
                PreCompact:[{hooks:[async input=>continuity.checkpoint(input)]}],
                SessionStart:[{hooks:[async input=>continuity.start(input)]}],`);
  patch(sdk,'                PreToolUse: [{\n                    matcher: "Edit|Write|MultiEdit",',`                PreToolUse: [{hooks:[async input=>continuity.beforeTool(input)]},{
                    matcher: "Edit|Write|MultiEdit",`);
  patch(sdk,'            const result = query({ prompt: inputStream, options });',`            const recordedInput={async *[Symbol.asyncIterator](){for await(const message of inputStream){await continuity.recordInput(message,cwdParam);yield message;}}};
            const result = query({ prompt: recordedInput, options });
            const next=result.next.bind(result);
            result.next=async (...args)=>{const item=await next(...args);if(!item.done)await continuity.observe(item.value);return item;};`);
  patch(sdk,'                PostToolUse: [{\n                    matcher: \"Edit|Write|MultiEdit\",',`                PostToolUse: [{hooks:[async input=>continuity.afterTool(input)]},{\n                    matcher: \"Edit|Write|MultiEdit\",`);
  const modal='src/webview/src/components/PermissionRequestModal.vue';
  patch(modal,'  <div\n    class="permission-request-container"',`  <UserQuestion v-if="request.toolName==='AskUserQuestion'" :key="request.channelId+JSON.stringify(request.inputs)" :request="request" />
  <div v-else
    class="permission-request-container"`);
  patch(modal,"import { ref, computed } from 'vue';","import { ref, computed } from 'vue';\nimport UserQuestion from './UserQuestion.vue';");
  const session='src/webview/src/core/Session.ts';
  patch(session,'    if (\n      event.type === \'assistant\' &&',`    if(event.type==='result' && event.modelUsage){
      const models=Object.values(event.modelUsage) as {contextWindow?:number}[];
      const window=models.find(m=>Number.isFinite(m.contextWindow)&&m.contextWindow!>0)?.contextWindow;
      if(window)this.usageData({...this.usageData(),contextWindow:window});
    }
    if(event.type==='system' && event.subtype==='compact_boundary')this.usageData({...this.usageData(),totalTokens:0});
    if (
      event.type === 'assistant' &&`);
}

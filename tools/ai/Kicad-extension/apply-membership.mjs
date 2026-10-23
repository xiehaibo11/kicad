import fs from 'node:fs';
import path from 'node:path';
export function applyMembership(root,overlay){
 const patch=(file,before,after)=>{const f=path.join(root,file),s=fs.readFileSync(f,'utf8');if(s.split(before).length!==2)throw Error('Membership anchor missing: '+file+' '+before.slice(0,70));fs.writeFileSync(f,s.replace(before,()=>after));};
 fs.copyFileSync(path.join(overlay,'../../membership/local.ts'),path.join(root,'src/shared/kicadMembership.ts'));
 fs.copyFileSync(path.join(overlay,'kicadCodex.ts'),path.join(root,'src/kicadCodex.ts'));
 const sdk='src/services/claude/ClaudeSdkService.ts';
 patch(sdk,"import * as vscode from 'vscode';","import * as vscode from 'vscode';\nimport {codexQuery,withProviderHistory} from '../../kicadCodex';\nimport {cachedMembership,executable,membershipEnvironment} from '../../shared/kicadMembership';\nimport {registerReasoningModels} from '../../shared/kicadReasoning';");
 patch(sdk,'        const { inputStream, resume, canUseTool, model, cwd, permissionMode, maxThinkingTokens, onStderrError } = params;',`        if(params.model?.startsWith('codex:'))return codexQuery(params);
        params=await withProviderHistory(params,false);
        const { inputStream, resume, canUseTool, model, cwd, permissionMode, maxThinkingTokens, onStderrError } = params;`);
 patch(sdk,'        const env = await this.getMergedEnvironmentVariables();\n\n        // KiCad: route',`        const merged = await this.getMergedEnvironmentVariables();
        const env = (isDeepSeekModel(model ?? undefined) ? merged : membershipEnvironment(merged)) as Record<string,string>;

        // KiCad: route`);
 patch(sdk,"        const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';",`        const local=executable('claude');
        if(local)return local;
        const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';`);
 patch(sdk,'        const capabilities = Array.from(new Set(params.capabilities ?? [])).filter(Boolean);',`        const capabilities = Array.from(new Set(params.capabilities ?? [])).filter(Boolean);
        if(capabilities.length && capabilities.every(c=>c==='supportedModels'||c==='accountInfo')){
          const discovered=await cachedMembership(params.cwd);
          registerReasoningModels(discovered.supportedModels);
          return {data:{supportedModels:discovered.supportedModels,accountInfo:discovered.accounts}};
        }`);
 // Configuration discovery must not launch a full chat with in-process tools and then close stdin.
 const handlers='src/services/claude/handlers/handlers.ts';
 const handlerSource=fs.readFileSync(path.join(root,handlers),'utf8');
 const start=handlerSource.indexOf('async function loadConfig(context: HandlerContext): Promise<any> {');
 const end=handlerSource.indexOf('\n/**',start);
 if(start<0||end<0)throw Error('loadConfig anchor missing');
 patch(handlers,handlerSource.slice(start,end),`async function loadConfig(context: HandlerContext): Promise<any> {
    const {sdkService,workspaceService}=context;
    const cwd=workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
    const results=await Promise.allSettled([
        sdkService.probe({cwd,capabilities:['supportedCommands']}),
        sdkService.probe({cwd,capabilities:['supportedModels','accountInfo']})
    ]);
    for(const result of results)if(result.status==='rejected')context.logService.warn('Optional configuration discovery failed: '+String(result.reason));
    const commands=results[0].status==='fulfilled'?results[0].value:undefined;
    const membership=results[1].status==='fulfilled'?results[1].value:undefined;
    return {slashCommands:commands?.data?.supportedCommands||[],models:membership?.data?.supportedModels||[],accountInfo:membership?.data?.accountInfo||null};
}
`);
 const optimizer='src/kicadPromptOptimizer.ts';
 patch(optimizer,"import { OPTIMIZER_SYSTEM", "import {codexText} from './shared/kicadMembership';\nimport { OPTIMIZER_SYSTEM");
 patch(optimizer,'        query = run({ prompt: request.text, options });',`        query = request.model.startsWith('codex:') ? (async function*(){
            const text=await codexText(request.model,request.text,policy?.systemPrompt ?? SYSTEM_PROMPT,controller.signal);
            yield {type:'result',subtype:'success',is_error:false,result:text};
        })() as unknown as Query : run({ prompt: request.text, options });`);
 const model='src/webview/src/components/ModelSelect.vue';
 patch(model,"  { id: 'default', label: 'Default' },\n  { id: 'sonnet', label: 'Sonnet' },\n  { id: 'opus', label: 'Opus' },\n  { id: 'haiku', label: 'Haiku' },",'');
 patch(model,"const query=ref(''),probing=ref(false)","const membershipStatus=ref('正在读取本地登录状态'),query=ref(''),probing=ref(false)");
 patch(model,"transport.sdkProbe(['supportedModels'],10000)","transport.sdkProbe(['supportedModels','accountInfo'],20000)");
 patch(model,"    if(!disposed&&res?.data?.supportedModels)","    if(!disposed){const a=res?.data?.accountInfo;membershipStatus.value=[a?.claude?.subscriptionType ? a.claude.subscriptionType : 'Claude 未登录或不可用',a?.codex?.type==='chatgpt' ? 'Codex · ChatGPT '+(a.codex.planType||'会员') : 'Codex 未登录或不可用'].join(' · '); }\n    if(!disposed&&res?.data?.supportedModels)");
 patch(model,'选择模型 <span v-if="probing">','<span :title="membershipStatus">选择模型</span> <span v-if="probing">');
 patch(model,'  description?: string','  description?: string\n  aliases?: string[]');
 patch(model,"onMounted(()=>{document.addEventListener","onMounted(()=>{void loadSdkModels();document.addEventListener");
 patch(model,'  const alias = MODEL_ALIASES.find',"  const resolved=sdkModels.value.find(m=>m.aliases?.includes(props.selectedModel));\n  if(resolved)return resolved.displayName;\n  const alias = MODEL_ALIASES.find");
 patch(model,"  if(probed||probing.value)return;","  if(probing.value)return;");
 patch(model,':width="280"',':width="300"');
 const item='src/webview/src/components/Dropdown/DropdownItem.vue';
 patch(item,':data-is-selected="isSelected"',':data-is-selected="isSelected" :data-model-item="item.type===\'model\'" :title="item.type===\'model\' ? String(item.id) : (item.label || item.name)"');
 patch(item,'<style scoped>','<style scoped>\n[data-model-item="true"] .monaco-highlighted-label{white-space:normal;overflow-wrap:anywhere;text-overflow:clip;}');

}

import fs from 'node:fs';
import path from 'node:path';
export function applySettings(root,overlay){
  function patch(file,before,after){const target=path.join(root,file),source=fs.readFileSync(target,'utf8');if(source.split(before).length!==2)throw Error('Settings anchor missing/ambiguous: '+file+' '+before.slice(0,80));fs.writeFileSync(target,source.replace(before,()=>after));}
  for(const [source,target] of [['settings.ts','kicadSettings.ts'],['prompt-audit.ts','kicadPromptAudit.ts']]){
    const text=fs.readFileSync(path.join(overlay,'../../composer',source),'utf8').replace("from './prompt-sections.ts'","from './kicadPromptSections'").replace("from './history.ts'","from './kicadHistory'");
    fs.writeFileSync(path.join(root,'src/shared',target),text);
  }
  fs.copyFileSync(path.join(overlay,'kicadSettings.ts'),path.join(root,'src/kicadSettings.ts'));
  const sdk='src/services/claude/ClaudeSdkService.ts';
  patch(sdk,"import * as vscode from 'vscode';","import * as vscode from 'vscode';\nimport {agentSettings,claudeSettingsArgument} from '../../kicadSettings';\nimport {assertModelAllowed,capEffort} from '../../shared/kicadSettings';\nimport {reasoningOptions} from '../../shared/kicadReasoning';\nimport {autoDecision} from '../../shared/kicadPermissionGates';");
  patch(sdk,'    async predictDraft(request: PredictDraftRequest, signal: AbortSignal): Promise<PredictDraftResponse> {',`    async predictDraft(request: PredictDraftRequest, signal: AbortSignal): Promise<PredictDraftResponse> {
        const policy=agentSettings(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath).settings;
        if(!policy.autoModeSuggestions)return {type:'predict_draft_response',text:'',model:request.model};
        assertModelAllowed(policy,request.model);`);
  patch(sdk,'    async optimizePrompt(request: OptimizePromptRequest, signal: AbortSignal): Promise<OptimizePromptResponse> {',`    async optimizePrompt(request: OptimizePromptRequest, signal: AbortSignal): Promise<OptimizePromptResponse> {
        assertModelAllowed(agentSettings(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath).settings,request.model);`);
  patch(sdk,'          registerReasoningModels(discovered.supportedModels);',`          const policy=agentSettings(params.cwd||process.cwd()).settings;
          const supportedModels=discovered.supportedModels.filter(model=>{try{assertModelAllowed(policy,model.value);return true;}catch{return false;}}).map(model=>{
            if(!Array.isArray(model.reasoningEfforts))return model;
            const available=model.reasoningEfforts.map(v=>v==='none'?'off':v);
            return {...model,reasoningEfforts:model.reasoningEfforts.filter(v=>{const level=v==='none'?'off':v;try{return capEffort(policy,model.value,level,available)===level;}catch{return false;}})};
          });
          registerReasoningModels(supportedModels);`);
  patch(sdk,'return {data:{supportedModels:discovered.supportedModels,accountInfo:discovered.accounts}};','return {data:{supportedModels,accountInfo:discovered.accounts}};');
  patch(sdk,"        if(params.model?.startsWith('codex:'))",`        const policy=agentSettings(params.cwd||process.cwd()).settings;
        assertModelAllowed(policy,params.model);
        params={...params,reasoningLevel:capEffort(policy,params.model||'default',params.reasoningLevel||'default_on',reasoningOptions(params.model).map(v=>v.value))};
        if(params.model?.startsWith('codex:'))`);
  patch(sdk,"        applyReasoningEnvironment(model,params.reasoningLevel || 'default_on',env);",`        applyReasoningEnvironment(model,params.reasoningLevel || 'default_on',env);
        if(!env.CLAUDE_CODE_WEBFETCH_DEADLINE_MS)env.CLAUDE_CODE_WEBFETCH_DEADLINE_MS='300000';
        // Native workflows must never bypass the root user's explicit delegation gate.
        env.CLAUDE_CODE_DISABLE_WORKFLOWS='1';`);
  patch(sdk,"if(permissionModeParam==='acceptEdits' && !['AskUserQuestion','ExitPlanMode','EnterPlanMode'].includes(tool) && !continuity.needsConfirmation(tool,input,cwdParam))return {behavior:'allow',updatedInput:input};",`if(permissionModeParam==='acceptEdits' && policy.autoMode && autoDecision(tool,input,cwdParam).decision==='allow')return {behavior:'allow',updatedInput:input};`);
  patch(sdk,"                    if(!name)return {behavior:'deny',message:'Search for a capability first.'};",`                    if(!name)return {behavior:'deny',message:'Search for a capability first.'};
                    if(permissionModeParam==='acceptEdits'&&policy.autoMode&&!policy.mcpVerification&&id.startsWith('mcp:'))return {behavior:'allow',updatedInput:input};`);
  patch(sdk,"'settings': path.join(os.homedir(), '.claude', 'claudix.json')","'settings': claudeSettingsArgument(policy.commitAttribution)");
  // PreToolUse runs even for native tools that the SDK would otherwise approve.
  patch(sdk,'async input=>continuity.beforeTool(input)',`async input=>{
                  const result=continuity.beforeTool(input);
                  if(result.hookSpecificOutput?.permissionDecision==='deny')return result;
                  if(!('tool_name' in input))return result;
                  if(['Agent','Task'].includes(input.tool_name)&&typeof (input.tool_input as any)?.model==='string'&&(input.tool_input as any).model!=='inherit')assertModelAllowed(policy,(input.tool_input as any).model);
                  if(permissionModeParam==='acceptEdits'){
                    const decision=policy.autoMode?autoDecision(input.tool_name,input.tool_input,cwdParam):{decision:'ask',reason:'Auto mode disabled in settings.'};
                    if(decision.decision!=='allow'&&!READ_ONLY_EDA_TOOLS.includes(input.tool_name)&&input.tool_name!=='mcp__kicad__capability_call'&&input.tool_name!=='mcp__kicad__capability_inspect')return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:decision.decision,permissionDecisionReason:decision.reason}};
                  }
                  return result;
                }`);
  const codex='src/kicadCodex.ts';
  patch(codex,"import {randomUUID} from 'node:crypto';","import {randomUUID} from 'node:crypto';\nimport {agentSettings} from './kicadSettings';\nimport {assertModelAllowed,capEffort} from './shared/kicadSettings';\nimport {reasoningOptions} from './shared/kicadReasoning';\nimport {autoDecision} from './shared/kicadPermissionGates';");
  patch(codex,'  params=await withProviderHistory(params,true);',`  const policy=agentSettings(params.cwd).settings;
  assertModelAllowed(policy,params.model);
  params={...params,reasoningLevel:capEffort(policy,params.model,params.reasoningLevel||'default_on',reasoningOptions(params.model).map(v=>v.value))};
  params=await withProviderHistory(params,true);`);
  patch(codex,"      const answer=await params.canUseTool(","      if(mode==='acceptEdits'&&policy.autoMode&&autoDecision(name,args,params.cwd).decision==='allow')return true;\n      const answer=await params.canUseTool(");
  patch(codex,"          if(!['search','skill'].includes(target.kind)&&!readonly&&!await allow(target.name,parsed?.args,p.callId))", "          if(!['search','skill'].includes(target.kind)&&!readonly&&!(target.kind==='mcp'&&mode==='acceptEdits'&&policy.autoMode&&!policy.mcpVerification)&&!await allow(target.name,parsed?.args,p.callId))");
  const agent='src/services/claude/ClaudeAgentService.ts';
  patch(agent,"import {normalizeReasoning,reasoningEnvironment}","import {agentSettings} from '../../kicadSettings';\nimport {capEffort} from '../../shared/kicadSettings';\nimport {reasoningOptions} from '../../shared/kicadReasoning';\nimport {normalizeReasoning,reasoningEnvironment}");
  patch(agent,'const selectedThinkingLevel = normalizeReasoning(model, thinkingLevel || this.thinkingLevel);',"const selectedThinkingLevel = capEffort(agentSettings(cwd||process.cwd()).settings,model||'default',normalizeReasoning(model, thinkingLevel || this.thinkingLevel),reasoningOptions(model).map(v=>v.value));");
  const optimizer='src/kicadPromptOptimizer.ts';
  patch(optimizer,"import {codexText}","import * as vscode from 'vscode';\nimport {agentSettings} from './kicadSettings';\nimport {assertModelAllowed,capEffort} from './shared/kicadSettings';\nimport {reasoningOptions,applyReasoningEnvironment,codexReasoningEffort} from './shared/kicadReasoning';\nimport {codexText}");
  patch(optimizer,"    if (typeof request.text !== 'string'",`    const settings=agentSettings(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath).settings;
    assertModelAllowed(settings,request.model);
    const effort=capEffort(settings,request.model,'default_on',reasoningOptions(request.model).map(v=>v.value));
    applyReasoningEnvironment(request.model,effort,config.env);
    if (typeof request.text !== 'string'`);
  patch(optimizer,'policy?.systemPrompt ?? SYSTEM_PROMPT,controller.signal);','policy?.systemPrompt ?? SYSTEM_PROMPT,controller.signal,codexReasoningEffort(request.model,effort));');
  const integration='src/kicadIntegration.ts';
  patch(integration,"import * as vscode from 'vscode';","import * as vscode from 'vscode';\nimport {agentSettings} from './kicadSettings';\nimport {promptAudit} from './shared/kicadPromptAudit';");
  patch(integration,'    { dispose:closeKiCadRuntimes },',`    { dispose:closeKiCadRuntimes },
    vscode.commands.registerCommand('kicadAgent.promptAudit',async()=>{
      const folder=await selectWorkspace();if(!folder)return;
      const policy=agentSettings(folder.uri.fsPath);
      const report={...promptAudit(folder.uri.fsPath),settings:policy.settings,sources:policy.sources};
      const doc=await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify(report,null,2)});
      await vscode.window.showTextDocument(doc,{preview:true,preserveFocus:true});
    }),`);
  patch(integration,"    vscode.commands.registerCommand('kicadAgent.promptAudit',async()=>{",`    vscode.commands.registerCommand('kicadAgent.pluginEval',async()=>{
      const folders=await vscode.window.showOpenDialog({canSelectFiles:false,canSelectFolders:true,canSelectMany:false,title:'Select a Claude plugin with .claude-plugin/plugin.json'});
      if(!folders?.[0])return;
      const folder=folders[0];
      try{JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder,'.claude-plugin/plugin.json'))));}
      catch{throw Error('A Claude plugin manifest is required. This evaluates an AI integration, not native KiCad design correctness.');}
      const executable=findExecutable('claude');if(!executable)throw Error('Install a Claude Code version with plugin eval support (v2.1.269 or later).');
      const {execFile}=await import('node:child_process');
      await new Promise<void>((resolve,reject)=>execFile(executable,['plugin','eval','--help'],{timeout:5000},error=>error?reject(Error('The installed Claude runtime does not support plugin eval. Upgrade to v2.1.269 or later.')):resolve()));
      // Runs only on this explicit user command, in the standard task terminal.
      const task=new vscode.Task({type:'kicad-plugin-eval'},vscode.TaskScope.Workspace,'KiCad plugin evaluation','Kicad',new vscode.ProcessExecution(executable,['plugin','eval',folder.fsPath],{cwd:folder.fsPath}));
      task.presentationOptions={reveal:vscode.TaskRevealKind.Always,focus:false};
      await vscode.tasks.executeTask(task);
    }),
    vscode.commands.registerCommand('kicadAgent.promptAudit',async()=>{`);
  patch(integration,"const env: Record<string, string> = { OPENCODE_DISABLE_TERMINAL_TITLE: 'true', KICAD_CLI: cfg.get<string>('kicadCli', '') || 'kicad-cli' };",`const env: Record<string, string> = { OPENCODE_DISABLE_TERMINAL_TITLE: 'true', KICAD_CLI: cfg.get<string>('kicadCli', '') || 'kicad-cli', KICAD_MAX_PROSE_WIDTH:String(agentSettings(folder.uri.fsPath).settings.maxProseWidth) };`);
}

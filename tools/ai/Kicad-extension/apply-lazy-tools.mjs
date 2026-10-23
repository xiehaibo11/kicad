// Stable discovery/call tools: no channel restart and no whole-toolbox promotion.
import fs from 'node:fs';
import path from 'node:path';
export function applyLazyTools(root){
  function patch(file,before,after){const target=path.join(root,file),source=fs.readFileSync(target,'utf8');if(source.split(before).length!==2)throw Error('Lazy-tools anchor missing/ambiguous: '+file+' '+before.slice(0,80));fs.writeFileSync(target,source.replace(before,()=>after));}
  const sdk='src/services/claude/ClaudeSdkService.ts';
  patch(sdk,"import * as vscode from 'vscode';","import * as vscode from 'vscode';\nimport {DEMAND_GUIDANCE} from '../../shared/kicadDemand';");
  patch(sdk,"if(params.model?.startsWith('codex:'))return codexQuery(params);","if(params.model?.startsWith('codex:'))return codexQuery({...params,mcpServers:(await this.configService.getAllSettings()).mcpServers??{}});");
  patch(sdk,'            allowedTools: READ_ONLY_EDA_TOOLS,',"            allowedTools: [...READ_ONLY_EDA_TOOLS,'mcp__kicad__capability_search'],\n            strictMcpConfig: true,\n            disallowedTools: ['Skill'],");
  patch(sdk,"append: VS_CODE_APPEND_PROMPT + '","append: VS_CODE_APPEND_PROMPT + '\\n' + DEMAND_GUIDANCE + '");
  // Prevent Claude's automatic skill catalogue; the shared search reads metadata, call reads one body.
  patch(sdk,"              'debug': null,","              'disable-slash-commands': null,\n              'debug': null,");
  // Configuration probes run before a user task and must not load external servers or skills.
  patch(sdk,'            settingSources: [],',"            settingSources: [],\n            mcpServers: {},\n            strictMcpConfig: true,\n            tools: [],\n            disallowedTools: ['Skill'],");
  patch(sdk,'            extraArgs: {},',"            extraArgs: {'disable-slash-commands': null},");
  patch(sdk,'canUseTool:async (tool,input,options)=>continuity.validateAnswer(tool,input,await canUseTool(tool,input,options)),',`canUseTool:async (tool,input,options)=>{
                // Agent mode is the direct-execution mode: operational tools run
                // without a per-call Yes. Questions and plan transitions still
                // require the user's own answer/approval.
                if(permissionModeParam==='acceptEdits' && !['AskUserQuestion','ExitPlanMode','EnterPlanMode'].includes(tool))return {behavior:'allow',updatedInput:input};
                if(tool==='mcp__kicad__capability_search')return {behavior:'allow',updatedInput:input};
                if(tool==='mcp__kicad__capability_call'){
                    const id=String(input.id||''),args=input.arguments as Record<string,unknown>;
                    const name=id.startsWith('tool:')?'mcp__kicad__'+id.slice(5):id.startsWith('skill:')?'Skill':id.startsWith('mcp:')?'mcp__'+id.slice(4).replace(':','__'):'';
                    if(!name)return {behavior:'deny',message:'Search for a capability first.'};
                    if(READ_ONLY_EDA_TOOLS.includes(name)||(name==='mcp__kicad__local_memory'&&args?.operation==='read'))return {behavior:'allow',updatedInput:input};
                    const answer=await canUseTool(name,name==='Skill'?{skill:id.slice(6)}:args,options);
                    return answer.behavior==='allow'?{...answer,updatedInput:{...input,arguments:answer.updatedInput??args}}:answer;
                }
                return continuity.validateAnswer(tool,input,await canUseTool(tool,input,options));
            },`);
}

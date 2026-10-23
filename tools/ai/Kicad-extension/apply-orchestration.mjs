import fs from 'node:fs';
import path from 'node:path';

// MCP/skill orchestration follows the Kicad settings (kicadAgent.mcp.*, skills.*,
// subagents.*, prompt.*). One KiCad session per launch carries the settings, the
// capability catalog and the MCP servers, so the prompt text, the tools offered
// and the permission policy always describe the same configuration.
export function applyOrchestration(root) {
  const file = 'src/services/claude/ClaudeSdkService.ts';
  function patch(before, after) {
    const target = path.join(root, file), source = fs.readFileSync(target, 'utf8');
    if (source.split(before).length !== 2) throw Error('Orchestration anchor missing/ambiguous: ' + before.slice(0, 90));
    fs.writeFileSync(target, source.replace(before, () => after));
  }
  patch("import { getKiCadSdkServers, READ_ONLY_EDA_TOOLS } from '../../kicadRuntime';",
    "import { getKiCadSdkServers, getKiCadSdkSession, kicadAgents, kicadPromptFeatures, kicadDemandGuidance, READ_ONLY_EDA_TOOLS } from '../../kicadRuntime';");
  patch('        const options: Options = {\n            abortController:channelAbort,',
    '        const kicadSession = await getKiCadSdkSession(cwdParam, (await this.configService.getAllSettings()).mcpServers ?? {}, {model: modelParam});\n        continuity.configure(kicadSession.settings);\n        const kicadAgentDefinitions = kicadAgents(kicadSession.settings);\n        const options: Options = {\n            abortController:channelAbort,');
  patch('mcpServers: await getKiCadSdkServers(cwdParam, (await this.configService.getAllSettings()).mcpServers ?? {}, {model: modelParam}),',
    'mcpServers: kicadSession.servers,');
  // Native skills: the runtime's own Skill tool and listing; otherwise the catalog loads skills.
  patch("            strictMcpConfig: true,\n            disallowedTools: ['Skill'],\n            resume:",
    "            strictMcpConfig: true,\n            disallowedTools: [...(kicadSession.settings.skillsMode === 'native' ? [] : ['Skill']), ...(!kicadSession.settings.subagents ? ['Agent','Task'] : [])],\n            ...(kicadAgentDefinitions ? {agents: kicadAgentDefinitions} : {}),\n            resume:");
  patch("              'disable-slash-commands': null,\n              'debug': null,",
    "              ...(kicadSession.settings.skillsMode === 'native' ? {} : {'disable-slash-commands': null}),\n              'debug': null,");
  patch('includeDomain: false}) + ',
    'includeDomain: false, features: kicadPromptFeatures(kicadSession.settings), disabledSections: kicadSession.settings.disabledSections}) + ');
  patch("+ '\\n' + DEMAND_GUIDANCE + '", "+ '\\n' + kicadDemandGuidance(kicadSession.settings) + '");
  // capability_inspect resolves its target like capability_call (the catalog then
  // refuses anything that can change state). Built-in read-only targets (typed
  // actions with mutates:false) never prompt; external MCP tools keep asking,
  // because their readOnlyHint is the server's own claim.
  patch("if(tool==='mcp__kicad__capability_call'){", "if(tool==='mcp__kicad__capability_call'||tool==='mcp__kicad__capability_inspect'){");
  // Harness gate 2: Agent mode approves operational tools automatically, except
  // calls that change files outside the workspace, touch secrets, rewrite history
  // or pipe a remote script into a shell; those ask the user like default mode.
  patch("if(permissionModeParam==='acceptEdits' && !['AskUserQuestion','ExitPlanMode','EnterPlanMode'].includes(tool))return {behavior:'allow',updatedInput:input};",
    "if(permissionModeParam==='acceptEdits' && !['AskUserQuestion','ExitPlanMode','EnterPlanMode'].includes(tool) && !continuity.needsConfirmation(tool,input,cwdParam))return {behavior:'allow',updatedInput:input};");
  patch("if(READ_ONLY_EDA_TOOLS.includes(name)||(name==='mcp__kicad__local_memory'&&args?.operation==='read'))return {behavior:'allow',updatedInput:input};",
    "if(READ_ONLY_EDA_TOOLS.includes(name)||(name==='mcp__kicad__local_memory'&&args?.operation==='read')||id.startsWith('tool:')&&await kicadSession.catalog.isReadOnly(id,args))return {behavior:'allow',updatedInput:input};\n                    if(tool==='mcp__kicad__capability_inspect'&&id.startsWith('tool:'))return {behavior:'deny',message:'capability_inspect runs only read-only capabilities; report the change to the main agent.'};");
}

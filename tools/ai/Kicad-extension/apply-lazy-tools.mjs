// KiCad tools on demand in the chat. A conversation's SDK process starts with only kicad_load and the
// short always-on instructions; it is relaunched (same session) with the full KiCad tools and guidance
// when a user message is about KiCad work, after kicad_load, or when a resumed conversation used them.
// Runs last, on the fully patched sources.
import fs from 'node:fs';
import path from 'node:path';
export function applyLazyTools(root){
  function patch(file,before,after){const target=path.join(root,file),source=fs.readFileSync(target,'utf8');if(source.split(before).length!==2)throw Error('Lazy-tools anchor missing/ambiguous: '+file+' '+before.slice(0,80));fs.writeFileSync(target,source.replace(before,()=>after));}
  const sdk='src/services/claude/ClaudeSdkService.ts',agent='src/services/claude/ClaudeAgentService.ts';

  patch(sdk,'    onStderrError?: (error: LLMRequestError) => void;',`    onStderrError?: (error: LLMRequestError) => void;
    /** Attach the full KiCad tools and guidance; otherwise only kicad_load. */
    kicadTools?: boolean;
    /** Called when the model asks for the KiCad tools in a process that doesn't have them. */
    onKiCadLoad?: () => void;`);
  patch(sdk,'            mcpServers: await getKiCadSdkServers(cwdParam, (await this.configService.getAllSettings()).mcpServers ?? {}),',
    '            mcpServers: await getKiCadSdkServers(cwdParam, (await this.configService.getAllSettings()).mcpServers ?? {}, {tools: !!params.kicadTools, onLoad: params.onKiCadLoad}),');
  patch(sdk,"append: VS_CODE_APPEND_PROMPT + '","append: VS_CODE_APPEND_PROMPT + (params.kicadTools ? KICAD_TOOLS_PROMPT : '') + '");

  patch(agent,"import { ILogService } from '../logService';","import { ILogService } from '../logService';\nimport { rememberKiCadSession, sessionUsedKiCad, wantsKiCadTools } from '../../kicadRuntime';");
  patch(agent,'    needsRestart?: boolean;',`    needsRestart?: boolean;
    kicad?: boolean;      // KiCad tools are attached to this process
    kicadNext?: boolean;  // attach them when the next user message relaunches the process`);
  patch(agent,`        thinkingLevel: string | null
    ): Promise<void> {
        // 保存 thinkingLevel`,`        thinkingLevel: string | null,
        kicad?: boolean
    ): Promise<void> {
        // 保存 thinkingLevel`);
  patch(agent,'            const query = await this.spawnClaude(',`            // KiCad tools load on demand: requested explicitly, or already used by the stored conversation.
            const kicadTools = kicad ?? await sessionUsedKiCad(resume, cwd);
            const query = await this.spawnClaude(`);
  patch(agent,`                        errorType: error.type,
                    });
                }
            );`,`                        errorType: error.type,
                    });
                },
                {
                    tools: kicadTools,
                    onLoad: () => {
                        const active = this.channels.get(channelId);
                        if (active && !active.kicad) { active.kicadNext = true; active.needsRestart = true; }
                    }
                }
            );`);
  patch(agent,`        onStderrError?: SdkQueryParams['onStderrError']
    ): Promise<Query> {`,`        onStderrError?: SdkQueryParams['onStderrError'],
        kicad?: { tools: boolean; onLoad?: () => void }
    ): Promise<Query> {`);
  patch(agent,`            reasoningLevel: this.thinkingLevel
        });`,`            reasoningLevel: this.thinkingLevel,
            kicadTools: kicad?.tools,
            onKiCadLoad: kicad?.onLoad
        });`);
  patch(agent,`                thinkingLevel: selectedThinkingLevel, busy: false
            });`,`                thinkingLevel: selectedThinkingLevel, busy: false, kicad: kicadTools
            });`);
  patch(agent,"if ('session_id' in message && typeof message.session_id === 'string' && !(message as any).parent_tool_use_id) active.sessionId = message.session_id;",
    "if ('session_id' in message && typeof message.session_id === 'string' && !(message as any).parent_tool_use_id) active.sessionId = message.session_id;\n                        if (active.kicad) rememberKiCadSession(active.sessionId);");
  patch(agent,"        if(message.type === 'user' && channel.needsRestart){",`        // A KiCad request in a process without the KiCad tools relaunches the same conversation with them.
        if(message.type === 'user' && !channel.kicad && !channel.kicadNext && wantsKiCadTools(message)){
            channel.kicadNext = true;
            channel.needsRestart = true;
        }
        if(message.type === 'user' && channel.needsRestart){`);
  patch(agent,'                await this.launchClaude(channelId,previous.sessionId,previous.cwd,previous.model,previous.permissionMode,previous.thinkingLevel);',
    '                await this.launchClaude(channelId,previous.sessionId,previous.cwd,previous.model,previous.permissionMode,previous.thinkingLevel,!!(previous.kicad || previous.kicadNext));');
}

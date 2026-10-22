// SPDX-License-Identifier: AGPL-3.0-only
import {RuntimeJournal} from './shared/kicadDiagnostics';
import type { Options, Query } from '@anthropic-ai/claude-agent-sdk';

export interface OptimizePromptRequest {
    type: 'optimize_prompt';
    text: string;
    model: string;
}

export interface OptimizePromptResponse {
    type: 'optimize_prompt_response';
    text: string;
    model: string;
}

import { OPTIMIZER_SYSTEM as SYSTEM_PROMPT } from './kicadPrediction';

/** A separate, single-turn text request. It never uses the chat channel/history. */
export async function optimizePrompt(
    request: OptimizePromptRequest,
    config: { cwd: string; cliPath: string; env: Record<string, string> },
    signal: AbortSignal,
    run: (input: { prompt: string; options: Options }) => Query,
    timeoutMs = 90_000,
    policy?: { systemPrompt: string; allowEmpty?: boolean }
): Promise<OptimizePromptResponse> {
    if (typeof request.text !== 'string' || !request.text.trim()) throw new Error('请先输入需要优化的提示词。');
    if (typeof request.model !== 'string' || !request.model.trim()) throw new Error('请先选择模型。');
    if (signal.aborted) throw new Error('已取消提示词优化。');

    const journal=new RuntimeJournal('extension',config.cwd),started=Date.now();
    const name=policy?.allowEmpty?'draft-prediction':'prompt-optimizer';
    void journal.record({category:'ai',phase:'request',status:'started',name,model:request.model});
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    let query: Query | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (() => void) | undefined;
    try {
        const aborted = new Promise<never>((_, reject) => {
            rejectAbort = () => reject(new Error(timedOut ? '提示词优化超时，请重试。' : '已取消提示词优化。'));
            controller.signal.addEventListener('abort', rejectAbort, { once: true });
        });
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        const options: Options = {
            cwd: config.cwd,
            env: config.env,
            pathToClaudeCodeExecutable: config.cliPath,
            model: request.model,
            systemPrompt: policy?.systemPrompt ?? SYSTEM_PROMPT,
            tools: [],
            mcpServers: {},
            strictMcpConfig: true,
            settingSources: [],
            hooks: {},
            plugins: [],
            persistSession: false,
            maxTurns: 1,
            maxThinkingTokens: 0,
            abortController: controller,
            canUseTool: async () => ({ behavior: 'deny', message: '提示词优化仅生成文本。' }),
            stderr: () => {},
            extraArgs: { 'disable-slash-commands': null }
        };
        query = run({ prompt: request.text, options });
        const result = await Promise.race([
            (async () => {
                let text = '';
                for await (const message of query!) {
                    if (message.type === 'assistant') {
                        if (message.error) throw new Error(`模型请求失败：${message.error}`);
                        for (const block of message.message.content) {
                            if (block.type === 'tool_use') throw new Error('模型尝试调用工具，已拒绝本次优化。');
                            if (block.type === 'text') text += block.text;
                        }
                    }
                    if (message.type === 'result') {
                        if (message.subtype !== 'success' || message.is_error) {
                            throw new Error(message.subtype === 'success' ? message.result : message.errors.join('\n'));
                        }
                        text = message.result || text;
                    }
                }
                if (!text.trim() && !policy?.allowEmpty) throw new Error('模型未返回优化结果，请重试。');
                return { type: 'optimize_prompt_response' as const, text: text.trim(), model: request.model };
            })(),
            aborted
        ]);
        await journal.record({category:'ai',phase:'result',status:'returned',name,model:request.model,durationMs:Date.now()-started});
        return result;
    } catch(error) {
        await journal.record({category:'ai',phase:'error',status:'error',name,model:request.model,durationMs:Date.now()-started,error});throw error;
    } finally {
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
        // Abort stops the CLI even while its iterator is awaiting a model reply.
        controller.abort();
        if (query) void query.return().catch(() => {});
    }
}

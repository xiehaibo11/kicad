// SPDX-License-Identifier: AGPL-3.0-only
import { getKiCadMcpServer } from "./kicadRuntime";
import {
  PREDICTION_SYSTEM,
  predictionContext,
  predictionText,
  type ConversationLine,
} from "./kicadPrediction";
import { optimizePrompt } from "./kicadPromptOptimizer";
import type { Options, Query } from "@anthropic-ai/claude-agent-sdk";
export interface PredictDraftRequest {
  type: "predict_draft";
  model: string;
  history: ConversationLine[];
}
export interface PredictDraftResponse {
  type: "predict_draft_response";
  text: string;
  model: string;
}
export interface ToolReferencesRequest {
  type: "tool_references";
}
export interface ToolReference {
  name: string;
  description: string;
  schema: string;
  access: string;
}
export interface ToolReferencesResponse {
  type: "tool_references_response";
  tools: ToolReference[];
}
export async function predictDraft(
  request: PredictDraftRequest,
  config: { cwd: string; cliPath: string; env: Record<string, string> },
  signal: AbortSignal,
  run: (input: { prompt: string; options: Options }) => Query,
): Promise<PredictDraftResponse> {
  const result = await optimizePrompt(
    {
      type: "optimize_prompt",
      text: predictionContext(request.history),
      model: request.model,
    },
    config,
    signal,
    run,
    60_000,
    { systemPrompt: PREDICTION_SYSTEM, allowEmpty: true },
  );
  return {
    type: "predict_draft_response",
    model: request.model,
    text: predictionText(result.text),
  };
}
/** Only MCP initialize/tools.list; no tools.call and no KiCad connection writes. */
export async function toolReferences(
  signal: AbortSignal,
): Promise<ToolReferencesResponse> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/stdio.js"
  );
  const server = getKiCadMcpServer();
  const client = new Client({
    name: "kicad-composer-catalog",
    version: "1.0.0",
  });
  const child = new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
      ...server.env,
    },
    stderr: "ignore",
  });
  const close = () => {
    void client.close().catch(() => {});
  };
  const timer = setTimeout(close, 15_000);
  signal.addEventListener("abort", close, { once: true });
  try {
    if (signal.aborted) throw new Error("已取消读取工具目录");
    await client.connect(child);
    const tools: ToolReference[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      tools.push(
        ...page.tools.map((tool) => ({
          name: `mcp__kicad__${tool.name}`,
          description: tool.description ?? "",
          schema: JSON.stringify(tool.inputSchema, null, 2),
          access:
            tool.annotations?.readOnlyHint === true
              ? "只读"
              : "依参数可能修改，请查看工具说明",
        })),
      );
      cursor = page.nextCursor;
    } while (cursor && !signal.aborted);
    if (signal.aborted) throw new Error("已取消读取工具目录");
    return { type: "tool_references_response", tools };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", close);
    await client.close().catch(() => {});
    await child.close().catch(() => {});
  }
}

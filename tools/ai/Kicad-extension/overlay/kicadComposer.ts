// SPDX-License-Identifier: AGPL-3.0-only
import { getKiCadNativeTools } from "./kicadRuntime";
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
/** Read the shared in-process definitions without executing any tools. */
export async function toolReferences(
  signal: AbortSignal,
): Promise<ToolReferencesResponse> {
  if (signal.aborted) throw new Error("已取消读取工具目录");
  const bindings = await getKiCadNativeTools();
  if (signal.aborted) throw new Error("已取消读取工具目录");
  return {
    type: "tool_references_response",
    tools: bindings.map((tool: any) => ({
      name: `mcp__kicad__${tool.name}`,
      description: tool.description ?? "",
      schema: JSON.stringify(tool.inputSchema, null, 2),
      access: tool.annotations?.readOnlyHint === true
        ? "只读" : "依参数可能修改，请查看工具说明",
    })),
  };
}

// SPDX-License-Identifier: MIT
import { Effect } from "effect";
import { Stream } from "effect";
import { LLM } from "@/session/llm";
import { SessionID, MessageID } from "@/session/schema";
import { Provider } from "@/provider/provider";
import { MCP } from "@/mcp";
import {
  PREDICTION_SYSTEM,
  OPTIMIZER_SYSTEM,
  predictionContext,
  predictionText,
} from "@/kicad-prediction";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { InstanceHttpApi } from "../api";
import { ComposerError, ComposerPayload } from "../groups/kicad-composer";

function generateComposer(
  payload: typeof ComposerPayload.Type,
  provider: Provider.Interface,
  llm: LLM.Interface,
): Effect.Effect<{ text: string; model: string }, ComposerError> {
  return Effect.gen(function* () {
    const parsed = Provider.parseModel(payload.model);
    const model = yield* provider.getModel(parsed.providerID, parsed.modelID);
    const sessionID = SessionID.descending();
    const prompt =
      payload.mode === "predict"
        ? predictionContext(payload.history)
        : payload.text;
    const system =
      payload.mode === "predict" ? PREDICTION_SYSTEM : OPTIMIZER_SYSTEM;
    let completed = false;
    // Reuse native provider routing/auth/headers while bypassing all Session persistence and agent execution.
    const text = yield* llm
      .stream({
        user: {
          id: MessageID.ascending(),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: "kicad-composer",
          model: parsed,
        },
        sessionID,
        model,
        agent: {
          name: "kicad-composer",
          mode: "subagent",
          prompt: system,
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "deny" }],
        },
        system: [],
        messages: [{ role: "user", content: prompt }],
        tools: {},
        toolChoice: "none",
        retries: 0,
      })
      .pipe(
        Stream.mapEffect((event) => {
          if (event.type === "provider-error")
            return Effect.fail(new ComposerError({ message: event.message }));
          if (event.type === "tool-call" || event.type === "tool-input-start")
            return Effect.fail(
              new ComposerError({
                message: "生成请求尝试调用工具，已拒绝。",
              }),
            );
          if (event.type === "finish" || event.type === "step-finish") {
            if (event.reason !== "stop")
              return Effect.fail(new ComposerError({
                message: `模型输出未完整结束（${event.reason}），草稿未替换，请重试。`,
              }));
            if (event.type === "finish") completed = true;
          }
          return Effect.succeed(event.type === "text-delta" ? event.text : "");
        }),
        Stream.runFold(
          () => "",
          (result, part) => result + part,
        ),
        Effect.timeout("60 seconds"),
      );
    if (!completed)
      return yield* new ComposerError({ message: "模型连接提前结束，草稿未替换，请重试。" });
    if (payload.mode === "optimize" && !text.trim())
      return yield* new ComposerError({
        message: "模型未返回优化结果，草稿未替换。",
      });
    return {
      text: payload.mode === "predict" ? predictionText(text) : text.trim(),
      model: payload.model,
    };
  }).pipe(
    Effect.mapError((error) =>
      error instanceof ComposerError
        ? error
        : new ComposerError({ message: String(error) }),
    ),
  );
}

export const kicadComposerHandlers = HttpApiBuilder.group(
  InstanceHttpApi,
  "kicad-composer",
  (handlers) =>
    Effect.gen(function* () {
      const provider = yield* Provider.Service;
      const mcp = yield* MCP.Service;
      const llm = yield* LLM.Service;
      return handlers
        .handle("health", () => Effect.gen(function* () {
          const status = yield* mcp.status();
          const tools = yield* mcp.tools();
          const tool = Object.values(tools).find(item => item.def.name === "kicad_health");
          if (!tool) return {text: "KiCad MCP 未连接或未提供健康检查。\n" + JSON.stringify(status, null, 2)};
          const result = yield* Effect.tryPromise({
            try: () => tool.client.callTool({name: "kicad_health", arguments: {}}, undefined, {timeout: 15000}),
            catch: error => new ComposerError({message: String(error)}),
          });
          const data = result.structuredContent ?? JSON.parse(String((result.content as {type:string;text?:string}[]).find(item => item.type === "text")?.text ?? "{}"));
          const health = (data as {data?: Record<string, any>}).data ?? {};
          return {text: ["MCP: " + JSON.stringify(status), "KiCad CLI: " + (health.kicadCli?.available ? health.kicadCli.version : "不可用"), "KiCad IPC: " + (health.ipc?.available ? "已连接" : "未连接"), "文档: " + JSON.stringify(health.documents ?? {}), "缺少的可选工具: " + (health.externalTools ?? []).filter((item: {available:boolean}) => !item.available).map((item:{name:string}) => item.name).join(", ")].join("\n")};
        }))
        .handle("generate", (ctx: { payload: typeof ComposerPayload.Type }) =>
          generateComposer(ctx.payload, provider, llm),
        )
        .handle("tools", () =>
          Effect.gen(function* () {
            const tools = yield* mcp.tools();
            return {
              tools: Object.entries(tools).map(([name, tool]) => ({
                name,
                description: tool.def.description ?? "",
                schema: JSON.stringify(tool.def.inputSchema, null, 2),
                access:
                  tool.def.annotations?.readOnlyHint === true
                    ? "只读"
                    : "依参数可能修改，请查看工具说明",
              })),
            };
          }),
        );
    }),
);

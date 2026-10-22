// SPDX-License-Identifier: MIT
import { Effect } from "effect";
import { Stream } from "effect";
import { LLM } from "@/session/llm";
import { SessionID, MessageID } from "@/session/schema";
import { Provider } from "@/provider/provider";
import { MCP } from "@/mcp";
import { Plugin } from "@/plugin";
import { ToolRegistry } from "@/tool/registry";
import { InstanceState } from "@/effect/instance-state";
import {
  PREDICTION_SYSTEM,
  OPTIMIZER_SYSTEM,
  predictionContext,
  predictionText,
} from "@/kicad-prediction";
import { KicadStatus, documentsFrom } from "@/kicad/status";
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
                message: "The model tried to call a tool while drafting; the request was rejected.",
              }),
            );
          if (event.type === "finish" || event.type === "step-finish") {
            if (event.reason !== "stop")
              return Effect.fail(new ComposerError({
                message: `The model response ended early (${event.reason}); the draft was not replaced. Try again.`,
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
      return yield* new ComposerError({ message: "The model connection closed early; the draft was not replaced. Try again." });
    if (payload.mode === "optimize" && !text.trim())
      return yield* new ComposerError({
        message: "The model returned no optimized text; the draft was not replaced.",
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
      const plugin = yield* Plugin.Service;
      const registry = yield* ToolRegistry.Service;
      return handlers
        .handle("health", () => Effect.gen(function* () {
          const context = yield* InstanceState.context;
          const plugins = yield* plugin.list();
          const tool = plugins.map(item => item.tool?.kicad_health).find(Boolean);
          if (!tool) return {text: "KiCad tools are not loaded. Start Kicad with its launcher so the native tool plugin is registered."};
          const result = yield* Effect.tryPromise({
            try: () => tool.execute({}, {
              sessionID:SessionID.descending(),messageID:MessageID.ascending(),agent:"kicad-health",
              directory:context.directory,worktree:context.worktree,abort:AbortSignal.timeout(15000),
              metadata:()=>{},ask:async()=>{throw new Error("The connection check is read-only");}
            }),
            catch: error => new ComposerError({message: String(error)}),
          });
          const data = yield* Effect.try({
            try:()=>JSON.parse(typeof result === "string" ? result : result.output),
            catch:error=>new ComposerError({message:String(error)})
          });
          // KiCad tool calls run one at a time; a check that waited behind a long task is cancelled by its timeout.
          if(data.error?.code === "CANCELLED") return yield* new ComposerError({message:"KiCad is busy with another tool call; run the check again when it finishes."});
          if(!data.ok) return yield* new ComposerError({message:data.error?.message || "KiCad connection check failed"});
          const health = data.data ?? {};
          const documents = documentsFrom(health.documents?.data?.documents, "pcb").map(item => item.name);
          const missing = (health.externalTools ?? []).filter((item: {available:boolean}) => !item.available).map((item:{name:string}) => item.name);
          return {text: [
            "Tools: in-process native KiCad tools",
            "kicad-cli: " + (health.kicadCli?.available ? health.kicadCli.version : "not found" + (health.kicadCli?.error ? " (" + health.kicadCli.error + ")" : "")),
            "IPC: " + (health.ipc?.available ? "connected" + (health.ipc.socket ? " (" + health.ipc.socket + ")" : "") : "not running — open the project in KiCad, or use CLI-only checks"),
            "Open boards: " + (documents.length ? documents.join(", ") : health.documents?.ok === false ? "unavailable (" + (health.documents.error?.message ?? "error") + ")" : "none"),
            "Missing optional tools: " + (missing.length ? missing.join(", ") : "none"),
          ].join("\n")};
        }))
        .handle("status", () => Effect.gen(function* () {
          const context = yield* InstanceState.context;
          const plugins = yield* plugin.list();
          const tools = plugins.map(item => item.tool).find(item => item?.kicad_system && item?.kicad_document) ?? {};
          return yield* Effect.tryPromise({
            try: () => KicadStatus.status(tools as any, {directory: context.directory, worktree: context.worktree}),
            catch: error => new ComposerError({message: String(error)}),
          });
        }))
        .handle("generate", (ctx: { payload: typeof ComposerPayload.Type }) =>
          generateComposer(ctx.payload, provider, llm),
        )
        .handle("tools", () =>
          Effect.gen(function* () {
            const tools = yield* mcp.tools();
            const native = yield* registry.all();
            // Plugin tools carry the shared runtime's annotations (all actions read-only, open world, ...).
            const plugins = yield* plugin.list();
            const annotations = new Map(plugins.flatMap(item => Object.entries(item.tool ?? {})).map(([id, def]) => [id, (def as {annotations?: {readOnlyHint?: boolean}}).annotations]));
            return {
              tools: [...native.map(tool => ({
                name:tool.id,description:tool.description,schema:JSON.stringify(tool.jsonSchema ?? {},null,2),
                access:annotations.get(tool.id)?.readOnlyHint === true ? "read-only" : "may modify, depending on arguments"
              })), ...Object.entries(tools).map(([name, tool]) => ({
                name,
                description: tool.def.description ?? "",
                schema: JSON.stringify(tool.def.inputSchema, null, 2),
                access:
                  tool.def.annotations?.readOnlyHint === true
                    ? "read-only"
                    : "may modify, depending on arguments",
              }))],
            };
          }),
        );
    }),
);

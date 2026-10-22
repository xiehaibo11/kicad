// SPDX-License-Identifier: MIT
import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  OpenApi,
} from "effect/unstable/httpapi";
import { Authorization } from "../middleware/authorization";
import { InstanceContextMiddleware } from "../middleware/instance-context";
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "../middleware/workspace-routing";
export const ComposerPayload = Schema.Struct({
  mode: Schema.Literals(["predict", "optimize"]),
  model: Schema.String,
  text: Schema.String,
  history: Schema.Array(
    Schema.Struct({
      role: Schema.Literals(["user", "assistant"]),
      text: Schema.String,
    }),
  ),
});
export class ComposerError extends Schema.ErrorClass<ComposerError>(
  "KiCadComposerError",
)({ message: Schema.String }, { httpApiStatus: 400 }) {}
const KiCadDocument = Schema.Struct({
  kind: Schema.Literals(["pcb", "schematic"]),
  name: Schema.String,
  project: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
});
export const KiCadStatus = Schema.Struct({
  tools: Schema.Boolean,
  cli: Schema.Struct({
    available: Schema.Boolean,
    version: Schema.optional(Schema.String),
    error: Schema.optional(Schema.String),
  }),
  ipc: Schema.Struct({
    available: Schema.Boolean,
    socket: Schema.optional(Schema.String),
    error: Schema.optional(Schema.String),
  }),
  documents: Schema.Array(KiCadDocument),
  documentsError: Schema.optional(Schema.String),
  projects: Schema.Array(Schema.String),
  checkedAt: Schema.Number,
});
export const KiCadComposerApi = HttpApi.make("kicad-composer").add(
  HttpApiGroup.make("kicad-composer")
    .add(
      HttpApiEndpoint.get("health", "/kicad/health", {
        query: WorkspaceRoutingQuery,
        success: Schema.Struct({text: Schema.String}),
        error: ComposerError,
      }),
      HttpApiEndpoint.get("status", "/kicad/status", {
        query: WorkspaceRoutingQuery,
        success: KiCadStatus,
        error: ComposerError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "kicad.status",
          summary: "Read-only KiCad CLI, IPC and open-document status for the workbench",
        }),
      ),
      HttpApiEndpoint.post("generate", "/kicad/composer", {
        query: WorkspaceRoutingQuery,
        payload: ComposerPayload,
        success: Schema.Struct({ text: Schema.String, model: Schema.String }),
        error: ComposerError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "kicad.composer.generate",
          summary:
            "Generate an editable draft without sending or executing tools",
        }),
      ),
      HttpApiEndpoint.get("tools", "/kicad/tool-references", {
        query: WorkspaceRoutingQuery,
        success: Schema.Struct({
          tools: Schema.Array(
            Schema.Struct({
              name: Schema.String,
              description: Schema.String,
              schema: Schema.String,
              access: Schema.String,
            }),
          ),
        }),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "kicad.composer.tools",
          summary: "List native and external tool references without calling tools",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
);

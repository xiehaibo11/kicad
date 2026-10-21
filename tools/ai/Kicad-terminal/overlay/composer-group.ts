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
export const KiCadComposerApi = HttpApi.make("kicad-composer").add(
  HttpApiGroup.make("kicad-composer")
    .add(
      HttpApiEndpoint.get("health", "/kicad/health", {
        query: WorkspaceRoutingQuery,
        success: Schema.Struct({text: Schema.String}),
        error: ComposerError,
      }),
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
          summary: "List real MCP tool references without calling tools",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
);

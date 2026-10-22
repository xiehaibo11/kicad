import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { createMemo, For, Show } from "solid-js"
import type { BuiltinTuiPlugin } from "../builtins"
import { useKiCadStatus } from "../../kicad/status"
import {
  CONNECTION_LABEL,
  basename,
  isKiCadTool,
  middle,
  sessionEvidence,
  summarizePart,
  type ToolState,
} from "../../kicad/summary"

const id = "internal:sidebar-kicad"
const WIDTH = 36

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const kicad = useKiCadStatus()
  const evidence = createMemo(() => {
    const calls = props.api.state.session
      .messages(props.session_id)
      .flatMap((message) => props.api.state.part(message.id))
      .filter((part): part is ToolPart => part.type === "tool" && isKiCadTool(part.tool))
      .map((part) => summarizePart(part))
    return sessionEvidence(calls)
  })
  const icon = (state: ToolState) => {
    if (state === "ok") return { glyph: "✓", color: theme().success }
    if (state === "issues") return { glyph: "!", color: theme().warning }
    if (state === "failed") return { glyph: "✗", color: theme().error }
    return { glyph: "·", color: theme().textMuted }
  }
  const dotColor = () => {
    const state = kicad.connection()
    if (state === "connected") return theme().success
    if (state === "cli") return theme().warning
    if (state === "unavailable") return theme().error
    return theme().textMuted
  }

  return (
    <box>
      <text fg={theme().text}>
        <b>KiCad</b>
      </text>
      <text fg={theme().textMuted} wrapMode="none">
        <span style={{ fg: dotColor() }}>●</span> {CONNECTION_LABEL[kicad.connection()]}
        <Show when={kicad.status()?.cli.version}>{(version) => <span> · CLI {version()}</span>}</Show>
      </text>
      <For each={(kicad.status()?.documents ?? []).slice(0, 3)}>
        {(doc) => (
          <text fg={theme().text} wrapMode="none">
            <span style={{ fg: theme().accent }}>{doc.kind === "pcb" ? "PCB" : "SCH"}</span> {middle(doc.name, WIDTH - 4)}
          </text>
        )}
      </For>
      <Show when={evidence().checks.length}>
        <box paddingTop={1}>
          <text fg={theme().text}>
            <b>Checks</b>
          </text>
          <For each={evidence().checks}>
            {(check) => (
              <text fg={theme().textMuted} wrapMode="word">
                <span style={{ fg: icon(check.summary.state).color }}>{icon(check.summary.state).glyph}</span>{" "}
                <span style={{ fg: theme().text }}>{check.name}</span> {check.summary.detail ?? ""}
              </text>
            )}
          </For>
        </box>
      </Show>
      <Show when={evidence().outputs.length}>
        <box paddingTop={1}>
          <text fg={theme().text}>
            <b>Outputs</b>
          </text>
          <For each={evidence().outputs}>
            {(file) => (
              <text fg={theme().textMuted} wrapMode="none">
                {middle(basename(file), WIDTH - 2)}
              </text>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin

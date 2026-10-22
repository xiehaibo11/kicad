import type { ToolPart } from "@opencode-ai/sdk/v2"
import type { JSX } from "solid-js"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { summarizePart, summarizeTool, type ToolSummary } from "../../kicad/summary"

type InlineToolProps = {
  icon: string
  iconColor?: import("@opentui/core").RGBA
  complete: unknown
  pending: string
  spinner?: boolean
  children: JSX.Element
  part: ToolPart
  onClick?: () => void
}
type BlockToolProps = { title?: string; children: JSX.Element; onClick?: () => void; part?: ToolPart }

const RAW_LINES = 40

// KiCad tool calls as one line: the native action, the document and an honest result summary.
// The transcript's own InlineTool/BlockTool are passed in so spacing and hover match other tools.
export function KiCadTool(props: {
  input: Record<string, unknown>
  tool: string
  output?: string
  part: ToolPart
  InlineTool: (props: InlineToolProps) => JSX.Element
  BlockTool: (props: BlockToolProps) => JSX.Element
}) {
  const { theme } = useTheme()
  const [expanded, setExpanded] = createSignal(false)
  const [full, setFull] = createSignal<ToolSummary>()
  const summary = createMemo(() => full() ?? summarizePart(props.part))

  // Oversized results live in OpenCode's tool-output folder; summarize the saved JSON once.
  createEffect(() => {
    const saved = summarizePart(props.part).savedOutput
    if (!saved || full()) return
    void Bun.file(saved)
      .text()
      .then((text) => {
        const next = summarizeTool({ tool: props.tool, input: props.input, status: "completed", output: text })
        if (next.state !== "unknown") setFull(next)
      })
      .catch(() => {})
  })

  const look = createMemo(() => {
    switch (summary().state) {
      case "ok":
        return { icon: "✓", color: theme.success }
      case "issues":
        return { icon: "!", color: theme.warning }
      case "failed":
        return { icon: "✗", color: theme.error }
      default:
        return { icon: "◆", color: theme.primary }
    }
  })
  const raw = createMemo(() => {
    if (!expanded()) return ""
    const value = summary().result ?? props.output
    if (value === undefined) return ""
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2)
    const lines = text.split("\n")
    return lines.length > RAW_LINES ? [...lines.slice(0, RAW_LINES), `… ${lines.length - RAW_LINES} more lines`].join("\n") : text
  })
  const line = () => (
    <>
      <span style={{ fg: theme.primary }}>KiCad</span> <span style={{ fg: theme.text }}>{summary().action}</span>
      <Show when={summary().target}>{(target) => <span> {target()}</span>}</Show>
      <Show when={summary().detail}>
        {(detail) => (
          <span style={{ fg: summary().state === "failed" ? theme.error : theme.textMuted }}>
            {detail().startsWith("→") ? " " : " — "}
            {detail()}
          </span>
        )}
      </Show>
    </>
  )

  return (
    <Show
      when={expanded() && raw()}
      fallback={
        <props.InlineTool
          icon={look().icon}
          iconColor={look().color}
          complete={props.part.state.status === "completed"}
          pending={`KiCad ${summary().action}…`}
          spinner={props.part.state.status === "running"}
          part={props.part}
          onClick={props.part.state.status === "completed" ? () => setExpanded(true) : undefined}
        >
          {line()}
        </props.InlineTool>
      }
    >
      <props.BlockTool part={props.part} onClick={() => setExpanded(false)}>
        <text fg={theme.text}>
          <span style={{ fg: look().color }}>{look().icon}</span> {line()}
        </text>
        <text fg={theme.textMuted}>{raw()}</text>
        <text fg={theme.textMuted}>Click to collapse</text>
      </props.BlockTool>
    </Show>
  )
}

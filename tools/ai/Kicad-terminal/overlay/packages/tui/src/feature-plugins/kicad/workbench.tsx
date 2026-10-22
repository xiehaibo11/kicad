import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { KicadProduct } from "@opencode-ai/core/kicad/product"
import type { BuiltinTuiPlugin } from "../builtins"
import { useKiCadStatus } from "../../kicad/status"
import { middle, type Connection, type KiCadStatus } from "../../kicad/summary"
import { usePromptRef } from "../../context/prompt"
import { useTuiConfig } from "../../config"
import { useTheme } from "../../context/theme"
import { useUpdateNotification } from "../../context/update-notification"

const id = "internal:kicad-workbench"

// Slash commands: kicad-health is a TUI command; the others are prompt templates from the session runtime.
export const QUICK_TASKS = [
  { command: "/kicad-health", label: "Connection check" },
  { command: "/kicad-drc", label: "DRC & ERC review" },
  { command: "/kicad-fab", label: "Fabrication outputs" },
  { command: "/kicad-route", label: "Fanout & routing" },
  { command: "/kicad-step", label: "3D / STEP collisions" },
] as const

const BRAND = { blue: "#2b33b7", blueDim: "#232a96", orange: "#ff6d00", white: "#ffffff" }

export function KiBadge() {
  return (
    <text bg={BRAND.blue} fg={BRAND.white} selectable={false}>
      <b>K</b>
      <span style={{ fg: BRAND.orange }}>
        <b>i</b>
      </span>
    </text>
  )
}

function useDot() {
  const { theme } = useTheme()
  return (state: Connection): { glyph: string; color: RGBA } => {
    if (state === "connected") return { glyph: "●", color: theme.success }
    if (state === "cli") return { glyph: "●", color: theme.warning }
    if (state === "unavailable") return { glyph: "○", color: theme.error }
    return { glyph: "○", color: theme.textMuted }
  }
}

function StatusRows(props: { status?: KiCadStatus; width: number; connection: Connection }) {
  const { theme } = useTheme()
  const dot = useDot()
  const value = Math.max(8, props.width - 13)
  const ipc = createMemo(() => {
    const status = props.status
    if (!status) return { state: "checking" as Connection, text: "checking…" }
    if (!status.tools) return { state: "unavailable" as Connection, text: "tools not loaded" }
    if (status.ipc.available) return { state: "connected" as Connection, text: "connected" }
    return { state: "offline" as Connection, text: "not running" }
  })
  const cli = createMemo(() => {
    const status = props.status
    if (!status || !status.tools) return { state: "checking" as Connection, text: status ? "—" : "checking…" }
    if (status.cli.available) return { state: "connected" as Connection, text: status.cli.version ?? "available" }
    return { state: "unavailable" as Connection, text: "not found" }
  })
  const files = createMemo(() => {
    const status = props.status
    if (!status) return []
    const open = status.documents.map((doc) => ({ tag: doc.kind === "pcb" ? "PCB" : "SCH", name: doc.name, muted: false }))
    if (open.length) return open.slice(0, 3)
    return status.projects.slice(0, 2).map((name) => ({ tag: "PRJ", name, muted: true }))
  })
  return (
    <box flexShrink={0} width={props.width}>
      <text fg={theme.text} wrapMode="none">
        <span style={{ fg: dot(ipc().state).color }}>{dot(ipc().state).glyph}</span> IPC{"       "}
        <span style={{ fg: ipc().state === "connected" ? theme.text : theme.textMuted }}>{middle(ipc().text, value)}</span>
      </text>
      <text fg={theme.text} wrapMode="none">
        <span style={{ fg: dot(cli().state).color }}>{dot(cli().state).glyph}</span> kicad-cli{" "}
        <span style={{ fg: cli().state === "connected" ? theme.text : theme.textMuted }}>{middle(cli().text, value)}</span>
      </text>
      <Show
        when={files().length}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">
            {props.status?.tools === false
              ? "  start Kicad with its launcher"
              : props.connection === "connected"
                ? "  no open board or schematic"
                : "  open a project in KiCad"}
          </text>
        }
      >
        <For each={files()}>
          {(file) => (
            <text fg={file.muted ? theme.textMuted : theme.text} wrapMode="none">
              <span style={{ fg: theme.accent }}>{file.tag}</span> {middle(file.name, props.width - 4)}
            </text>
          )}
        </For>
      </Show>
    </box>
  )
}

function QuickTasks(props: { width: number }) {
  const { theme } = useTheme()
  const prompt = usePromptRef()
  const [hover, setHover] = createSignal<string>()
  const commandWidth = Math.max(...QUICK_TASKS.map((task) => task.command.length)) + 1
  return (
    <box flexShrink={0} width={props.width}>
      <For each={QUICK_TASKS}>
        {(task) => (
          <box
            flexDirection="row"
            backgroundColor={hover() === task.command ? theme.backgroundElement : undefined}
            onMouseOver={() => setHover(task.command)}
            onMouseOut={() => setHover(undefined)}
            onMouseUp={() => {
              const ref = prompt.current
              if (!ref) return
              ref.set({ input: task.command + " ", parts: [] })
              ref.focus()
            }}
          >
            <text fg={theme.primary} wrapMode="none" width={commandWidth} flexShrink={0}>
              {task.command}
            </text>
            <text fg={theme.textMuted} wrapMode="none">
              {middle(task.label, Math.max(4, props.width - commandWidth))}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}

export function Workbench(props: { api: TuiPluginApi }) {
  const { theme } = useTheme()
  const kicad = useKiCadStatus()
  const update = useUpdateNotification()
  const available = createMemo(() => {
    const notice = update.notification()
    return notice?.type === "available" ? notice.version : undefined
  })
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const width = createMemo(() => {
    const configured = tuiConfig.prompt?.max_width
    const max = configured === "auto" ? Math.max(75, Math.floor(dimensions().width * 0.7)) : (configured ?? 75)
    return Math.max(30, Math.min(max, dimensions().width - 4))
  })
  const inner = createMemo(() => width() - 4)
  const wide = createMemo(() => inner() >= 60)
  const compact = createMemo(() => dimensions().height < 30)
  const column = createMemo(() => (wide() ? Math.floor((inner() - 3) / 2) : inner()))

  return (
    <box
      width={width()}
      flexShrink={0}
      border={true}
      borderStyle="rounded"
      borderColor={theme.border}
      paddingLeft={1}
      paddingRight={1}
      gap={compact() ? 0 : 1}
    >
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box flexDirection="row" gap={1} flexShrink={1}>
          <KiBadge />
          <text fg={theme.text} wrapMode="none">
            <b>Kicad</b>
            <Show when={wide()}>
              <span style={{ fg: theme.textMuted }}> · AI design terminal for KiCad</span>
            </Show>
          </text>
        </box>
        <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
          v{KicadProduct.version}
          <Show when={available()}>{(version) => <span style={{ fg: theme.accent }}> → {version()}</span>}</Show>
        </text>
      </box>
      <Switch>
        <Match when={wide()}>
          <box flexDirection="row" gap={3} flexShrink={0}>
            <box flexShrink={0}>
              <text fg={theme.text} wrapMode="none">
                <b>KiCad</b>
              </text>
              <StatusRows status={kicad.status()} width={column()} connection={kicad.connection()} />
            </box>
            <box flexShrink={0}>
              <text fg={theme.text} wrapMode="none">
                <b>Quick tasks</b>
              </text>
              <QuickTasks width={column()} />
            </box>
          </box>
        </Match>
        <Match when={true}>
          <box flexShrink={0}>
            <StatusRows status={kicad.status()} width={column()} connection={kicad.connection()} />
            <text fg={theme.textMuted} wrapMode="none">
              Type <span style={{ fg: theme.primary }}>/kicad-</span> for quick tasks
            </text>
          </box>
        </Match>
      </Switch>
    </box>
  )
}

/** Compact connection badge for the prompt's right side. */
export function KiCadBadge(props: { api: TuiPluginApi; session?: boolean }) {
  const { theme } = useTheme()
  const kicad = useKiCadStatus()
  const dot = useDot()
  const board = createMemo(() => {
    if (!props.session || kicad.connection() !== "connected") return undefined
    const doc = kicad.status()?.documents.find((item) => item.kind === "pcb") ?? kicad.status()?.documents[0]
    return doc ? middle(doc.name, 28) : undefined
  })
  return (
    <box flexDirection="row" flexShrink={0} onMouseUp={() => props.api.keymap.dispatchCommand("kicad.health")}>
      <text fg={theme.textMuted} wrapMode="none">
        <span style={{ fg: dot(kicad.connection()).color }}>{dot(kicad.connection()).glyph}</span>
        <span style={{ fg: theme.text }}> KiCad</span>
        <Show when={board()}>{(name) => <span> {name()}</span>}</Show>
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
    slots: {
      home_logo() {
        return <Workbench api={api} />
      },
      home_prompt_right() {
        return <KiCadBadge api={api} />
      },
      session_prompt_right() {
        return <KiCadBadge api={api} session={true} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin

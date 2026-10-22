import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Match, Show, Switch } from "solid-js"
import { abbreviateHome } from "../../runtime"
import { useTuiPaths } from "../../context/runtime"
import { useHomeSessionDestination } from "../../routes/home/session-destination"
import { useKiCadStatus } from "../../kicad/status"
import { CONNECTION_LABEL } from "../../kicad/summary"
import { useUpdateNotification } from "../../context/update-notification"

const id = "internal:home-footer"

function Directory(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const destination = useHomeSessionDestination()
  const paths = useTuiPaths()
  const dir = createMemo(() => {
    const selected = destination?.destination()
    if (!selected || selected.type === "new") return
    const out = abbreviateHome(selected.directory, paths.home)
    const branch =
      selected.directory === (props.api.state.path.directory || paths.cwd) ? props.api.state.vcs?.branch : undefined
    if (branch) return out + ":" + branch
    return out
  })

  return (
    <Show when={dir()}>
      {(value) => (
        <text fg={theme().textMuted} wrapMode="none" overflow="hidden" flexShrink={1}>
          {value()}
        </text>
      )}
    </Show>
  )
}

function Mcp(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.mcp())
  const has = createMemo(() => list().length > 0)
  const err = createMemo(() => list().some((item) => item.status === "failed"))
  const count = createMemo(() => list().filter((item) => item.status === "connected").length)

  return (
    <Show when={has()}>
      <box gap={1} flexDirection="row" flexShrink={0}>
        <text fg={theme().text}>
          <Switch>
            <Match when={err()}>
              <span style={{ fg: theme().error }}>⊙ </span>
            </Match>
            <Match when={true}>
              <span style={{ fg: count() > 0 ? theme().success : theme().textMuted }}>⊙ </span>
            </Match>
          </Switch>
          {count()} MCP
        </text>
        <text fg={theme().textMuted}>/status</text>
      </box>
    </Show>
  )
}

function KiCad(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const kicad = useKiCadStatus()
  const color = createMemo(() => {
    const state = kicad.connection()
    if (state === "connected") return theme().success
    if (state === "cli") return theme().warning
    if (state === "unavailable") return theme().error
    return theme().textMuted
  })
  return (
    <box flexShrink={0} onMouseUp={() => props.api.keymap.dispatchCommand("kicad.health")}>
      <text fg={theme().text}>
        <span style={{ fg: color() }}>● </span>KiCad{" "}
        <span style={{ fg: theme().textMuted }}>{CONNECTION_LABEL[kicad.connection()]}</span>
      </text>
    </box>
  )
}

function Update(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const update = useUpdateNotification()
  const available = createMemo(() => {
    const notice = update.notification()
    return notice?.type === "available" ? notice.version : undefined
  })

  return (
    <Show when={available()}>
      {(version) => (
        <box flexShrink={0} onMouseUp={() => update.open?.()}>
          <text fg={theme().accent}>
            ↑ Kicad {version()} <span style={{ fg: theme().textMuted }}>/update</span>
          </text>
        </box>
      )}
    </Show>
  )
}

function View(props: { api: TuiPluginApi }) {
  return (
    <box
      width="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="row"
      flexShrink={0}
      gap={2}
    >
      <Directory api={props.api} />
      <KiCad api={props.api} />
      <Mcp api={props.api} />
      <box flexGrow={1} />
      <Update api={props.api} />
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      home_footer() {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin

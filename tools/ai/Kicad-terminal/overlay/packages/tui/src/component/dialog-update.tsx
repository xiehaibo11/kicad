import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { useTheme } from "../context/theme"
import { isVersionGreater, type UpdateCheck, type UpdateState, type UpdateTarget } from "../context/update-notification"
import { useDialog } from "../ui/dialog"
import { useBindings } from "../keymap"
import { errorMessage } from "../util/error"
import { Spinner } from "./spinner"
import { KicadProduct } from "@opencode-ai/core/kicad/product"

export const RELEASES_URL = `https://www.npmjs.com/package/${KicadProduct.packageName}?activeTab=versions`

/** A newer published Kicad release, or undefined when this one is current. */
export function updateTarget(version: { current: string; latest?: string }): UpdateTarget | undefined {
  if (version.latest && isUpdate(version.current, version.latest)) return { type: "latest", version: version.latest }
  return undefined
}

export function isUpdate(current: string, latest: string) {
  return isVersionGreater(latest, current)
}

type View =
  | { type: "checking" }
  | { type: "check-failed"; message: string }
  | { type: "current"; version: string }
  | { type: "available"; current: string; version: string; method?: string; manual?: string }
  | UpdateState

export function DialogUpdate(props: {
  check: () => Promise<UpdateCheck | undefined>
  state: () => UpdateState | undefined
  install: (target: UpdateTarget) => Promise<void>
  skip: (version: string) => void
  restart: () => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [error, setError] = createSignal<string>()
  const [active, setActive] = createSignal(0)
  const [check] = createResource(() =>
    props.check().catch((error: unknown) => {
      setError(errorMessage(error))
      return undefined
    }),
  )

  const target = createMemo(() => {
    const version = check()
    return version ? updateTarget(version) : undefined
  })
  const view = createMemo<View>(() => {
    const current = props.state()
    if (current?.type === "installing" || current?.type === "installed") return current
    if (check.loading) return { type: "checking" }
    if (current?.type === "failed") return current
    const version = check()
    if (!version?.latest) return { type: "check-failed", message: error() ?? "Couldn't check for Kicad updates." }
    const next = target()
    if (!next) return { type: "current", version: version.current }
    return { type: "available", current: version.current, version: next.version, method: version.method, manual: version.manual }
  })
  const buttons = createMemo(() => {
    const current = view()
    if (current.type === "checking" || current.type === "installing") return []
    const close = { label: "Close", run: () => dialog.clear() }
    if (current.type === "installed") return [{ label: "Later", run: () => dialog.clear() }, { label: "Restart", run: props.restart }]
    if (current.type !== "available") return [close]
    const skip = {
      label: "Skip this version",
      run: () => {
        props.skip(current.version)
        dialog.clear()
      },
    }
    if (current.manual) return [skip, close]
    return [skip, { label: "Update", run: () => props.install({ type: "latest", version: current.version }) }]
  })

  createEffect(() => setActive(Math.max(0, buttons().length - 1)))

  const move = (offset: number) => {
    const count = buttons().length
    if (count) setActive((value) => (value + offset + count) % count)
  }

  useBindings(() => ({
    bindings: [
      { key: "return", desc: "Confirm update action", group: "Dialog", cmd: () => void buttons()[active()]?.run() },
      { key: "left", desc: "Previous update action", group: "Dialog", cmd: () => move(-1) },
      { key: "shift+tab", desc: "Previous update action", group: "Dialog", cmd: () => move(-1) },
      { key: "right", desc: "Next update action", group: "Dialog", cmd: () => move(1) },
      { key: "tab", desc: "Next update action", group: "Dialog", cmd: () => move(1) },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {view().type === "installing" ? "Updating Kicad" : view().type === "available" ? "Kicad update available" : "Update Kicad"}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box paddingBottom={1} gap={1}>
        <Switch>
          <Match when={view().type === "checking"}>
            <Spinner color={theme.text}>Checking {KicadProduct.packageName}…</Spinner>
          </Match>
          <Match when={view().type === "current" && (view() as Extract<View, { type: "current" }>)} keyed>
            {(current) => (
              <text fg={theme.textMuted} wrapMode="word">
                Kicad {current.version} is the latest release.
              </text>
            )}
          </Match>
          <Match when={view().type === "available" && (view() as Extract<View, { type: "available" }>)} keyed>
            {(available) => (
              <box gap={1}>
                <text fg={theme.text} wrapMode="word">
                  Kicad <span style={{ fg: theme.accent }}>{available.version}</span> is available
                  <span style={{ fg: theme.textMuted }}> (you have {available.current})</span>
                </text>
                <Show when={available.method}>
                  <text fg={theme.textMuted}>Installation: {available.method}</text>
                </Show>
                <Show
                  when={available.manual}
                  fallback={
                    <text fg={theme.textMuted} wrapMode="word">
                      Kicad installs the published, checksum-verified package. Restart afterwards to use it.
                    </text>
                  }
                >
                  <text fg={theme.warning} wrapMode="word">
                    {available.manual}
                  </text>
                </Show>
                <text fg={theme.textMuted} wrapMode="word">
                  Releases: <span style={{ fg: theme.primary }}>{RELEASES_URL}</span>
                </text>
              </box>
            )}
          </Match>
          <Match when={view().type === "installing" && (view() as Extract<View, { type: "installing" }>)} keyed>
            {(installing) => <Spinner color={theme.text}>Installing Kicad {installing.target.version}…</Spinner>}
          </Match>
          <Match when={view().type === "installed" && (view() as Extract<View, { type: "installed" }>)} keyed>
            {(installed) => (
              <text fg={theme.success} wrapMode="word">
                Kicad {installed.target.version} installed. Restart Kicad to use it.
              </text>
            )}
          </Match>
          <Match
            when={
              (view().type === "failed" || view().type === "check-failed") &&
              (view() as Extract<View, { type: "failed" | "check-failed" }>)
            }
            keyed
          >
            {(failed) => (
              <text fg={theme.error} wrapMode="word">
                {failed.message}
              </text>
            )}
          </Match>
        </Switch>
      </box>
      <Show when={buttons().length > 0}>
        <box flexDirection="row" justifyContent="flex-end" paddingBottom={1} gap={1}>
          <For each={buttons()}>
            {(button, index) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={active() === index() ? theme.primary : undefined}
                onMouseUp={() => void button.run()}
              >
                <text fg={active() === index() ? theme.selectedListItemText : theme.textMuted}>{button.label}</text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

import { createSignal, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "../context/helper"
import { useSDK } from "../context/sdk"
import { useEvent } from "../context/event"
import { connection, type KiCadStatus } from "./summary"

export type { KiCadStatus } from "./summary"

const POLL_MS = 15_000
const REQUEST_MS = 20_000

// The server answers from the same in-process KiCad tools the model uses. Polling is single-flight,
// so a long tool call delays status instead of queueing more requests behind it.
export const { use: useKiCadStatus, provider: KiCadStatusProvider } = createSimpleContext({
  name: "KiCadStatus",
  init: () => {
    const sdk = useSDK()
    const event = useEvent()
    const [status, setStatus] = createSignal<KiCadStatus>()
    const [error, setError] = createSignal<string>()
    const [busy, setBusy] = createSignal(false)
    let inflight: Promise<void> | undefined
    let again = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false

    async function load() {
      const url = new URL("/kicad/status", sdk.url)
      if (sdk.directory) url.searchParams.set("directory", sdk.directory)
      const response = await sdk.fetch(url.toString(), {
        headers: Object.fromEntries(new Headers(sdk.headers).entries()),
        signal: AbortSignal.timeout(REQUEST_MS),
      })
      if (!response.ok) throw new Error((await response.text()).slice(0, 300) || `HTTP ${response.status}`)
      return (await response.json()) as KiCadStatus
    }

    function schedule(ms = POLL_MS) {
      clearTimeout(timer)
      if (!disposed) timer = setTimeout(() => void refresh(), ms)
    }

    function refresh() {
      if (inflight) {
        again = true
        return inflight
      }
      setBusy(true)
      inflight = load()
        .then((next) => {
          setStatus(next)
          setError(undefined)
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause))
        })
        .finally(() => {
          inflight = undefined
          setBusy(false)
          schedule(again ? 500 : POLL_MS)
          again = false
        })
      return inflight
    }

    onMount(() => {
      schedule(300)
      // Re-read documents soon after the model ran a KiCad tool; edits can open or change them.
      const off = event.on("message.part.updated", (evt) => {
        const part = evt.properties.part
        if (part.type !== "tool" || !part.tool.startsWith("kicad_") || part.state.status !== "completed") return
        if (inflight) again = true
        else schedule(1_000)
      })
      onCleanup(() => {
        disposed = true
        clearTimeout(timer)
        off()
      })
    })

    return {
      status,
      error,
      busy,
      connection: () => connection(status()),
      refresh: () => void refresh(),
    }
  },
})

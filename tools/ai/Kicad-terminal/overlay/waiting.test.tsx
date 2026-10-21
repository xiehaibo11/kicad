/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { KiCadWaitingIndicator } from "../src/component/kicad-waiting"

test("waiting badge follows busy state, animation preference and retry layout", async () => {
  const [busy, setBusy] = createSignal(false)
  const [animated, setAnimated] = createSignal(true)
  const [retry, setRetry] = createSignal(false)
  const app = await testRender(() => (
    <Show when={busy()}>
      <box flexDirection="row" gap={1}>
        <KiCadWaitingIndicator animated={animated()} compact={retry()} color={RGBA.fromHex("#999999")} />
        <Show when={retry()}><text>429 [retrying attempt #2]</text></Show>
        <text>esc interrupt</text>
      </box>
    </Show>
  ), { width: 80, height: 3 })
  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Ki")
    setBusy(true)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Ki")
    const first = app.captureCharFrame()
    await Bun.sleep(300)
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toBe(first)
    await Bun.sleep(800)
    await app.renderOnce()
    expect(app.captureCharFrame()).toMatch(/Ki\s+[A-Za-z]+\.\.\./)
    expect(app.captureCharFrame()).toContain("esc interrupt")
    setAnimated(false)
    await app.renderOnce()
    const still = app.captureCharFrame()
    expect(still).toContain("Ki Thinking...")
    await Bun.sleep(150)
    await app.renderOnce()
    expect(app.captureCharFrame()).toBe(still)
    setRetry(true)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Ki 429 [retrying attempt #2]")
    expect(app.captureCharFrame()).toContain("esc interrupt")
    expect(app.captureCharFrame()).not.toContain("Thinking")
    setBusy(false)
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Ki")
    // A second busy period gets a fresh indicator after disposal.
    setRetry(false)
    setBusy(true)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Ki Thinking...")
  } finally {
    app.renderer.destroy()
  }
})

import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import type { RGBA } from "@opentui/core"

// Match the extension's waiting words and character reveal, using a native TUI badge.
const verbs = [
  "Accomplishing", "Actioning", "Actualizing", "Baking", "Booping", "Brewing",
  "Calculating", "Cerebrating", "Channelling", "Churning", "Coalescing",
  "Cogitating", "Computing", "Combobulating", "Concocting", "Considering", "Contemplating",
  "Cooking", "Crafting", "Creating", "Crunching", "Deciphering", "Deliberating",
  "Determining", "Discombobulating", "Doing", "Effecting", "Elucidating", "Enchanting",
  "Envisioning", "Finagling", "Flibbertigibbeting", "Forging", "Forming", "Frolicking",
  "Generating", "Germinating", "Hatching", "Herding", "Honking", "Ideating",
  "Imagining", "Incubating", "Inferring", "Manifesting", "Marinating", "Meandering",
  "Moseying", "Mulling", "Mustering", "Musing", "Noodling", "Percolating",
  "Perusing", "Philosophising", "Pontificating", "Pondering", "Processing", "Puttering",
  "Puzzling", "Reticulating", "Ruminating", "Scheming", "Schlepping", "Shimmying",
  "Simmering", "Smooshing", "Spelunking", "Spinning", "Stewing", "Sussing",
  "Synthesizing", "Thinking", "Tinkering", "Transmuting", "Unfurling", "Unravelling",
  "Vibing", "Wandering", "Whirring", "Wibbling", "Working", "Wrangling",
]
const width = Math.max(...verbs.map((word) => word.length)) + 3

export function KiCadWaitingIndicator(props: { animated: boolean; compact?: boolean; color: RGBA }) {
  const [text, setText] = createSignal("Thinking...")
  const [bright, setBright] = createSignal(true)

  createEffect(() => {
    if (!props.animated || props.compact) {
      setText("Thinking...")
      setBright(true)
      return
    }
    let animation: ReturnType<typeof setInterval> | undefined
    let change: ReturnType<typeof setTimeout> | undefined
    let count = 0
    let previous = ""
    const reveal = () => {
      if (animation) clearInterval(animation)
      const choices = verbs.filter((word) => word !== previous)
      previous = choices[Math.floor(Math.random() * choices.length)]!
      const target = (previous + "...").padEnd(width, " ")
      let position = 0
      animation = setInterval(() => {
        if (position - 3 >= target.length) {
          clearInterval(animation)
          return
        }
        const scan = position++
        setText((value) => {
          const chars = value.padEnd(width, " ").split("")
          for (let phase = 0; phase <= 3; phase++) {
            const index = scan - phase
            if (index < 0 || index >= target.length) continue
            chars[index] = target[index] === " " ? " " : phase === 3 ? target[index]!
              : phase === 0 ? "▌" : [".", "_", target[index]!][Math.floor(Math.random() * 3)]!
          }
          return chars.join("")
        })
      }, 40)
    }
    const next = () => {
      reveal()
      change = setTimeout(next, [2000, 3000, 5000][Math.min(count++, 2)]!)
    }
    reveal()
    change = setTimeout(next, 2000)
    const pulse = setInterval(() => setBright((value) => !value), 700)
    onCleanup(() => {
      clearInterval(animation)
      clearTimeout(change)
      clearInterval(pulse)
    })
  })

  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text bg={bright() ? "#3c3cb7" : "#2d2d80"} fg="#ffffff"><b>K</b><span style={{ fg: "#f28b39" }}>i</span></text>
      <Show when={!props.compact}><text fg={props.color}>{text()}</text></Show>
    </box>
  )
}

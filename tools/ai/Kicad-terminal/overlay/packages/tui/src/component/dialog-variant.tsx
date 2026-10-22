import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"

const levels = ["off", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
const labels: Record<string, string> = {
  default: "Auto · model default", off: "Thinking off", none: "None", minimal: "Minimal",
  low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra",
}

export function DialogVariant() {
  const local = useLocal(), dialog = useDialog()
  const options = createMemo(() => {
    const variants = local.model.variant.list().slice().sort((a, b) => {
      const rank = (value: string) => levels.includes(value) ? levels.indexOf(value) : levels.length
      return rank(a) - rank(b)
    })
    return ["default", ...variants].map(value => ({
      value, title: labels[value] ?? value, description: value,
      onSelect: () => {
        dialog.clear()
        local.model.variant.set(value === "default" ? undefined : value)
      },
    }))
  })
  return <DialogSelect<string> options={options()}
    title={local.model.variant.list().length ? "Reasoning effort · current model" : "The current model has no reasoning levels"}
    current={local.model.variant.selected() ?? "default"} flat={true} />
}

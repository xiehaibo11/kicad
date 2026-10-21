import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"

const levels = ["off", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
const labels: Record<string, string> = {
  default: "自动 · 模型默认", off: "关闭思考", none: "无", minimal: "最低",
  low: "轻度", medium: "中等", high: "高", xhigh: "超高", max: "最高", ultra: "极高",
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
    title={local.model.variant.list().length ? "推理强度 · 当前模型" : "当前模型未提供推理档位"}
    current={local.model.variant.selected() ?? "default"} flat={true} />
}

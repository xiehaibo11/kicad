import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@opencode-ai/core/flag/flag"
import { KicadProduct } from "@opencode-ai/core/kicad/product"
import { KicadUpdate } from "@/kicad/update"

// Checking never installs anything. Updates only happen when the user runs `/update` or `Kicad upgrade`.
export function shouldNotify(input: {
  autoupdate: boolean | "notify" | undefined
  disabled: boolean
  always: boolean
  current: string
  latest: string
}) {
  if (input.autoupdate === false || input.disabled) return false
  if (input.always) return true
  return KicadUpdate.isNewer(input.latest, input.current)
}

// Returns undefined when checks are disabled, fail, or find nothing newer than this Kicad release.
export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  const disabled = Flag.OPENCODE_DISABLE_AUTOUPDATE || Boolean(process.env.KICAD_DISABLE_UPDATE_CHECK)
  if (config.autoupdate === false || disabled) return
  const latest = await KicadUpdate.latest().catch(() => undefined)
  if (!latest) return
  if (
    shouldNotify({
      autoupdate: config.autoupdate,
      disabled,
      always: Flag.OPENCODE_ALWAYS_NOTIFY_UPDATE,
      current: KicadProduct.version,
      latest,
    })
  )
    return { type: "available" as const, version: latest }
  return
}

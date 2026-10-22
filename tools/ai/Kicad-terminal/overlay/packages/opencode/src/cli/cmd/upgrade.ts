import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { KicadProduct } from "@opencode-ai/core/kicad/product"
import { KicadUpdate } from "@/kicad/update"

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "upgrade Kicad to the latest or a specific version",
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", {
        describe: "version to install, for example '0.2.1' or 'v0.2.1'",
        type: "string",
      })
      .option("method", {
        alias: "m",
        describe: "installation method to use",
        type: "string",
        choices: ["npm", "pnpm", "bun", "standalone"],
      })
      .option("prefix", {
        describe: "standalone installation prefix (default: the running installation)",
        type: "string",
      })
      .option("check", {
        describe: "only report whether an update is available",
        type: "boolean",
      })
  },
  handler: async (args: { target?: string; method?: string; prefix?: string; check?: boolean }) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Upgrade Kicad")
    const detected = KicadUpdate.detect()
    const install: KicadUpdate.Install = args.method
      ? {
          method: args.method as KicadUpdate.Method,
          root: detected.root,
          prefix: args.prefix ?? detected.prefix,
        }
      : { ...detected, ...(args.prefix ? { prefix: args.prefix } : {}) }
    prompts.log.info(`Installed: Kicad ${KicadProduct.version} via ${KicadUpdate.describe(install)}`)

    const spinner = prompts.spinner()
    spinner.start("Checking the Kicad release channel…")
    let target: KicadUpdate.Manifest
    try {
      target = await KicadUpdate.manifest(args.target?.replace(/^v/, "") ?? "latest")
    } catch (error) {
      spinner.stop("Couldn't check for updates", 1)
      prompts.log.error(error instanceof Error ? error.message : String(error))
      prompts.outro("Done")
      process.exitCode = 1
      return
    }
    spinner.stop(`Release channel: ${KicadProduct.packageName}@${target.version}`)

    if (!args.target && !KicadUpdate.isNewer(target.version, KicadProduct.version)) {
      prompts.log.success(`Kicad ${KicadProduct.version} is up to date`)
      prompts.outro("Done")
      return
    }
    if (target.version === KicadProduct.version) {
      prompts.log.warn(`Kicad ${target.version} is already installed`)
      prompts.outro("Done")
      return
    }
    if (args.check) {
      prompts.log.info(`Kicad ${target.version} is available. Run \`Kicad upgrade\` to install it.`)
      prompts.outro("Done")
      return
    }

    const instructions = KicadUpdate.manual(install, target.version)
    if (instructions) {
      prompts.log.warn(instructions)
      prompts.outro("Done")
      return
    }

    prompts.log.info(`From ${KicadProduct.version} → ${target.version}`)
    spinner.start(`Installing Kicad ${target.version}…`)
    const error = await KicadUpdate.apply(install, target.version).catch((error: unknown) => error)
    if (error) {
      spinner.stop("Upgrade failed", 1)
      prompts.log.error(error instanceof Error ? error.message : String(error))
      prompts.outro("Done")
      process.exitCode = 1
      return
    }
    spinner.stop(`Kicad ${target.version} installed`)
    prompts.log.info("Restart Kicad to use the new version.")
    prompts.outro("Done")
  },
}

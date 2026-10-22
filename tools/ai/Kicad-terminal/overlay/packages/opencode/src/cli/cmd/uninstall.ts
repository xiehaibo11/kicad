import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Global } from "@opencode-ai/core/global"
import { KicadProduct } from "@opencode-ai/core/kicad/product"
import { existsSync, lstatSync, readlinkSync } from "fs"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { Process } from "@/util/process"
import { KicadUpdate } from "@/kicad/update"

interface UninstallArgs {
  removeConfig: boolean
  removeData: boolean
  keepConfig?: boolean
  keepData?: boolean
  dryRun: boolean
  force: boolean
}

type Target = { path: string; label: string; directory: boolean }

// Kicad shares its config, data and session directories with the OpenCode runtime it is built on.
// They are kept unless explicitly requested, so uninstalling Kicad never removes another program.
export const UninstallCommand = {
  command: "uninstall",
  describe: "uninstall Kicad; shared configuration and sessions are kept unless requested",
  builder: (yargs: Argv) =>
    yargs
      .option("remove-config", {
        type: "boolean",
        describe: "also remove the shared configuration directory",
        default: false,
      })
      .option("remove-data", {
        type: "boolean",
        describe: "also remove shared sessions, data, cache and state",
        default: false,
      })
      .option("keep-config", { alias: "c", type: "boolean", hidden: true })
      .option("keep-data", { alias: "d", type: "boolean", hidden: true })
      .option("dry-run", {
        type: "boolean",
        describe: "show what would be removed without removing",
        default: false,
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "skip confirmation prompts",
        default: false,
      }),

  handler: async (args: UninstallArgs) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Uninstall Kicad")
    const install = KicadUpdate.detect()
    prompts.log.info(`Kicad ${KicadProduct.version} via ${KicadUpdate.describe(install)}`)

    const files = programFiles(install)
    const shared = sharedDirectories(args)
    const packageCommand = removeCommand(install)
    if (install.method === "npx") prompts.log.info("Started with npx: there is no installed program to remove.")
    if (install.method === "source") prompts.log.info("Development build: remove it from your checkout manually.")
    if (install.method === "unknown") prompts.log.warn(`No Kicad installation found for ${process.execPath}.`)

    if (!files.length && !shared.length && !packageCommand) {
      prompts.outro("Nothing to remove")
      return
    }
    prompts.log.message("The following will be removed:")
    if (packageCommand) prompts.log.info(`  ✓ Package: ${packageCommand.join(" ")}`)
    for (const file of files) prompts.log.info(`  ✓ ${file.label}: ${home(file.path)}`)
    for (const dir of shared) prompts.log.info(`  ✓ ${dir.label}: ${home(dir.path)} (shared with OpenCode)`)
    if (!args.removeData || !args.removeConfig)
      prompts.log.info("  ○ Shared configuration and sessions are kept (--remove-config, --remove-data)")

    if (args.dryRun) {
      prompts.log.warn("Dry run - no changes made")
      prompts.outro("Done")
      return
    }
    if (!args.force) {
      const confirm = await prompts.confirm({ message: "Uninstall Kicad?", initialValue: false })
      if (!confirm || prompts.isCancel(confirm)) {
        prompts.outro("Cancelled")
        return
      }
    }

    const errors: string[] = []
    if (packageCommand) {
      const result = await Process.run(packageCommand, { nothrow: true, abort: AbortSignal.timeout(300_000) })
      if (result.code !== 0) errors.push(`${packageCommand.join(" ")} exited with ${result.code}`)
    }
    for (const target of [...files, ...shared]) {
      const error = await fs.rm(target.path, { recursive: target.directory, force: true }).catch((err) => err)
      if (error) errors.push(`${target.label}: ${error.message}`)
    }
    for (const error of errors) prompts.log.error(error)
    prompts.outro(errors.length ? "Finished with errors" : "Kicad has been removed")
  },
}

function home(file: string) {
  return file.replace(os.homedir(), "~")
}

function removeCommand(install: KicadUpdate.Install) {
  if (install.method === "npm") return ["npm", "uninstall", "-g", KicadProduct.packageName]
  if (install.method === "pnpm") return ["pnpm", "remove", "-g", KicadProduct.packageName]
  if (install.method === "bun") return ["bun", "remove", "-g", KicadProduct.packageName]
  return undefined
}

function programFiles(install: KicadUpdate.Install): Target[] {
  if (install.method !== "standalone" || !install.prefix) return []
  const bin = path.join(install.prefix, "bin")
  const result: Target[] = []
  for (const name of ["Kicad", "kicad", "kicad-terminal"]) {
    const file = path.join(bin, name)
    // A lowercase kicad entry may still be the historical kicad-cli symlink; only remove Kicad's own.
    if (name === "kicad" && existsSync(file) && lstatSync(file).isSymbolicLink()) {
      const link = path.basename(readlinkSync(file))
      if (link !== "Kicad") continue
    }
    if (existsSync(file) || (name === "kicad" && isLink(file))) result.push({ path: file, label: "Program", directory: false })
  }
  const share = path.join(install.prefix, "share/kicad-terminal")
  if (existsSync(share)) result.push({ path: share, label: "Resources", directory: true })
  return result
}

function isLink(file: string) {
  try {
    return lstatSync(file).isSymbolicLink()
  } catch {
    return false
  }
}

function sharedDirectories(args: UninstallArgs): Target[] {
  const result: Target[] = []
  if (args.removeData && !args.keepData) {
    result.push({ path: Global.Path.data, label: "Data", directory: true })
    result.push({ path: Global.Path.cache, label: "Cache", directory: true })
    result.push({ path: Global.Path.state, label: "State", directory: true })
  }
  if (args.removeConfig && !args.keepConfig) result.push({ path: Global.Path.config, label: "Config", directory: true })
  return result.filter((item) => existsSync(item.path))
}

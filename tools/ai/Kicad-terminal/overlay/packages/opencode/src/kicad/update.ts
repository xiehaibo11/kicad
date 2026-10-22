export * as KicadUpdate from "./update"

// Kicad update channel. Versions come from the @-kicadai/kicad-code npm package and
// never from upstream OpenCode releases, so an update can't replace Kicad with OpenCode.
import { createHash } from "crypto"
import { existsSync, readFileSync } from "fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import semver from "semver"
import { NpmConfig } from "@opencode-ai/core/npm-config"
import { KicadProduct } from "@opencode-ai/core/kicad/product"
import { Process } from "@/util/process"

export type Method = "npm" | "pnpm" | "bun" | "npx" | "standalone" | "source" | "unknown"

export type Install = {
  readonly method: Method
  /** Package directory for package-manager installs. */
  readonly root?: string
  /** Installation prefix (bin/ and share/kicad-terminal/) for standalone installs. */
  readonly prefix?: string
}

export type Manifest = {
  readonly version: string
  readonly tarball: string
  readonly integrity?: string
  readonly shasum?: string
  readonly registry: string
}

export class UpdateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "KicadUpdateError"
  }
}

export const DEFAULT_REGISTRY = "https://registry.npmjs.org"
const METHODS = new Set<Method>(["npm", "pnpm", "bun", "npx", "standalone", "source"])
const PACKAGE_SEGMENT = `/node_modules/${KicadProduct.packageName}/`

export function isNewer(latest: string, current: string) {
  const next = semver.valid(latest)
  if (!next) return false
  const installed = semver.valid(current)
  if (!installed) return true
  return semver.gt(next, installed)
}

/** Work out how this copy of Kicad was installed, without running any program. */
export function detect(
  input: {
    execPath?: string
    env?: Record<string, string | undefined>
    exists?: (file: string) => boolean
  } = {},
): Install {
  const env = input.env ?? process.env
  const exists = input.exists ?? existsSync
  const execPath = (input.execPath ?? process.execPath).replaceAll("\\", "/")
  const declared = env.KICAD_INSTALL_METHOD as Method | undefined
  if (declared && METHODS.has(declared)) {
    return {
      method: declared,
      ...(env.KICAD_PACKAGE_ROOT ? { root: env.KICAD_PACKAGE_ROOT } : {}),
      ...(env.KICAD_INSTALL_PREFIX ? { prefix: env.KICAD_INSTALL_PREFIX } : {}),
    }
  }
  const index = execPath.indexOf(PACKAGE_SEGMENT)
  if (index >= 0) {
    const root = execPath.slice(0, index + PACKAGE_SEGMENT.length - 1)
    if (execPath.includes("/_npx/")) return { method: "npx", root }
    if (execPath.includes("/.bun/install/global/")) return { method: "bun", root }
    if (execPath.includes("/.pnpm/") || execPath.includes("/pnpm/global/")) return { method: "pnpm", root }
    return { method: "npm", root }
  }
  if (execPath.includes("/tools/ai/Kicad-terminal/")) return { method: "source" }
  const bin = path.posix.dirname(execPath)
  const prefix = path.posix.dirname(bin)
  if (path.posix.basename(bin) === "bin" && exists(path.posix.join(prefix, "share/kicad-terminal/session-runtime.mjs")))
    return { method: "standalone", prefix }
  return { method: "unknown" }
}

export function describe(install: Install) {
  switch (install.method) {
    case "npm":
      return "npm (global)"
    case "pnpm":
      return "pnpm (global)"
    case "bun":
      return "bun (global)"
    case "npx":
      return "npx"
    case "standalone":
      return install.prefix ? `standalone (${install.prefix.replace(os.homedir(), "~")})` : "standalone"
    case "source":
      return "development build"
    default:
      return "unknown"
  }
}

/** Instructions for installs that Kicad can't update in place, or undefined when it can. */
export function manual(install: Install, version = "latest") {
  const spec = `${KicadProduct.packageName}@${version}`
  switch (install.method) {
    case "npx":
      return `Started with npx. Quit and run: npx --yes ${spec}`
    case "source":
      return "This is a development build. Rebuild it with tools/ai/Kicad-terminal/build.sh."
    case "unknown":
      return `Install it with: npm install -g ${spec}`
    default:
      return undefined
  }
}

// npm's own precedence: a registry configured for the package scope, then the default registry.
async function registries(dir: string) {
  const config = await Effect.runPromise(NpmConfig.load(dir)).catch(() => ({}) as Record<string, unknown>)
  const scope = KicadProduct.packageName.split("/")[0]
  const scoped = config[`${scope}:registry`]
  const configured = typeof scoped === "string" ? scoped : typeof config.registry === "string" ? config.registry : DEFAULT_REGISTRY
  const list = [configured, DEFAULT_REGISTRY].map((value) => value.replace(/\/+$/, ""))
  return [...new Set(list)]
}

/** Registry metadata for one version (or dist-tag). Mirrors that don't carry the package fall back to npmjs. */
export async function manifest(tag = "latest", dir = process.cwd(), signal?: AbortSignal): Promise<Manifest> {
  let failure = "no registry answered"
  for (const registry of await registries(dir)) {
    const url = `${registry}/${KicadProduct.packageName}/${encodeURIComponent(tag)}`
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        failure = `${url} answered ${response.status}`
        continue
      }
      const body = (await response.json()) as {
        name?: string
        version?: string
        dist?: { tarball?: string; integrity?: string; shasum?: string }
      }
      if (body.name !== KicadProduct.packageName || !semver.valid(body.version ?? "") || !body.dist?.tarball) {
        failure = `${url} returned an unexpected package manifest`
        continue
      }
      return {
        version: body.version!,
        tarball: body.dist.tarball,
        integrity: body.dist.integrity,
        shasum: body.dist.shasum,
        registry,
      }
    } catch (error) {
      if (signal?.aborted) throw error
      failure = `${url}: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  throw new UpdateError(`Couldn't check for Kicad updates (${failure})`)
}

export async function latest(dir = process.cwd(), signal?: AbortSignal) {
  return (await manifest("latest", dir, signal)).version
}

export function verifyIntegrity(data: Uint8Array, expected: { integrity?: string; shasum?: string }) {
  const sri = expected.integrity?.split(/\s+/).find((item) => item.startsWith("sha512-"))
  if (sri) {
    const actual = "sha512-" + createHash("sha512").update(data).digest("base64")
    if (actual !== sri) throw new UpdateError("Downloaded package failed its sha512 integrity check")
    return "sha512"
  }
  if (expected.shasum) {
    const actual = createHash("sha1").update(data).digest("hex")
    if (actual !== expected.shasum) throw new UpdateError("Downloaded package failed its sha1 check")
    return "sha1"
  }
  throw new UpdateError("The registry did not publish a checksum for this package")
}

async function command(cmd: string[], timeoutMs = 600_000) {
  const result = await Process.run(cmd, { nothrow: true, abort: AbortSignal.timeout(timeoutMs) })
  if (result.code === 0) return
  const output = `${result.stderr.toString("utf8")}\n${result.stdout.toString("utf8")}`.trim()
  throw new UpdateError(`${cmd.join(" ")} failed (exit ${result.code})${output ? `\n${output.slice(-2000)}` : ""}`)
}

function installedVersion(root: string | undefined) {
  if (!root) return
  try {
    return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version as string | undefined
  } catch {
    return
  }
}

async function replaceFile(source: string, target: string, mode: number) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`)
  try {
    await fs.copyFile(source, temporary)
    await fs.chmod(temporary, mode)
    await fs.rename(temporary, target)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

async function replaceDirectory(source: string, target: string) {
  const fresh = `${target}.${process.pid}.new`
  const old = `${target}.${process.pid}.old`
  await fs.rm(fresh, { recursive: true, force: true })
  await fs.cp(source, fresh, { recursive: true })
  if (existsSync(target)) await fs.rename(target, old)
  await fs.rename(fresh, target)
  await fs.rm(old, { recursive: true, force: true })
}

const LICENSES: Record<string, string> = {
  "OpenCode-MIT.txt": "LICENSE-OpenCode.txt",
  "protobufjs-BSD.txt": "LICENSE-protobufjs.txt",
  "circuit-blocks-MIT.txt": "LICENSE-blocks-MIT.txt",
}

/** Update a standalone (install.sh) layout in place from the published, checksum-verified npm tarball. */
export async function installStandalone(prefix: string, target: Manifest) {
  const share = path.join(prefix, "share/kicad-terminal")
  const bin = path.join(prefix, "bin")
  if (!existsSync(share) || !existsSync(bin)) throw new UpdateError(`No standalone Kicad installation in ${prefix}`)
  const stage = await fs.mkdtemp(path.join(share, ".kicad-update-"))
  try {
    const response = await fetch(target.tarball, { signal: AbortSignal.timeout(600_000) })
    if (!response.ok) throw new UpdateError(`Download failed: ${target.tarball} answered ${response.status}`)
    const data = new Uint8Array(await response.arrayBuffer())
    verifyIntegrity(data, target)
    const archive = path.join(stage, "package.tgz")
    await fs.writeFile(archive, data)
    await command(["tar", "-xzf", archive, "-C", stage], 120_000)
    const root = path.join(stage, "package")
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"))
    if (pkg.name !== KicadProduct.packageName || pkg.version !== target.version)
      throw new UpdateError(`Downloaded package is ${pkg.name}@${pkg.version}, expected ${target.version}`)
    const runtime = path.join(root, "vendor", `${process.platform}-${process.arch}`, "kicad-terminal")
    if (!existsSync(runtime)) throw new UpdateError(`The package has no runtime for ${process.platform}-${process.arch}`)
    await fs.chmod(runtime, 0o755)
    const probe = await Process.run([runtime, "--version"], { nothrow: true, abort: AbortSignal.timeout(30_000) })
    if (probe.code !== 0 || !probe.stdout.toString("utf8").trim())
      throw new UpdateError("The downloaded runtime does not start on this computer; nothing was changed")

    // Resources first, binary and launcher last: an interrupted update leaves the old entry point working.
    const resources = path.join(root, "resources")
    for (const entry of await fs.readdir(resources, { withFileTypes: true })) {
      const source = path.join(resources, entry.name)
      if (entry.isDirectory()) await replaceDirectory(source, path.join(share, entry.name))
      else if (entry.name !== "launcher.sh") await replaceFile(source, path.join(share, entry.name), 0o644)
    }
    for (const [name, installed] of Object.entries(LICENSES)) {
      const source = path.join(root, "licenses", name)
      if (existsSync(source)) await replaceFile(source, path.join(share, installed), 0o644)
    }
    await replaceFile(runtime, path.join(bin, "kicad-terminal"), 0o755)
    const launcher = path.join(resources, "launcher.sh")
    if (existsSync(launcher)) await replaceFile(launcher, path.join(bin, "Kicad"), 0o755)
  } finally {
    await fs.rm(stage, { recursive: true, force: true })
  }
}

/** Install a published version with the method this copy was installed with. */
export async function apply(install: Install, version: string, dir = process.cwd()) {
  const instructions = manual(install, version)
  if (instructions) throw new UpdateError(instructions)
  const target = await manifest(version, dir)
  const spec = `${KicadProduct.packageName}@${target.version}`
  if (install.method === "standalone") {
    if (!install.prefix) throw new UpdateError("Standalone installation prefix is unknown")
    return installStandalone(install.prefix, target)
  }
  // When the configured mirror lacks Kicad, point only Kicad's scope at the registry that has it;
  // dependencies keep coming from the user's registry.
  const scope = KicadProduct.packageName.split("/")[0]
  const configured = (await registries(dir))[0]
  const registry = target.registry === configured ? [] : [`--${scope}:registry=${target.registry}`]
  if (install.method === "npm") await command(["npm", "install", "-g", spec, ...registry])
  if (install.method === "pnpm") await command(["pnpm", "add", "-g", spec, ...registry])
  if (install.method === "bun") await command(["bun", "add", "-g", spec, ...registry])
  const installed = installedVersion(install.root)
  if (install.root && installed !== target.version)
    throw new UpdateError(
      `${install.method} finished, but ${install.root} still contains ${installed ?? "no package"}; a different global prefix may be in use`,
    )
}

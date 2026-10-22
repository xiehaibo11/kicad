export * as KicadStatus from "./status"

// KiCad connection status for the Kicad workbench, read through the same in-process tools the model uses.
// Only read-only actions are called; the editor's documents are never opened, changed or saved here.
import { readdirSync } from "fs"
import path from "path"
import { SessionID, MessageID } from "@/session/schema"

export type StatusDocument = { kind: "pcb" | "schematic"; name: string; project?: string; path?: string }
export type Status = {
  tools: boolean
  cli: { available: boolean; version?: string; error?: string }
  ipc: { available: boolean; socket?: string; error?: string }
  documents: StatusDocument[]
  documentsError?: string
  projects: string[]
  checkedAt: number
}

type Tool = { execute: (args: Record<string, unknown>, context: any) => Promise<unknown> }
type Context = { directory: string; worktree: string }

const CLI_TTL_MS = 5 * 60_000
let cli: { value: Status["cli"]; at: number } | undefined
const inflight = new Map<string, Promise<Status>>()

type Result = { ok?: boolean; data?: any; error?: { code?: string; message?: string } }
const failed = (error: unknown): Result => ({ ok: false, error: { message: String(error) } })

async function call(tool: Tool, args: Record<string, unknown>, context: Context, timeoutMs: number): Promise<Result> {
  const output = await tool.execute(args, {
    sessionID: SessionID.descending(),
    messageID: MessageID.ascending(),
    agent: "kicad-status",
    directory: context.directory,
    worktree: context.worktree,
    abort: AbortSignal.timeout(timeoutMs),
    metadata: () => {},
    ask: async () => {
      throw new Error("KiCad status checks are read-only")
    },
  })
  const text = typeof output === "string" ? output : (output as { output?: string })?.output
  return JSON.parse(text ?? "{}") as Result
}

function message(result: Result) {
  return [result.error?.code, result.error?.message].filter(Boolean).join(": ") || "failed"
}

export function documentsFrom(list: unknown, kind: StatusDocument["kind"]): StatusDocument[] {
  if (!Array.isArray(list)) return []
  return list.flatMap((item: any) => {
    const project = typeof item?.project?.name === "string" ? item.project.name : undefined
    const dir = typeof item?.project?.path === "string" ? item.project.path : undefined
    const name =
      kind === "pcb"
        ? (item?.boardFilename ?? item?.board_filename ?? (project ? `${project}.kicad_pcb` : undefined))
        : project
          ? `${project}.kicad_sch`
          : undefined
    if (typeof name !== "string" || !name) return []
    return [{ kind, name, project, path: dir ? path.join(dir, name) : undefined }]
  })
}

/** KiCad projects under the working directory (two levels), nearest first. */
export function findProjects(root: string, depth = 2, limit = 6) {
  const found: string[] = []
  const walk = (dir: string, level: number) => {
    if (found.length >= limit) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".kicad_pro")) found.push(path.relative(root, path.join(dir, entry.name)))
    }
    if (level >= depth) return
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue
      walk(path.join(dir, entry.name), level + 1)
    }
  }
  walk(root, 0)
  return found.slice(0, limit)
}

async function read(tools: Record<string, Tool | undefined>, context: Context): Promise<Status> {
  const system = tools.kicad_system
  const document = tools.kicad_document
  const projects = findProjects(context.directory)
  if (!system || !document)
    return { tools: false, cli: { available: false }, ipc: { available: false }, documents: [], projects, checkedAt: Date.now() }

  if (!cli || Date.now() - cli.at > CLI_TTL_MS || !cli.value.available) {
    const version = await call(system, { action: "system.version", payload: {} }, context, 10_000).catch(failed)
    // KiCad tool calls run one at a time: a check queued behind a long task times out before it runs.
    // That says nothing about kicad-cli, so keep the last result.
    if (!(version.error?.code === "CANCELLED" && cli)) cli = {
      at: Date.now(),
      value: version.ok
        ? { available: true, version: String(version.data?.version ?? "").trim() || undefined }
        : { available: false, error: message(version) },
    }
  }

  const ping = await call(system, { action: "system.ping", payload: { timeoutMs: 1500 } }, context, 5_000).catch(failed)
  const socket = process.env.KICAD_API_SOCKET || undefined
  if (!ping.ok)
    return {
      tools: true,
      cli: cli.value,
      ipc: { available: false, socket, error: message(ping) },
      documents: [],
      projects,
      checkedAt: Date.now(),
    }

  const documents: StatusDocument[] = []
  const errors: string[] = []
  for (const kind of ["pcb", "schematic"] as const) {
    const listed = await call(document, { action: "document.list", payload: { type: kind, timeoutMs: 1500 } }, context, 5_000).catch(failed)
    if (listed.ok) documents.push(...documentsFrom(listed.data?.documents, kind))
    else errors.push(message(listed))
  }
  return {
    tools: true,
    cli: cli.value,
    ipc: { available: true, socket },
    documents,
    ...(errors.length ? { documentsError: errors.join("; ") } : {}),
    projects,
    checkedAt: Date.now(),
  }
}

/** Single-flight per directory: concurrent requests share one read. */
export function status(tools: Record<string, Tool | undefined>, context: Context) {
  const pending = inflight.get(context.directory)
  if (pending) return pending
  const next = read(tools, context).finally(() => inflight.delete(context.directory))
  inflight.set(context.directory, next)
  return next
}

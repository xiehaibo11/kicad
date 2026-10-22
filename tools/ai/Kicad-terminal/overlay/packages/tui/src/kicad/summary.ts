// Pure helpers that turn KiCad status and tool results into short, honest display text.
// A result is never shown as passing unless the tool reported ok and found no violations.

export type KiCadDocument = { kind: "pcb" | "schematic"; name: string; project?: string; path?: string }

export type KiCadStatus = {
  tools: boolean
  cli: { available: boolean; version?: string; error?: string }
  ipc: { available: boolean; socket?: string; error?: string }
  documents: KiCadDocument[]
  documentsError?: string
  projects: string[]
  checkedAt: number
}

export type Connection = "checking" | "connected" | "cli" | "offline" | "unavailable"

export function connection(status: KiCadStatus | undefined): Connection {
  if (!status) return "checking"
  if (!status.tools) return "unavailable"
  if (status.ipc.available) return "connected"
  if (status.cli.available) return "cli"
  return "offline"
}

export const CONNECTION_LABEL: Record<Connection, string> = {
  checking: "checking…",
  connected: "connected",
  cli: "CLI only",
  offline: "not running",
  unavailable: "tools not loaded",
}

/** Terminal cell width; CJK file names take two cells per character. */
export function displayWidth(text: string) {
  return typeof Bun !== "undefined" ? Bun.stringWidth(text) : text.length
}

/** Shorten long names in the middle, by display width, so the file extension stays visible. */
export function middle(text: string, width: number) {
  if (displayWidth(text) <= width) return text
  if (width <= 1) return "…"
  const chars = Array.from(text)
  let head = ""
  let tail = ""
  let used = 1
  for (let i = 0, j = chars.length - 1; i <= j; ) {
    const fromTail = displayWidth(tail) <= displayWidth(head)
    const next = fromTail ? chars[j]! : chars[i]!
    const cost = displayWidth(next)
    if (used + cost > width) break
    used += cost
    if (fromTail) {
      tail = next + tail
      j--
    } else {
      head += next
      i++
    }
  }
  return head + "…" + tail
}

export function basename(value: string) {
  const parts = value.replaceAll("\\", "/").split("/").filter(Boolean)
  return parts.at(-1) ?? value
}

export type ToolState = "running" | "ok" | "issues" | "failed" | "unknown"

export type ToolSummary = {
  /** Native action, e.g. board.drc.live. */
  action: string
  /** Main document or file the call worked on. */
  target?: string
  state: ToolState
  detail?: string
  code?: string
  artifacts: string[]
  result?: Record<string, unknown>
  /** OpenCode stores oversized tool results in a file; the full result can be summarized from it. */
  savedOutput?: string
}

// Error codes that describe the design, not a broken tool: the check ran and the design did not pass.
const VERDICTS = new Set([
  "CONNECTIVITY_UNPROVEN",
  "PLANE_UNCONNECTED",
  "AUDIT_NOT_PASSED",
  "RELEASE_EVIDENCE_INCOMPLETE",
  "STEP_COLLISIONS",
  "NETLIST_IMPORT_ERRORS",
])

const OPERATION_TOOLS: Record<string, string> = {
  kicad_blocks: "blocks",
  kicad_workflow: "workflow",
  kicad_pipeline: "pipeline",
  kicad_native_tools: "editor.native",
}

type Json = Record<string, unknown>
const record = (value: unknown): Json | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined
const text = (value: unknown) => (typeof value === "string" && value ? value : undefined)
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)
const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`

export function isKiCadTool(tool: string) {
  return tool.startsWith("kicad_")
}

export function toolAction(tool: string, input: Json) {
  if (tool === "kicad_health") return "system.health"
  if (tool === "kicad_actions") return "actions"
  if (tool === "kicad_spec_validate") return "spec.validate"
  const prefix = OPERATION_TOOLS[tool]
  if (prefix) return `${prefix}.${text(input.operation) ?? "run"}`
  return text(input.action) ?? tool.replace(/^kicad_/, "")
}

function payloadOf(tool: string, input: Json) {
  if (tool in OPERATION_TOOLS || tool === "kicad_spec_validate") return input
  return record(input.payload) ?? {}
}

function pathText(value: unknown) {
  if (typeof value === "string") return value
  return text(record(value)?.path)
}

export function toolTarget(tool: string, input: Json) {
  const payload = payloadOf(tool, input)
  for (const key of ["document", "input", "file", "board", "schematic", "spec", "project", "output"]) {
    const value = pathText(payload[key])
    if (value) return basename(value)
  }
  return undefined
}

function documentName(value: unknown) {
  const doc = record(value)
  if (!doc) return undefined
  const board = text(doc.boardFilename) ?? text(doc.board_filename)
  if (board) return board
  const project = text(record(doc.project)?.name)
  if (String(doc.type ?? "").includes("SCHEMATIC") && project) return project + ".kicad_sch"
  return project
}

function severity(summary: Json) {
  const total = count(summary.total)
  if (total === undefined) return undefined
  const bySeverity = record(summary.bySeverity) ?? {}
  const parts = [plural(total, "issue")]
  const errors = count(bySeverity.error)
  const warnings = count(bySeverity.warning)
  if (errors) parts.push(plural(errors, "error"))
  if (warnings) parts.push(plural(warnings, "warning"))
  return { total, errors: errors ?? 0, detail: parts.join(" · ") }
}

const COUNT_LABELS: Array<[string, string]> = [
  ["FootprintInstance", "footprint"],
  ["Track", "track"],
  ["Via", "via"],
  ["Zone", "zone"],
  ["Pad", "pad"],
]

function describeData(action: string, data: Json): { state?: ToolState; detail?: string } {
  const summary = record(data.summary)
  const rules = summary ? severity(summary) : undefined
  if (rules) {
    if (rules.total === 0 || data.status === "clean") return { state: "ok", detail: "clean" }
    return { state: "issues", detail: rules.detail }
  }
  if (data.status === "clean") return { state: "ok", detail: "clean" }
  if (action === "tools.load") return { state: "ok", detail: `${plural(count(data.count) ?? 0, "KiCad tool")} loaded` }
  if (action === "system.health") {
    const cli = record(data.kicadCli)
    const ipc = record(data.ipc)
    const docs = record(record(data.documents)?.data)?.documents
    const parts = [
      cli?.available ? `CLI ${text(cli.version) ?? "available"}` : "CLI unavailable",
      ipc?.available ? "IPC connected" : "IPC not running",
    ]
    if (Array.isArray(docs)) parts.push(plural(docs.length, "open document"))
    return { detail: parts.join(" · ") }
  }
  if (Array.isArray(data.documents)) {
    const names = data.documents.map(documentName).filter((name): name is string => Boolean(name))
    return { detail: names.length ? names.join(", ") : "no open documents" }
  }
  const counts = record(data.counts)
  if (counts) {
    const parts = COUNT_LABELS.flatMap(([key, label]) => {
      const n = count(counts[key])
      return n === undefined ? [] : [plural(n, label)]
    })
    if (parts.length) return { detail: parts.slice(0, 3).join(" · ") }
  }
  const total = count(data.count)
  if (action === "actions" && total !== undefined) return { detail: plural(total, "action") }
  if (data.dryRun === true) return { detail: "preview only, nothing changed" }
  if (Array.isArray(data.items)) return { detail: plural(data.items.length, "item") }
  if (Array.isArray(data.createdItems)) return { detail: `${plural(data.createdItems.length, "item")} created` }
  if (Array.isArray(data.updatedItems)) return { detail: `${plural(data.updatedItems.length, "item")} updated` }
  if (Array.isArray(data.deletedItems)) return { detail: `${plural(data.deletedItems.length, "item")} deleted` }
  if (text(data.version)) return { detail: String(data.version) }
  return {}
}

function describeError(code: string, message: string, detail: Json | undefined) {
  if (code === "CONNECTIVITY_UNPROVEN" && detail) {
    const nets = Array.isArray(detail.unconnectedNets) ? detail.unconnectedNets.length : undefined
    if (nets) return `connectivity unproven · ${plural(nets, "unconnected net")}`
  }
  if (code === "PLANE_UNCONNECTED" && detail) {
    const pads = Array.isArray(detail.unconnectedPads) ? detail.unconnectedPads.length : 0
    const vias = Array.isArray(detail.unconnectedVias) ? detail.unconnectedVias.length : 0
    if (pads || vias) return `plane not connected · ${plural(pads, "pad")} · ${plural(vias, "via")}`
  }
  const firstLine = message.split("\n")[0]!.trim()
  return `${code}: ${firstLine.length > 160 ? firstLine.slice(0, 159) + "…" : firstLine}`
}

/** Summarize one KiCad tool call from its input and the text the tool returned. */
export function summarizeTool(call: {
  tool: string
  input?: Json
  status: string
  output?: string
  error?: string
}): ToolSummary {
  const input = call.input ?? {}
  const base = { action: toolAction(call.tool, input), target: toolTarget(call.tool, input), artifacts: [] as string[] }
  if (call.status === "pending" || call.status === "running") return { ...base, state: "running" }
  if (call.status === "error") {
    const message = call.error ?? "Tool failed"
    return { ...base, state: "failed", detail: message.split("\n")[0]!.slice(0, 200) }
  }
  const output = call.output?.trim() ?? ""
  let result: Json | undefined
  try {
    result = record(JSON.parse(output))
  } catch {
    result = undefined
  }
  if (!result) {
    const saved = /Full output saved to: (\S+)/.exec(output)?.[1]
    if (saved) return { ...base, state: "unknown", detail: "large result saved to the tool output folder", savedOutput: saved }
    return { ...base, state: "unknown", detail: output ? output.split("\n")[0]!.slice(0, 160) : undefined }
  }
  const artifacts = Array.isArray(result.artifacts)
    ? result.artifacts.filter((item): item is string => typeof item === "string")
    : []
  const action = text(result.action) ?? base.action
  if (result.ok === false) {
    const error = record(result.error) ?? {}
    const code = text(error.code) ?? "FAILED"
    return {
      ...base,
      action,
      code,
      state: VERDICTS.has(code) ? "issues" : "failed",
      detail: describeError(code, text(error.message) ?? "", record(error.detail)),
      artifacts,
      result,
    }
  }
  const data = record(result.data) ?? {}
  const described = describeData(action, data)
  const files = artifacts.map(basename)
  const produced = files.length ? "→ " + files.slice(0, 2).join(", ") + (files.length > 2 ? ` +${files.length - 2}` : "") : undefined
  const detail = described.detail ?? produced ?? (result.ok === true ? "done" : undefined)
  return { ...base, action, state: described.state ?? (result.ok === true ? "ok" : "unknown"), detail, artifacts, result }
}

export type CheckName = "DRC" | "ERC" | "Connectivity" | "Audit" | "Release" | "3D" | "Impedance" | "DFM" | "Plane"

const CHECKS: Array<[RegExp, CheckName]> = [
  [/(^|\.)drc(\.|$)/, "DRC"],
  [/(^|\.)erc(\.|$)/, "ERC"],
  [/connectivity/, "Connectivity"],
  [/^audit\.run$/, "Audit"],
  [/^release\.check$/, "Release"],
  [/check\.(3d|unified)|step/, "3D"],
  [/impedance\.check/, "Impedance"],
  [/\.dfm\./, "DFM"],
  [/plane\.verify/, "Plane"],
]

export function checkName(action: string): CheckName | undefined {
  return CHECKS.find(([pattern]) => pattern.test(action))?.[1]
}

/** Latest result per design check, and produced files, from a session's tool calls (oldest first). */
export function sessionEvidence(calls: ToolSummary[]) {
  const checks = new Map<CheckName, ToolSummary>()
  const outputs: string[] = []
  for (const call of calls) {
    if (call.state === "running") continue
    const name = checkName(call.action)
    if (name) checks.set(name, call)
    for (const file of call.artifacts) {
      const index = outputs.indexOf(file)
      if (index >= 0) outputs.splice(index, 1)
      outputs.push(file)
    }
  }
  return { checks: [...checks.entries()].map(([name, summary]) => ({ name, summary })), outputs: outputs.slice(-6) }
}

type PartLike = {
  id: string
  tool: string
  state: { status: string; input?: Json; output?: string; error?: string }
}
const cache = new Map<string, { key: string; summary: ToolSummary }>()

/** summarizeTool for a transcript part, cached so streaming updates don't re-parse large results. */
export function summarizePart(part: PartLike) {
  const output = part.state.status === "completed" ? part.state.output : undefined
  const error = part.state.status === "error" ? part.state.error : undefined
  const key = `${part.state.status}:${output?.length ?? 0}:${error?.length ?? 0}:${JSON.stringify(part.state.input ?? {}).length}`
  const hit = cache.get(part.id)
  if (hit && hit.key === key) return hit.summary
  const summary = summarizeTool({ tool: part.tool, input: part.state.input, status: part.state.status, output, error })
  cache.delete(part.id)
  cache.set(part.id, { key, summary })
  if (cache.size > 500) cache.delete(cache.keys().next().value!)
  return summary
}

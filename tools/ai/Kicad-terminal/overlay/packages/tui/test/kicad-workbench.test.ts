import { describe, expect, test } from "bun:test"
import {
  checkName,
  connection,
  displayWidth,
  middle,
  sessionEvidence,
  summarizePart,
  summarizeTool,
  toolAction,
  toolTarget,
  type KiCadStatus,
} from "../src/kicad/summary"

const board = "/Users/me/projects/RK3308B_IPC 摄像头模块/RK3308B_IPC 摄像头模块.kicad_pcb"
const json = (value: unknown) => JSON.stringify(value)

describe("KiCad tool summaries", () => {
  test("names the native action and document for each tool shape", () => {
    expect(toolAction("kicad_board", { action: "board.drc.live" })).toBe("board.drc.live")
    expect(toolAction("kicad_health", {})).toBe("system.health")
    expect(toolAction("kicad_pipeline", { operation: "run", project: "/p" })).toBe("pipeline.run")
    expect(toolAction("kicad_native_tools", { operation: "search" })).toBe("editor.native.search")
    expect(toolTarget("kicad_board", { action: "board.drc.live", payload: { document: board } })).toBe(
      "RK3308B_IPC 摄像头模块.kicad_pcb",
    )
    expect(toolTarget("kicad_board", { action: "x", payload: { document: { path: "/a/b.kicad_pcb" } } })).toBe(
      "b.kicad_pcb",
    )
    expect(toolTarget("kicad_pipeline", { operation: "run", project: "/work/demo" })).toBe("demo")
  })

  test("reports rule-check violations as issues, never as passing", () => {
    const output = json({
      ok: true,
      action: "board.drc.live",
      data: { status: "violations", summary: { total: 1543, bySeverity: { error: 1068, warning: 475 } } },
    })
    const summary = summarizeTool({ tool: "kicad_board", input: { action: "board.drc.live" }, status: "completed", output })
    expect(summary.state).toBe("issues")
    expect(summary.detail).toBe("1,543 issues · 1,068 errors · 475 warnings")
    const clean = summarizeTool({
      tool: "kicad_schematic",
      input: { action: "schematic.erc.run" },
      status: "completed",
      output: json({ ok: true, data: { status: "clean", summary: { total: 0, bySeverity: {} } } }),
    })
    expect(clean.state).toBe("ok")
    expect(clean.detail).toBe("clean")
  })

  test("separates broken calls from design verdicts", () => {
    const bad = summarizeTool({
      tool: "kicad_board",
      input: { action: "board.export.vrml" },
      status: "completed",
      output: json({ ok: false, action: "board.export.vrml", error: { code: "BAD_INPUT", message: "layers is required" } }),
    })
    expect(bad.state).toBe("failed")
    expect(bad.detail).toBe("BAD_INPUT: layers is required")
    const verdict = summarizeTool({
      tool: "kicad_board",
      input: { action: "board.connectivity.prove" },
      status: "completed",
      output: json({
        ok: false,
        error: { code: "CONNECTIVITY_UNPROVEN", message: "Native connectivity proof failed", detail: { unconnectedNets: ["GND", "+3V3"] } },
      }),
    })
    expect(verdict.state).toBe("issues")
    expect(verdict.detail).toBe("connectivity unproven · 2 unconnected nets")
    const crashed = summarizeTool({ tool: "kicad_board", input: { action: "board.items.get" }, status: "error", error: "Socket closed\nstack" })
    expect(crashed.state).toBe("failed")
    expect(crashed.detail).toBe("Socket closed")
  })

  test("describes health, documents, counts and artifacts", () => {
    const health = summarizeTool({
      tool: "kicad_health",
      status: "completed",
      output: json({
        ok: true,
        action: "system.health",
        data: {
          kicadCli: { available: true, version: "10.99.0" },
          ipc: { available: true },
          documents: { ok: true, data: { documents: [{ type: "DOCTYPE_PCB", boardFilename: "a.kicad_pcb" }] } },
        },
      }),
    })
    expect(health.detail).toBe("CLI 10.99.0 · IPC connected · 1 open document")
    const docs = summarizeTool({
      tool: "kicad_document",
      input: { action: "document.list" },
      status: "completed",
      output: json({
        ok: true,
        data: {
          documents: [
            { type: "DOCTYPE_PCB", boardFilename: "a.kicad_pcb", project: { name: "a" } },
            { type: "DOCTYPE_SCHEMATIC", project: { name: "a", path: "/p/" } },
          ],
        },
      }),
    })
    expect(docs.detail).toBe("a.kicad_pcb, a.kicad_sch")
    const snapshot = summarizeTool({
      tool: "kicad_board",
      input: { action: "pcb.snapshot" },
      status: "completed",
      output: json({ ok: true, data: { counts: { FootprintInstance: 155, Track: 1329, Via: 77, Zone: 3 } } }),
    })
    expect(snapshot.detail).toBe("155 footprints · 1,329 tracks · 77 vias")
    const netlist = summarizeTool({
      tool: "kicad_schematic",
      input: { action: "schematic.export.netlist" },
      status: "completed",
      output: json({ ok: true, data: { exitCode: 0 }, artifacts: ["/out/schematic.net"] }),
    })
    expect(netlist.state).toBe("ok")
    expect(netlist.artifacts).toEqual(["/out/schematic.net"])
    expect(netlist.detail).toBe("→ schematic.net")
    const load = summarizeTool({
      tool: "kicad_load",
      status: "completed",
      output: json({ ok: true, action: "tools.load", data: { tools: ["kicad_health"], count: 20 } }),
    })
    expect([load.action, load.state, load.detail]).toEqual(["tools.load", "ok", "20 KiCad tools loaded"])
  })

  test("keeps oversized results honest and points at the saved file", () => {
    const summary = summarizeTool({
      tool: "kicad_board",
      input: { action: "board.connectivity.prove" },
      status: "completed",
      output: "\n\n...4061331 bytes truncated...\n\nFull output saved to: /tmp/tool_abc\nUse the Task tool",
    })
    expect(summary.state).toBe("unknown")
    expect(summary.savedOutput).toBe("/tmp/tool_abc")
    expect(summary.artifacts).toEqual([])
    expect(summarizeTool({ tool: "kicad_board", input: { action: "x" }, status: "running" }).state).toBe("running")
  })

  test("collects the latest result per check and recent outputs", () => {
    const drc = (total: number) =>
      summarizeTool({
        tool: "kicad_board",
        input: { action: "board.drc.run" },
        status: "completed",
        output: json({ ok: true, data: { summary: { total, bySeverity: { error: total } } } }),
      })
    const svg = summarizeTool({
      tool: "kicad_board",
      input: { action: "board.export.svg" },
      status: "completed",
      output: json({ ok: true, data: {}, artifacts: ["/o/a.svg"] }),
    })
    const evidence = sessionEvidence([drc(5), svg, drc(0), svg])
    expect(evidence.checks.map((item) => [item.name, item.summary.detail])).toEqual([["DRC", "clean"]])
    expect(evidence.outputs).toEqual(["/o/a.svg"])
    expect(checkName("schematic.erc.live")).toBe("ERC")
    expect(checkName("board.connectivity.prove")).toBe("Connectivity")
    expect(checkName("board.check.3d")).toBe("3D")
    expect(checkName("board.items.get")).toBeUndefined()
  })

  test("caches part summaries until the part changes", () => {
    const part = {
      id: "prt_1",
      tool: "kicad_board",
      state: { status: "completed", input: { action: "board.drc.run" }, output: json({ ok: true, data: {} }) },
    }
    const first = summarizePart(part)
    expect(summarizePart(part)).toBe(first)
    const changed = summarizePart({ ...part, state: { ...part.state, output: json({ ok: false, error: { code: "X", message: "m" } }) } })
    expect(changed).not.toBe(first)
    expect(changed.state).toBe("failed")
  })
})

describe("KiCad status display", () => {
  const status = (patch: Partial<KiCadStatus>): KiCadStatus => ({
    tools: true,
    cli: { available: true, version: "10.99.0" },
    ipc: { available: false },
    documents: [],
    projects: [],
    checkedAt: 0,
    ...patch,
  })

  test("derives one connection state", () => {
    expect(connection(undefined)).toBe("checking")
    expect(connection(status({ tools: false }))).toBe("unavailable")
    expect(connection(status({ ipc: { available: true } }))).toBe("connected")
    expect(connection(status({}))).toBe("cli")
    expect(connection(status({ cli: { available: false } }))).toBe("offline")
  })

  test("shortens names by terminal width and keeps the extension", () => {
    const name = "RK3308B_IPC 摄像头模块.kicad_pcb"
    expect(displayWidth(name)).toBe(name.length + 5)
    const short = middle(name, 20)
    expect(displayWidth(short)).toBeLessThanOrEqual(20)
    expect(short.endsWith(".kicad_pcb")).toBe(true)
    expect(short).toContain("…")
    expect(middle("a.kicad_pcb", 40)).toBe("a.kicad_pcb")
  })
})

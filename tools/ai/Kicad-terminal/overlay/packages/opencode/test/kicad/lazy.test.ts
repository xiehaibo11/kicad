import { describe, expect, test } from "bun:test"
import { KicadLazy } from "../../src/kicad/lazy"
import { needsKiCadTools } from "../../src/kicad/tools-policy"

const user = (sessionID: string, text: string) => ({ info: { role: "user", sessionID }, parts: [{ type: "text", text }] })
const tool = (sessionID: string, name: string, status = "completed") => ({
  info: { role: "assistant", sessionID },
  parts: [{ type: "tool", tool: name, state: { status } }],
})

describe("KiCad tools on demand", () => {
  test("recognizes KiCad work in Chinese and English, not ordinary software work", () => {
    for (const text of ["跑一下 DRC", "给 U1 做 BGA 扇出", "导出 Gerber 和坐标文件", "open demo.kicad_pcb", "Check the KiCad connection", "U3 的供电接对了吗", "/kicad-fab"])
      expect(needsKiCadTools(text)).toBe(true)
    for (const text of ["你好", "如何封装一个 JavaScript 类", "调整一下页面布局", "reduce the memory footprint", "fan-out in Kafka", "EDA in pandas", "ASP.NET routing", "use D3 for charts"])
      expect(needsKiCadTools(text)).toBe(false)
  })

  test("keeps KiCad tools out of unrelated sessions; the loader is always available", () => {
    expect(KicadLazy.isDeferred("kicad_board")).toBe(true)
    expect(KicadLazy.isDeferred("kicad_load")).toBe(false)
    expect(KicadLazy.isDeferred("bash")).toBe(false)
    expect(KicadLazy.active([user("s-plain", "write a python script")])).toBe(false)
  })

  test("loads on a KiCad request, a finished kicad_load or earlier KiCad tool use, then stays loaded", () => {
    expect(KicadLazy.active([user("s-intent", "检查一下原理图的 ERC")])).toBe(true)
    expect(KicadLazy.active([user("s-loader", "check this project"), tool("s-loader", "kicad_load", "running")])).toBe(false)
    expect(KicadLazy.active([user("s-loader", "check this project"), tool("s-loader", "kicad_load")])).toBe(true)
    expect(KicadLazy.active([user("s-legacy", "继续"), tool("s-legacy", "kicad_board")])).toBe(true)
    // After compaction the evidence may be gone; the session keeps its tools.
    expect(KicadLazy.active([user("s-loader", "继续")])).toBe(true)
    expect(KicadLazy.GUIDE).toContain("# KiCad tools are loaded")
  })
})

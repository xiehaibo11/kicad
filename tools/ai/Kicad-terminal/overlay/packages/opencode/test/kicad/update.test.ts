import { describe, expect, test } from "bun:test"
import { createHash } from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import { KicadProduct } from "@opencode-ai/core/kicad/product"
import { KicadUpdate } from "../../src/kicad/update"
import { KicadStatus } from "../../src/kicad/status"

const pkg = `/node_modules/${KicadProduct.packageName}/vendor/darwin-arm64/kicad-terminal`

describe("Kicad installation detection", () => {
  test("trusts the launcher's declaration", () => {
    expect(KicadUpdate.detect({ env: { KICAD_INSTALL_METHOD: "npx", KICAD_PACKAGE_ROOT: "/x" }, execPath: "/y" })).toEqual({
      method: "npx",
      root: "/x",
    })
    expect(KicadUpdate.detect({ env: { KICAD_INSTALL_METHOD: "bogus" }, execPath: "/y", exists: () => false })).toEqual({
      method: "unknown",
    })
  })

  test("recognizes package-manager layouts from the runtime path", () => {
    const env = {}
    expect(KicadUpdate.detect({ env, execPath: "/opt/homebrew/lib" + pkg })).toEqual({
      method: "npm",
      root: `/opt/homebrew/lib/node_modules/${KicadProduct.packageName}`,
    })
    expect(KicadUpdate.detect({ env, execPath: "/Users/a/.npm/_npx/123" + pkg }).method).toBe("npx")
    expect(KicadUpdate.detect({ env, execPath: "/Users/a/Library/pnpm/global/5/.pnpm/x" + pkg }).method).toBe("pnpm")
    expect(KicadUpdate.detect({ env, execPath: "/Users/a/.bun/install/global" + pkg }).method).toBe("bun")
  })

  test("recognizes standalone and development builds", () => {
    const env = {}
    const standalone = KicadUpdate.detect({
      env,
      execPath: "/Users/a/.local/bin/kicad-terminal",
      exists: (file) => file === "/Users/a/.local/share/kicad-terminal/session-runtime.mjs",
    })
    expect(standalone).toEqual({ method: "standalone", prefix: "/Users/a/.local" })
    expect(KicadUpdate.detect({ env, execPath: "/repo/tools/ai/Kicad-terminal/dist/kicad-terminal" }).method).toBe("source")
    expect(KicadUpdate.detect({ env, execPath: "/usr/local/bin/kicad-terminal", exists: () => false }).method).toBe("unknown")
  })

  test("only installs in place where Kicad owns the files", () => {
    expect(KicadUpdate.manual({ method: "npm" })).toBeUndefined()
    expect(KicadUpdate.manual({ method: "standalone", prefix: "/p" })).toBeUndefined()
    expect(KicadUpdate.manual({ method: "npx" }, "0.2.1")).toContain(`npx --yes ${KicadProduct.packageName}@0.2.1`)
    expect(KicadUpdate.manual({ method: "source" })).toContain("build.sh")
    expect(KicadUpdate.manual({ method: "unknown" })).toContain("npm install -g")
  })
})

describe("Kicad release channel", () => {
  test("compares Kicad versions, never OpenCode's", () => {
    expect(KicadUpdate.isNewer("0.2.1", "0.2.0")).toBe(true)
    expect(KicadUpdate.isNewer("1.0.0", "0.2.0")).toBe(true)
    expect(KicadUpdate.isNewer("0.2.0", "0.2.0")).toBe(false)
    expect(KicadUpdate.isNewer("0.1.2", "0.2.0")).toBe(false)
    expect(KicadUpdate.isNewer("not-a-version", "0.2.0")).toBe(false)
  })

  test("verifies registry checksums before anything is installed", () => {
    const data = new TextEncoder().encode("package")
    const integrity = "sha512-" + createHash("sha512").update(data).digest("base64")
    const shasum = createHash("sha1").update(data).digest("hex")
    expect(KicadUpdate.verifyIntegrity(data, { integrity })).toBe("sha512")
    expect(KicadUpdate.verifyIntegrity(data, { shasum })).toBe("sha1")
    expect(() => KicadUpdate.verifyIntegrity(new TextEncoder().encode("tampered"), { integrity })).toThrow("integrity")
    expect(() => KicadUpdate.verifyIntegrity(data, {})).toThrow("checksum")
  })
})

describe("Kicad workbench status", () => {
  test("names open documents from native document specifiers", () => {
    expect(
      KicadStatus.documentsFrom(
        [{ type: "DOCTYPE_PCB", boardFilename: "b.kicad_pcb", project: { name: "b", path: "/p" } }],
        "pcb",
      ),
    ).toEqual([{ kind: "pcb", name: "b.kicad_pcb", project: "b", path: "/p/b.kicad_pcb" }])
    expect(KicadStatus.documentsFrom([{ type: "DOCTYPE_SCHEMATIC", project: { name: "b", path: "/p/" } }], "schematic")).toEqual([
      { kind: "schematic", name: "b.kicad_sch", project: "b", path: "/p/b.kicad_sch" },
    ])
    expect(KicadStatus.documentsFrom(undefined, "pcb")).toEqual([])
  })

  test("finds projects near the working directory without descending into dependencies", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kicad-projects-"))
    try {
      fs.mkdirSync(path.join(root, "boards/main"), { recursive: true })
      fs.mkdirSync(path.join(root, "node_modules/x"), { recursive: true })
      fs.writeFileSync(path.join(root, "top.kicad_pro"), "{}")
      fs.writeFileSync(path.join(root, "boards/main/main.kicad_pro"), "{}")
      fs.writeFileSync(path.join(root, "node_modules/x/dep.kicad_pro"), "{}")
      expect(KicadStatus.findProjects(root)).toEqual(["top.kicad_pro", path.join("boards", "main", "main.kicad_pro")])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

import { describe, expect, test } from "bun:test"
import { shouldNotify } from "../../src/cli/upgrade"

const base = { autoupdate: undefined, disabled: false, always: false, current: "0.2.0", latest: "0.2.1" }

describe("Kicad upgrade check", () => {
  test("notifies about every newer Kicad release, including new major versions", () => {
    expect(shouldNotify(base)).toBe(true)
    expect(shouldNotify({ ...base, latest: "0.10.0" })).toBe(true)
    expect(shouldNotify({ ...base, latest: "1.0.0" })).toBe(true)
  })

  test("does not offer the installed or an older release", () => {
    expect(shouldNotify({ ...base, latest: "0.2.0" })).toBe(false)
    expect(shouldNotify({ ...base, latest: "0.1.2" })).toBe(false)
  })

  test("treats true and notify the same", () => {
    expect(shouldNotify({ ...base, autoupdate: true })).toBe(true)
    expect(shouldNotify({ ...base, autoupdate: "notify" })).toBe(true)
  })

  test("never notifies when update checks are disabled", () => {
    expect(shouldNotify({ ...base, autoupdate: false })).toBe(false)
    expect(shouldNotify({ ...base, disabled: true, always: true })).toBe(false)
  })

  test("always-notify flag forces a notice for the current version", () => {
    expect(shouldNotify({ ...base, latest: "0.2.0", always: true })).toBe(true)
  })
})

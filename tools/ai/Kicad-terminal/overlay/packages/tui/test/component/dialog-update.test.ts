import { describe, expect, test } from "bun:test"
import { isUpdate, updateTarget } from "../../src/component/dialog-update"
import { isVersionGreater, visibleNotice } from "../../src/context/update-notification"

describe("Kicad update dialog", () => {
  test("offers any newer Kicad release, including a new major version", () => {
    expect(updateTarget({ current: "0.2.0", latest: "0.2.1" })).toEqual({ type: "latest", version: "0.2.1" })
    expect(updateTarget({ current: "0.2.0", latest: "1.0.0" })).toEqual({ type: "latest", version: "1.0.0" })
    expect(updateTarget({ current: "0.9.0", latest: "0.10.0" })).toEqual({ type: "latest", version: "0.10.0" })
  })

  test("never offers the installed or an older release", () => {
    expect(updateTarget({ current: "0.2.0", latest: "0.2.0" })).toBeUndefined()
    expect(updateTarget({ current: "0.2.0", latest: "0.1.2" })).toBeUndefined()
    expect(updateTarget({ current: "0.2.0" })).toBeUndefined()
    expect(isUpdate("0.2.0", "0.2.0-beta.1")).toBe(false)
  })

  test("skipping a version hides it until a newer one ships", () => {
    const notice = { type: "available" as const, version: "0.2.1" }
    expect(visibleNotice(notice, {})).toEqual(notice)
    expect(visibleNotice(notice, { skippedVersion: "0.2.1" })).toBeUndefined()
    expect(visibleNotice({ type: "available", version: "0.2.2" }, { skippedVersion: "0.2.1" })).toEqual({
      type: "available",
      version: "0.2.2",
    })
    expect(visibleNotice(undefined, {})).toBeUndefined()
  })

  test("compares versions for skipping", () => {
    expect(isVersionGreater("0.2.0", "0.2.0")).toBe(false)
    expect(isVersionGreater("0.2.1", "0.2.0")).toBe(true)
    expect(isVersionGreater("0.9.0", "0.10.0")).toBe(false)
    expect(isVersionGreater("0.2.0", "0.2.0-beta.1")).toBe(true)
  })
})

export * as KicadLazy from "./lazy"

// KiCad tools are loaded on demand. Until a conversation needs them, the model only sees the small
// kicad_load tool; the tool list and system prompt are rebuilt every step, so loading takes effect
// immediately. A conversation needs them once a user message is about KiCad work or a KiCad tool
// (including kicad_load) has run; after that they stay loaded for the session.
import { KICAD_LOAD_TOOL, needsKiCadTools } from "./tools-policy"
import { KICAD_GUIDE } from "./guide"

export const LOADER = KICAD_LOAD_TOOL
export const GUIDE = KICAD_GUIDE

type PartLike = { type: string; tool?: string; text?: string; state?: { status?: string } }
type MessageLike = { info: { role: string; sessionID?: string }; parts: ReadonlyArray<PartLike> }

const loaded = new Set<string>()

/** KiCad tools other than the loader, which is always available. */
export function isDeferred(toolID: string) {
  return toolID.startsWith("kicad_") && toolID !== LOADER
}

function evidence(message: MessageLike) {
  return message.parts.some((part) => {
    if (part.type === "tool" && typeof part.tool === "string" && part.tool.startsWith("kicad_"))
      return part.tool !== LOADER || part.state?.status === "completed"
    return message.info.role === "user" && part.type === "text" && typeof part.text === "string" && needsKiCadTools(part.text)
  })
}

export function active(messages: ReadonlyArray<MessageLike>) {
  const sessionID = messages.find((message) => message.info.sessionID)?.info.sessionID
  if (sessionID && loaded.has(sessionID)) return true
  if (!messages.some(evidence)) return false
  if (sessionID) loaded.add(sessionID)
  return true
}

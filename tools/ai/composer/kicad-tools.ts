// SPDX-License-Identifier: MIT
// KiCad tools are loaded on demand. Shared by the Kicad terminal and the VS Code chat:
// this decides which requests need them and describes the always-present loader.
// Each frontend attaches the tools and kicad-tools-guide.md in its own way.

export const KICAD_LOAD_TOOL = "kicad_load"

export const KICAD_LOAD_DESCRIPTION =
  "Load the built-in KiCad tools and their guidance (schematic, PCB, footprints and symbols, DRC/ERC, " +
  "routing, fabrication outputs, engineering references). Call this once when the request involves KiCad, " +
  "PCB, schematic, footprint or other EDA work and kicad_health, kicad_board and the other KiCad tools are not available."

// Words and file types that only appear in electronics/EDA work. Matching one loads the tools.
// Ambiguous words (封装 = encapsulation, 布局 = UI layout, footprint/fan-out in software) need a qualifier.
const SIGNALS: RegExp[] = [
  /kicad|eeschema|pcbnew|gerbview|kicad-cli/i,
  /\b[\w-]+\.(kicad_\w+|gbr|gtl|gbl|gto|gbo|gts|gbs|drl)\b/i,
  /\b(pcbs?|pcba|schematics?|netlists?|gerbers?|silk-?screen|stack-?up|bga|drc|erc|ipc-?2581|odb\+\+)\b/i,
  /\b((pcb|kicad|symbol and) footprints?|footprint (librar(y|ies)|editor|assignment|wizard)|copper (pour|zone|fill|plane)|ground plane|power plane|via-in-pad|vias|differential pairs?|length (tuning|matching)|trace width|annular ring|solder ?mask|paste ?mask|pick[- ]and[- ]place|reference designators?|bill of materials|board outline|edge\.cuts|[fb]\.cu)\b/i,
  /(原理图|电路图|电路板|线路板|印制板|板子|板框|封装库|元件封装|器件封装|PCB ?封装|焊盘|过孔|走线|布线|铺铜|覆铜|敷铜|网表|网络表|丝印|阻焊|钢网|叠层|阻抗|差分对|等长|扇出|元器件|位号|引脚|管脚|贴片|钻孔文件|坐标文件|制造文件|生产文件|投板|打板|板厂|嘉立创|立创|内电层|地平面|电源层|去耦|STEP ?碰撞|结构干涉)/i,
  /^\s*\/kicad-/m,
]

// Reference designators (U1, R12, C3, J2...) count when the text also talks about hardware.
const DESIGNATOR = /\b(U|R|C|L|J|Q|D|Y|SW|TP|FB|LED)\d{1,3}\b/
const HARDWARE = /(供电|电源|接地|连接|引脚|管脚|阻值|容值|电阻|电容|电感|芯片|接口|\bpins?\b|\bnets?\b|\bgnd\b|\bvcc\b|\bvdd\b|\bpower\b|\bresistor|\bcapacitor|\binductor|\bconnector)/i

export function needsKiCadTools(text: string): boolean {
  if (!text) return false
  if (SIGNALS.some((pattern) => pattern.test(text))) return true
  return DESIGNATOR.test(text) && HARDWARE.test(text)
}

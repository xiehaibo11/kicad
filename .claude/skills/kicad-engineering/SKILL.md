---
name: kicad-engineering
description: Automatically apply source-traceable KiCad engineering references and revision-bound evidence gates when designing or reviewing schematics, components, footprints, power, analog/clock, stackup, PCB layout/routing, SI/PI/DDR/RF/EMC, safety, DFM/DFT, manufacturing packages or production qualification. Use for 原理图设计、工业级 PCB、设计规范、投板、量产 and KiCad original reference designs; no slash command required. Does not change boards for read-only review or claim software checks certify industrial production.
---

# KiCad engineering references

Use for actual design/review/release tasks. Do not turn a greeting, project-open
request or unrelated question into an engineering audit. Preserve user scope.

1. Call `kicad_reference` action `reference.plan` with the actual `query` and/or
   lifecycle `stage`. Use `reference.search` to discover topic IDs and
   `reference.get` to load relevant cards only. MCP unavailable: use
   `kicad-direct call <action> --payload '<JSON>'` with the same action/payload.
2. Resolve required inputs before dependent design decisions. Continue independent
   work; label unknowns. Never guess pinouts, device-specific timing, safety
   distances, manufacturer limits or thermal/EMC qualification. Obtain current
   primary sources via `web.search`/`web.fetch` and retain device/revision/URL.
3. Treat rules as engineering policy. Source authority and applicability matter:
   applicable law/contract and licensed standards, exact device documentation,
   confirmed manufacturer process, official KiCad docs, then expert teaching.
   Class 3, industrial temperature and producibility are separate choices.
   Do not impose universal 3W/20H or default widths/creepage/crystal capacitors.
4. Use typed KiCad actions after inspection. Respect locks and approved scope,
   verify edits with full native checks and readback. Never hide a defect by
   disabling checks, changing net names or weakening constraints.
5. Query `reference.examples` for all original demo projects; `includeFiles:true`
   returns the indexed local file list/hashes. Verify the current example and
   copy to an independent project before experimenting. Indexed does not mean
   electrically reviewed or qualified for manufacture.
6. For release use `release.template` and `release.snapshot`, then
   `release.check` with `project`, `manifest` and explicit `target`:
   `fabrication` or `production`. Read [release evidence](references/release-evidence.md).
   Report actual `pendingEvidence` and artifact paths. A pending template, zero
   DRC, `workflow.confirm` or task status is not engineering acceptance.
7. Report evidence completeness separately from final release. Tools cannot
   authenticate a reviewer, lab report or hardware. Never fabricate evidence or
   impersonate signatories. Final approval belongs to accountable engineering,
   quality and manufacturing people; do not announce industrial production
   readiness without their applicable validation/release process.

The bundled reference service contains detailed cards and a dated source ledger.
Do not bulk-load all topics when only one applies. Built-in tool gaps remain
explicit; an unsupported action is not proof of a completed design step.

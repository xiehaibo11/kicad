# Revision-bound release evidence

`release.template` returns JSON without writing a design file. Save its `manifest`
object as a JSON file yourself. The template is intentionally pending.
`release.snapshot` returns the current local design-file map and its SHA-256 digest.
Resolve exactly one `.kicad_pro`; multi-project directories require a selected path.

```sh
kicad-direct call reference.plan --payload '{"stage":"schematic"}'
kicad-direct call release.template --payload '{"project":"/absolute/board.kicad_pro","target":"production"}'
kicad-direct call release.check --payload '{"project":"/absolute/board.kicad_pro","manifest":"/absolute/release-manifest.json","target":"production"}'
```

Snapshot includes nested local schematics, libraries, 3D models, simulation models,
project/custom rules and `manufacturing.json`. Tool metadata and generated backup directories
are excluded; hidden design-library directories remain included. External library/model dependencies require a locked/versioned
review artifact; copy needed dependencies into the project for a portable release.
Project symlinks are rejected. Review every unresolved model/library.

Put the confirmed manufacturing profile at the project root as `manufacturing.json`:

- Positive millimetre limits: `minClearanceMm`, `minTrackWidthMm`, `minDrillMm`,
  `minAnnularWidthMm`, `minCopperEdgeClearanceMm` (see `audit.rules`). Do not invent
  numbers. These five comparisons are a subset; review all custom rules/processes.
- Nonempty provenance strings: `supplier`, `process`, `source`, `revision`,
  `confirmedAt`, `stackup`, `orderApplicability`. Include the source document/URL,
  actual process and dated order confirmation. Complete geometry, impedance,
  materials, vias, mask, paste and assembly limits belong in reviewed artifacts.

Manifest schema version 1:

- `target`: `fabrication` or `production`; explicitly match the check request.
- `snapshotDigest`: current digest. Product fields: name, revision, requirements,
  environment, manufacturerProcess, applicable standards with editions/rationale.
- `product.features`: analog, clock, highspeed, rf-emc, each `applicable` or
  `not-applicable`; unknown cannot pass.
- `manufacturingProfile`: `{path:"manufacturing.json", sha256:"<actual hash>"}`.
- `reviews`: category, status, reviewer, reviewedAt (RFC3339), snapshotDigest and
  nonempty artifacts, each `{path:"project-relative/file",sha256:"actual hash"}`.
  Paths cannot escape the project. Artifacts must exist, be nonempty and unchanged.

Required fabrication categories are returned by the template: requirements,
schematic, parts, footprints, power, analog, clock, stackup, placement, routing,
highspeed, rf-emc, safety, thermal-reliability, dfm, assembly, dft, rule-exceptions,
manufacturing-output. `not-applicable` is permitted only for the four optional
feature categories, with consistent feature classification, explicit reason,
accountable reviewer and an actual revision-bound applicability artifact.

Production additionally requires prototype-functional, thermal-validation,
emc-safety-validation, reliability-validation, pilot-process and
release-authorization. These must record real specimen/configuration/batch,
conditions, instruments, criteria, results, deviations and accountable reviews.
Never turn placeholder text or a copied reference design into physical-test evidence.

`release.check` runs a fresh `audit.run`, verifies snapshot/artifact stability and
reports every missing/stale/failing item. No source board is modified. Native audit
and release JSON artifacts go to a newly created temporary directory. Preserve them
with the controlled release record. `ok:true` means evidence completeness only.
`fabricationEvidenceComplete` and `productionEvidenceComplete` describe that scope.
`readyForFabrication` and `readyForProduction` intentionally remain false: software
cannot authenticate people, signatures, report truth, physical tests or compliance.
An accountable external release process grants actual approval.

`workflow.*` is task tracking only. Advance cannot skip pending stages or mark
`verified`; a confirmation boolean is never substituted for evidence. Re-run
release checking after changing any design, manufacturer profile or evidence file.

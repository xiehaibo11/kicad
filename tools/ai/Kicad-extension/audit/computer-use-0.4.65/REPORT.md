# Kicad 0.4.65 Computer Control validation

Date: 2026-10-23T22:14:27.089089+00:00. Source commit: [c9331b47627df92032b7836a5ef2a051033e3793](https://github.com/xiehaibo11/kicad/commit/c9331b47627df92032b7836a5ef2a051033e3793).

Release: https://github.com/xiehaibo11/kicad/releases/tag/kicad-extension-v0.4.65

## Delivered behavior

- Independent **Kicad Settings → Computer Control → Enable Computer Control** switch. Application-scope settings cannot be enabled by repository settings. This machine's VS Code and Cursor user settings now enable it; every other parsed setting was preserved. The package default remains opt-in.
- Signed external Cua Driver 0.38.0, supervised by the private `org.kicad.agent.cua-driver` LaunchAgent. Runs without a floating preview or cursor overlay. Survives editor exit and restarts when its daemon terminates. The plist includes RunAtLoad and KeepAlive; login/reboot behavior was not exercised in this session.
- On-demand `computer_tools`, `computer_read`, and `computer_action` capabilities use the existing catalog and normal permissions. Starting the service does not start an agent or capture the screen. Reads and actions check the app allowlist, exact window, workspace trust, and conversation-owned element/capture handles. Off revokes clients, stops the private endpoint and removes its LaunchAgent.
- Settings show TCC status, Restart, Refresh and View Log. Driver diagnostics open in the editor; tool output uses the existing conversation/terminal stream. The signed app has both Accessibility and Screen Recording permission, and actual window captures succeeded.
- Any App and individual KiCad/Chrome/Excel/custom-bundle controls mirror the native application access choices in the reference screenshot. Chrome's browser extension, Excel's add-in, and locked-screen use are separate integrations. This release exposes native app control; it does not install those add-ons or enable locked-screen operation. Chrome and Excel were not exercised as live automation targets.
- Driver core remains an external MIT dependency. Optional AGPL perception components are not bundled or downloaded automatically. Driver source: https://github.com/trycua/cua/tree/main/libs/cua-driver ; tested release: https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.38.0 .

## Defects found and fixed during acceptance

1. Codex optional MCP config fields returned as `null` were invalid override values (including `tool_timeout_sec`). Unset fields are now omitted when constructing per-thread overrides; user config files remain intact.
2. Tool images and structured element handles were lost at provider/archive boundaries. Claude-compatible and Codex routes now preserve image blocks and structured metadata; Codex receives element handles alongside images. Text-only DeepSeek models use accessibility trees.
3. Cua 0.38.0 sometimes rejects its incremental `get_window_state` output with `typed_output_mismatch / returned_element_count does not match elements`. For this specific delta-read error, the adapter performs one full observation of the same window. It preserves unrelated errors and never repeats an input action. The final matrix below includes model-visible successful readback after this fix; earlier diagnostic runs remain local preflight evidence.

## Real model acceptance

Each successful model discovered the computer tools, read the disposable PCB Editor's “Locked items” checkbox, clicked its exact accessibility token once, and received its new value. Independent readback confirmed the same value. The harness restored the checkbox after each model, and the fixture board SHA-256 remained `ad6fbdc7e714662a67eff09cc2eeed00554750e00f381e73fe81ee9780b3cc06`. Final cleanup restored the original selection-filter value and closed only the disposable editor.

| Model | Observation | Result | Seconds |
| --- | --- | --- | --- |
| claude-opus-5-5 | Vision + AX | PASS | 32.9 |
| claude-fable-5-1 | Vision + AX | BLOCKED: usage credits required | 9.4 |
| claude-sonnet-5-5 | Vision + AX | PASS | 25.2 |
| claude-haiku-5-5 | Vision + AX | PASS | 23.7 |
| codex:gpt-6.1-sol | Vision + AX | PASS | 40.7 |
| codex:gpt-6-astra | Vision + AX | PASS | 45.5 |
| codex:gpt-6-sol | Vision + AX | PASS | 39.2 |
| codex:gpt-6-luna | Vision + AX | PASS | 33.2 |
| codex:gpt-5.6-sol | Vision + AX | PASS | 37.8 |
| codex:gpt-5.6-terra | Vision + AX | PASS | 43.3 |
| codex:gpt-5.6-luna | Vision + AX | PASS | 27.1 |
| deepseek-flash | AX only | PASS | 29.1 |
| deepseek-v4-pro | AX only | PASS | 27.9 |

12 passed; 1 blocked. Fable returned API code `credits_required` / `model_requires_usage_credits` before using a tool, so it has no completed screen-control acceptance. No credit purchase or account change was made. These are the 13 locally discovered/configured models, not every model available from every provider.

Live routes: production Cua host adapter + shared DemandCatalog; production Codex adapter/app-server; Claude Agent SDK registration with the same catalog. Claude used the locally installed CLI 2.1.305, matching the production executable resolver. The VSIX also contains the pinned fallback CLI 2.1.83; that older CLI was not the successful live-model route. Test scaffolding used an isolated continuity recorder and a strict fixture-only tool guard. The test checks a non-editing native GUI operation; it does not validate placement, routing, DRC/ERC, or arbitrary application workflows.

## Build, host, UI and installation checks

- `bash tools/ai/Kicad-extension/build.sh`: PASS, including TypeScript, Vue type checks, the extension regression checks, bundling and VSIX artifact checks.
- Shared composer suite: 55 tests passed, 0 failed.
- `test-computer-use.mjs`: PASS for lazy discovery, off/on revocation/reconnect, app/window/token scoping, trust, read/action separation, forbidden file/desktop arguments, media/metadata transport and specific delta-read recovery without action retry.
- `test-computer-ui.cjs`: PASS against the final production bundle using a simulated host. Independent switch, app controls, service/TCC status, restart/log requests and unsupported locked-screen indicator were checked; this UI test performs no OS actions.
- `test-computer-host.cjs`: PASS in an isolated real VS Code Extension Test Host using the final VSIX and actual signed driver. Global settings, enable/off/enable, permission status and actual service stop were checked. After host exit the service was still running; its daemon was then terminated and launchd restarted it. The production LaunchAgent was restored under the real user home.
- Final VSIX installed in VS Code and Cursor. All 1218 packaged files matched both installed payloads; only installer-owned `package.json.__metadata` was excluded from comparison. No editor reload was forced during the user's work.
- `python3 tools/ai/build-manifest.py verify tools/ai/Kicad-extension`: PASS. All 141 selected source files match the release commit. The user's branch, HEAD and empty staging index were preserved using an isolated release index.

## Artifacts and limits

VSIX SHA-256: `1fcb99cce1734ffaab07014606e54a7ee81c6da83338e7631fd9acfe8ace5c5d`.

Build source digest: `f99aa94d099e5c12e41c694a5b7403247380fa10e86a9b8eab49a850dad55f1e`.

GitHub Release assets include the VSIX, build manifest, this report, the sanitized model-validation JSON and SHA256SUMS. The upload/public download verification is recorded separately in local `release.json` after publication. Local `final-models/models.json`, `host.json`, `host-persistence.json`, `service.json`, `ui.json`, `installation.json`, `fixture-cleanup.json`, build logs and screenshots retain detailed evidence. The settings screenshot uses the production UI with a simulated host; `actual-kicad-fixture.png` is an actual Cua capture of the disposable KiCad editor.

Release channel: GitHub Release. No npm or Marketplace publication is claimed. Restart the editor window after current work to activate the newly installed extension code. macOS must be unlocked; this session did not perform a reboot, long-duration soak, Chrome/Excel add-in test, or native engineering acceptance.

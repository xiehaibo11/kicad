# Clickable Read images in the editor — 0.4.61

Implemented and locally installed. File-backed `Read` image results now expose a blue filename in the step header and an image link in OUT. Click, Enter or Space opens VS Code's built-in image editor in the first editor group. Reading an image does not open it automatically.

## Mechanism and cause

The previous timeline renderer reduced image blocks to `[图片]`, losing their usable file reference in the view. The existing `open_file` handler always used `workspace.openTextDocument` and `showTextDocument`, which target text editors.

The new path is:

1. `executionSteps.ts` retains the original `Read.input.file_path` alongside its display filename. Original image bytes and tool results remain intact in the message model.
2. `ExecutionSteps.vue` and `ExecutionIO.vue` send the existing `context.fileOpener.open(path)` request when the user activates the filename or OUT link.
3. The extension host resolves and checks the exact image path, then calls `vscode.openWith(uri, 'imagePreview.previewEditor', {viewColumn: One, preview: true, preserveFocus: true})`.
4. VS Code supplies its normal editor tab, breadcrumbs, zoom and image status. The chat does not create an image modal or an external viewer.

The installed VS Code media-preview manifest declares `imagePreview.previewEditor` for PNG/JPG/JPEG/JPE/GIF/WebP/BMP/ICO/AVIF/SVG. This matches the native image preview visible in the supplied Claude screenshot. The supplied source-restoration repositories also render Read paths as clickable `FilePathLink` entries, using OSC 8 file hyperlinks in their terminal renderer; that terminal implementation alone does not implement VS Code's editor UI. No third-party source was copied.

Image paths bypass fuzzy file matching so a missing temporary image cannot silently open a different file. Chinese names, spaces and relative paths are preserved. URLs are not treated as local image paths. Opening errors propagate back through the chat wrapper and appear in the tool row, where the link can be retried. Ordinary text selection and directory opening retain their existing behavior.

## Verification

- `bash tools/ai/Kicad-extension/build.sh` passed TypeScript/Vue checks and the complete packaged-extension regression suite, including the new image handler test. Existing subagent authorization enforcement still passed its real SDK/CLI loopback fixture: 8 queries, 11 turns, zero unauthorized child queries.
- `test-editor-images.mjs` passed the assembled production handler through supported formats, exact/relative/Chinese/space paths, missing files, host errors, text selections and directories.
- `test-editor-images-ui.cjs` passed against the final production webview bundle: filename click, OUT Enter, filename Space, no automatic open, no modal/popup, preserved original paths, mixed text/image results, historical `[图片]`, failed Read, open failure/retry, continued streaming and 320px layout. Events and host responses are simulated; the screenshots explicitly label this. No model calls were made.
- `test-execution-steps-ui.cjs` passed against the same bundle, covering existing execution rows and composer/sent-image behavior.
- A real isolated VS Code 1.136.1 Extension Test Host with package 0.4.61 ran the assembled production `open_file` handler using the real VS Code API. It opened the supplied PCB PNG as `imagePreview.previewEditor` in group 1 and retained a visible adjacent test panel in group 2. See `native-host-final.json`. This validates the native editor separately from the simulated webview transport; it is not a live model conversation test.
- `test-bundle.mjs` and `build-manifest.py verify` passed. All 1,217 installed package files were verified against the VSIX; only VS Code's added package metadata was excluded from comparison.

UI evidence: `../../Kicad-extension/audit/editor-images-0.4.61/clickable-read.png` and `narrow-320.png`. `current-request.patch` isolates this request from the pre-existing dirty worktree. `native-host-initial-single-group.json` is an initial diagnostic run; the final two-group acceptance is `native-host-final.json`.

## Delivery and activation

Artifact: `tools/ai/Kicad-extension/dist/kicad-0.4.61.vsix`.

Installed: `/Users/mosc/.vscode/extensions/kicad-agent.kicad-0.4.61`.

VSIX SHA-256: `c5a9789895636db079c8f4be4184d4048e1d163122d20bab81aae2aec37c6af2`.

Source SHA-256: `7471c648b957f985cd6de05c42635013c7688b7ad11dd804ba60c438e6c054fa`.

The existing user window was not reloaded. Installation does not replace code already loaded in that window. Use **Developer: Reload Window** after the current task finishes to activate the installed version. No public release or live hardware change was performed.

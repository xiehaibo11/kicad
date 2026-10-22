# Kicad terminal overlay

Sources that the `apply-*.mjs` scripts copy into the pinned OpenCode checkout
(`cache/Kicad`, see `../upstream.json`). Every file sits at the **same relative path**
it takes in that checkout, for example `packages/tui/src/kicad/status.tsx` is copied to
`cache/Kicad/packages/tui/src/kicad/status.tsx`. Files that replace an upstream file
(`dialog-update.tsx`, `update-notification.tsx`, `cli/upgrade.ts`, ...) use the upstream
name. `session-runtime.ts` is the exception: `build-session-runtime.sh` bundles it on its own.

The overlay is not a standalone package. Imports such as `../context/helper`, `solid-js`
or `@/kicad/update` refer to the checkout, so editors need it to type-check:

```sh
bash tools/ai/Kicad-terminal/build.sh        # installs cache/Kicad and links it
bash tools/ai/Kicad-terminal/link-overlay.sh # relink only, when cache/Kicad already exists
```

`packages/tui/tsconfig.json`, `packages/opencode/tsconfig.json` and `tsconfig.json` (for
`session-runtime.ts`) extend the checkout's own settings and use `rootDirs`, so relative
imports resolve to the overlay file first and to the checkout otherwise. The linked
`node_modules` are ignored by git. Upstream ambient declarations come from the checkout.

Which script copies which file:

| Script | Files |
| --- | --- |
| `apply-composer.mjs` | `packages/opencode/.../groups/kicad-composer.ts`, `.../handlers/kicad-composer.ts`, `packages/tui/src/component/prompt/kicad-composer.tsx`, `packages/tui/test/kicad-composer.test.tsx` |
| `apply-waiting.mjs` | `packages/tui/src/component/kicad-waiting.tsx`, `packages/tui/test/kicad-waiting.test.tsx` |
| `apply-reasoning.mjs` | `packages/tui/src/component/dialog-variant.tsx` |
| `apply-workbench.mjs` | everything else under `packages/` |

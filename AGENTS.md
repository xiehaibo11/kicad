# Repository Guidelines

## Project Structure & Module Organization

This fork combines KiCad’s C++20 desktop applications with AI automation tools.
- `eeschema/` and `pcbnew/`: schematic and PCB editors; `kicad/`: project manager and CLI.
- `common/`, `include/`, and `libs/`: shared implementation and interfaces; `api/proto/`: IPC protocol definitions.
- `tools/ai/direct/`: shared JavaScript backend; `tools/ai/composer/`: shared interaction logic; `tools/ai/Kicad-terminal/` and `tools/ai/Kicad-extension/`: terminal and chat extension adaptations. `tools/ai/vscode-extension/` is the legacy extension.
- `qa/tests/` and `qa/data/`: native/CLI tests and fixtures; `resources/`, `translation/`, and `demos/`: assets, translations, and examples.

## Build, Test, and Development Commands

Install platform-specific native dependencies first; consult `INSTALL.txt`, `CMakePresets.json.sample`, and `tools/ai/README.md`. AI builds require Node.js 22+, Bun, and pnpm.

- `cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug -DKICAD_BUILD_QA_TESTS=ON`: configure native code and tests; add platform dependency paths as needed.
- `cmake --build build --parallel`: compile configured targets.
- `ctest --test-dir build --output-on-failure`: run registered native and CLI tests.
- `npm ci --ignore-scripts --prefix tools/ai/direct`: install backend dependencies.
- `npm run generate --prefix tools/ai/direct` and `npm run build --prefix tools/ai/direct`: regenerate and bundle the backend.
- `npm test --prefix tools/ai/direct`: run backend tests.
- `bash tools/ai/Kicad-terminal/build.sh` or `bash tools/ai/Kicad-extension/build.sh`: build the corresponding interface.

## Coding Style & Naming Conventions

Follow surrounding code. C++ uses four spaces, Allman braces, and a 120-column limit; consult `_clang-format` and `.clang-tidy`. Common conventions include `UPPER_SNAKE_CASE` classes, `PascalCase` methods, `m_` members, and `aParameter` arguments. Preserve existing include order and avoid unrelated formatting. Match each JavaScript/TypeScript package’s local style; edit protocol sources rather than generated bindings.

## Testing Guidelines

Native tests use Boost.Test; CLI tests use pytest; backend tests use Node’s test runner (`test/*.test.mjs`). Add regression cases near the affected module and reusable fixtures under `qa/data/`. Follow existing `test_*.cpp`/`test_*.py` naming. Report commands and results; distinguish unit tests from live IPC and UI verification.

## Commit & Pull Request Guidelines

History favors short imperative subjects, optionally prefixed by a subsystem, such as `Jobs: add progress reporting`. Keep commits focused. Describe behavior changes, linked issues, validation, and screenshots for UI changes. Follow `CONTRIBUTING.md` for upstream GitLab submissions and tool-generated contribution policy.

## Workspace Safety

Inspect Git status before editing and preserve unrelated changes. Keep credentials and local provider configuration out of commits. Preserve third-party licenses and provenance.

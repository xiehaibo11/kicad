#!/usr/bin/env bash
# End-to-end functional test for the kicad-agent terminal.
#
# Requires a built kicad-cli (with eeschema/pcbnew/cvpcb kifaces) and the
# kicad-agent binary.  Runs DRC/ERC headlessly and exercises the IPC actions
# against a temporary copy of a QA board.  Does not modify QA fixtures.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$AGENT_ROOT/../../.." && pwd)"

CLI="${KICAD_CLI:-$REPO_ROOT/build/kicad/KiCad.app/Contents/MacOS/kicad-cli}"
if [ ! -x "$CLI" ]; then
  CLI="$REPO_ROOT/build/bin/kicad-cli"
fi
AGENT="${KICAD_AGENT:-$REPO_ROOT/build/bin/kicad-agent}"
if [ ! -x "$AGENT" ]; then
  AGENT="$AGENT_ROOT/bin/kicad-agent"
fi

if [ ! -x "$CLI" ]; then
  echo "kicad-cli not found; set KICAD_CLI" >&2
  exit 1
fi
if [ ! -x "$AGENT" ]; then
  echo "kicad-agent not found; set KICAD_AGENT" >&2
  exit 1
fi

TMP="$(mktemp -d)"
SOCK="$TMP/api.sock"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

export KICAD_RUN_FROM_BUILD_DIR=1
export KICAD_CONFIG_HOME="$REPO_ROOT/qa/data/config"
export KICAD9_SYMBOL_DIR="$REPO_ROOT/qa/data/libraries"
export KICAD10_SYMBOL_DIR="$REPO_ROOT/qa/data/libraries"
export KICAD10_FOOTPRINT_DIR="$REPO_ROOT/qa/data/libraries"

BOARD="$TMP/board.kicad_pcb"
cp "$REPO_ROOT/qa/data/pcbnew/teardrop_close_via.kicad_pcb" "$BOARD"

cat > "$TMP/spec.json" <<'EOF'
{
  "board": {"outline": "compact", "widthMm": 30, "heightMm": 45},
  "stackup": {"layers": 4, "innerLayers": ["GND"]},
  "modules": [{"name": "MCU", "kind": "MCU"}],
  "flow": ["MCU", "IO"]
}
EOF

cat > "$TMP/stackup.json" <<'EOF'
{
  "layers": [
    {"layer": "BL_F_Cu", "type": "BSLT_COPPER", "thickness": {"valueNm": "35000"}},
    {"layer": "BL_UNDEFINED", "type": "BSLT_DIELECTRIC", "dielectric": {"layer": [{"epsilonR": 4.5, "thickness": {"valueNm": "1440000"}}]}},
    {"layer": "BL_B_Cu", "type": "BSLT_COPPER", "thickness": {"valueNm": "35000"}}
  ]
}
EOF

echo "== headless CLI checks =="
"$AGENT" version > "$TMP/version.json"
set +e
"$CLI" pcb drc "$BOARD" -o "$TMP/drc-timeout.json" --format json --timeout 1 \
  > "$TMP/drc-timeout.log" 2>&1
echo "$?" > "$TMP/drc-timeout.code"
"$CLI" sch erc "$REPO_ROOT/qa/data/eeschema/erc_wire_endpoints.kicad_sch" \
  -o "$TMP/erc.json" --format json > "$TMP/erc.log" 2>&1
echo "$?" > "$TMP/erc.code"
set -e

"$AGENT" health --kicad-cli "$CLI" > "$TMP/health.json" || true
"$AGENT" actions > "$TMP/actions.json"
"$AGENT" spec validate "$TMP/spec.json" > "$TMP/spec.out.json" || true
"$AGENT" blocks ls > "$TMP/blocks.json"
"$AGENT" impedance calculate --stackup "$TMP/stackup.json" --layer F.Cu --target 50 \
  > "$TMP/impedance.json"

echo "== IPC checks =="
"$CLI" api-server "$BOARD" --socket "$SOCK" > "$TMP/server.log" 2>&1 &
SERVER_PID=$!

python3 - "$SOCK" <<'PY'
import os, sys, time
sock = sys.argv[1]
for _ in range(300):
    if os.path.exists(sock):
        sys.exit(0)
    time.sleep(0.1)
sys.exit(1)
PY

"$AGENT" --socket "$SOCK" --kicad-cli "$CLI" health > "$TMP/health-ipc.json"
"$AGENT" --socket "$SOCK" call board.stackup.read \
  --payload "{\"document\":{\"type\":\"pcb\",\"path\":\"$BOARD\"}}" > "$TMP/stackup.out.json"
"$AGENT" --socket "$SOCK" call board.connectivity.prove \
  --payload "{\"document\":{\"type\":\"pcb\",\"path\":\"$BOARD\"},\"nets\":[\"Net1\"]}" \
  > "$TMP/connectivity.json"
"$AGENT" --socket "$SOCK" route autoroute --document "$BOARD" --planner grid \
  --dry-run > "$TMP/grid-dry.json" 2>/dev/null || true
"$AGENT" --socket "$SOCK" call system.capabilities --payload '{}' \
  > "$TMP/caps.json" 2>/dev/null || true
"$AGENT" --socket "$SOCK" call board.jobs.svg \
  --payload "{\"document\":{\"type\":\"pcb\",\"path\":\"$BOARD\"},\"output\":\"$TMP/job.svg\",\"layers\":[\"F.Cu\"]}" \
  > "$TMP/job-run.json" 2>/dev/null || true
JOB_ID=$(python3 -c "import json,sys; print(json.load(open('$TMP/job-run.json'))['data'].get('jobId',''))" 2>/dev/null || true)
if [ -n "$JOB_ID" ]; then
  "$AGENT" --socket "$SOCK" call job.status --payload "{\"jobId\":\"$JOB_ID\"}" \
    > "$TMP/job-status.json" 2>/dev/null || true
fi
"$AGENT" --socket "$SOCK" dfm analyze --document "$BOARD" --min-width-mm 0.3 \
  > "$TMP/dfm-analyze.json" 2>/dev/null || true
"$AGENT" --socket "$SOCK" dfm fix --document "$BOARD" --min-width-mm 0.3 --apply \
  > "$TMP/dfm-fix.json" 2>/dev/null || true
"$AGENT" --socket "$SOCK" fanout run --document "$BOARD" --reference P1 \
  --style via-in-pad --dry-run > "$TMP/fanout.json"
"$AGENT" --socket "$SOCK" structural check --document "$BOARD" \
  > "$TMP/structural.json"

"$CLI" pcb export step "$BOARD" -o "$TMP/board.step" > "$TMP/step-export.log" 2>&1 || true
if [ -x "$REPO_ROOT/build/bin/kicad-stepcheck" ]; then
  set +e
  "$REPO_ROOT/build/bin/kicad-stepcheck" --self-test > "$TMP/stepcheck.json"
  echo "$?" > "$TMP/stepcheck.code"
  set -e
fi
if [ -f "$TMP/board.step" ]; then
  "$AGENT" --socket "$SOCK" call external.step.meshcheck \
    --payload "{\"input\":\"$TMP/board.step\"}" > "$TMP/stepmesh.json" 2>/dev/null || true
fi

python3 - "$TMP" <<'PY'
import json, sys
from pathlib import Path

root = Path(sys.argv[1])
failures = []


def load(name):
    try:
        return json.loads((root / name).read_text())
    except Exception as e:
        failures.append(f"{name}: not valid JSON ({e})")
        return {}


def check(label, condition, detail=""):
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label} {detail}")
        failures.append(label)


version = load("version.json")
check("version", bool(version.get("data", {}).get("version")),
      version.get("data"))

health = load("health.json")
check("kicad-cli detected", health.get("data", {}).get("kicadCli", {}).get("available") is True)

actions = load("actions.json")
check("action catalog >= 70", actions.get("data", {}).get("count", 0) >= 70,
      f"count={actions.get('data', {}).get('count')}")

spec = load("spec.out.json")
check("spec validation", spec.get("data", {}).get("hasErrors") is False,
      spec.get("data", {}).get("issues"))

blocks = load("blocks.json")
check("block library", blocks.get("data", {}).get("count", 0) > 0,
      blocks.get("data", {}).get("count"))

impedance = load("impedance.json")
z0 = impedance.get("data", {}).get("z0Ohm", 0)
check("impedance synthesis", abs(z0 - 50) < 0.5, f"z0={z0}")

drc_code = int((root / "drc-timeout.code").read_text().strip() or "0")
check("DRC cooperative timeout exit 8", drc_code == 8, f"exit={drc_code}")

erc_code = int((root / "erc.code").read_text().strip() or "0")
check("ERC runs", erc_code in (0, 5), f"exit={erc_code}")
check("ERC report exists", (root / "erc.json").exists())

health_ipc = load("health-ipc.json")
check("IPC connected", health_ipc.get("data", {}).get("ipc", {}).get("available") is True,
      health_ipc.get("data", {}).get("ipc"))

stackup = load("stackup.out.json")
check("stackup read", len(stackup.get("data", {}).get("stackup", {}).get("layers", [])) > 0)

connectivity = load("connectivity.json")
check("connectivity prove", len(connectivity.get("data", {}).get("endpoints", [])) > 0,
      connectivity.get("data", {}).get("unconnectedCount"))

grid = load("grid-dry.json") if (root / "grid-dry.json").exists() else {}
grid_data = grid.get("data", {})
check("grid router (multi-layer)",
      str(grid_data.get("planner", "")).startswith("grid")
      and bool(grid_data.get("layers")),
      grid_data)

caps = load("caps.json") if (root / "caps.json").exists() else {}
cap_ids = [c.get("id") for c in caps.get("data", {}).get("capabilities", [])]
check("capabilities are session-filtered",
      "common.jobs.status" in cap_ids and "schematic.place.symbol" not in cap_ids,
      cap_ids)

job_status = load("job-status.json") if (root / "job-status.json").exists() else {}
if job_status:
    check("job status RPC", job_status.get("data", {}).get("status") == "JS_SUCCESS",
          job_status.get("data"))

dfm = load("dfm-analyze.json")
check("DFM analyze finds width issue",
      any(v.get("type") == "width_under_minimum" for v in dfm.get("data", {}).get("violations", [])),
      dfm.get("data", {}).get("violations"))

dfm_fix = load("dfm-fix.json")
check("DFM fix applies", dfm_fix.get("data", {}).get("fixed", 0) >= 1,
      dfm_fix.get("data"))

fanout = load("fanout.json")
check("fanout dry-run plans a via", fanout.get("data", {}).get("viaCount", 0) >= 1,
      fanout.get("data"))

structural = load("structural.json")
check("structural check", len(structural.get("data", {}).get("footprints", [])) >= 1)

stepcode = Path(root / "stepcheck.code")
if stepcode.exists():
    code = int(stepcode.read_text().strip() or "0")
    report = load("stepcheck.json") if (root / "stepcheck.json").exists() else {}
    collisions = report.get("collisions", [])
    check("STEP self-test detects overlap",
          code == 5 and len(collisions) == 1
          and abs(collisions[0].get("volumeMm3", 0) - 125) < 1e-6,
          f"exit={code} report={report}")

if (root / "stepmesh.json").exists():
    mesh = load("stepmesh.json")
    check("STEP meshcheck action", mesh.get("data", {}).get("solids", 0) >= 1,
          mesh.get("data"))

if failures:
    print(f"\n{len(failures)} check(s) failed")
    sys.exit(1)

print("\nAll functional checks passed")
PY

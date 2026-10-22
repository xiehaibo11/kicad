#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Generate data/cli-commands.json from `kicad-cli --help`.

Every non-interactive kicad-cli leaf subcommand becomes a typed action whose
options are validated against the help text of the binary it was generated
from.  Re-run after kicad-cli gains or changes options:

    python3 scripts/gen-cli-commands.py [--cli path/to/kicad-cli]
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "cli-commands.json")

# Commands that are not useful as typed actions: `agent` re-enters this tool,
# `api-server` is served by project.open.
SKIP = {"agent", "api-server"}


def help_text(cli, args):
    proc = subprocess.run([cli, *args, "--help"], capture_output=True, text=True, timeout=60)
    return proc.stdout + proc.stderr


def parse(text):
    usage = re.search(r"^Usage: (.*)$", text, re.M)
    summary = ""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("Usage:"):
            for follow in lines[i + 1:]:
                if follow.strip():
                    summary = follow.strip()
                    break
            break

    positionals, options = [], []
    section = None
    current = None
    for line in lines:
        if line.startswith("Positional arguments:"):
            section = "pos"
            continue
        if line.startswith("Optional arguments:"):
            section = "opt"
            continue
        if line.startswith("Subcommands:"):
            section = None
            continue
        if section is None or not line.strip():
            continue
        if section == "pos":
            m = re.match(r"^  (\S+)\s+(.*)$", line)
            if m:
                positionals.append({"name": m.group(1),
                                    "multiple": "1 or more" in m.group(2) or "0 or more" in m.group(2),
                                    "optional": "0 or more" in m.group(2) or "nargs=0..1" in m.group(2),
                                    "help": clean(m.group(2))})
            continue
        m = re.match(r"^  (-[^ ].*?)\s{2,}(.*)$", line)
        if m:
            raw_flags = [f.strip() for f in m.group(1).split(",")]
            flags = [f.split()[0] for f in raw_flags if f]
            metavar = any(len(f.split()) > 1 for f in raw_flags)
            longs = [f for f in flags if f.startswith("--")]
            shorts = [f for f in flags if not f.startswith("--")]
            if not longs:
                longs = shorts[:1]
            current = {"long": longs[-1], "aliases": [f for f in flags if f != longs[-1]],
                       "help": m.group(2).strip(), "metavar": metavar}
            options.append(current)
            continue
        if current is not None and line.startswith(" " * 10):
            current["help"] += " " + line.strip()

    for opt in options:
        h = opt["help"]
        opt["value"] = "nargs=" in h or opt.pop("metavar", False)
        opt["repeat"] = "may be repeated" in h
        d = re.search(r"\[default: (.*?)\]", h)
        opt["default"] = d.group(1).strip('"') if d else ""
        opt["help"] = clean(h)
    options = [o for o in options if o["long"] not in ("--help", "-h")]
    return {"usage": usage.group(1) if usage else "", "summary": summary,
            "positionals": positionals, "options": options}


def clean(h):
    h = re.sub(r"\[nargs[^\]]*\]", "", h)
    h = re.sub(r"\[default: [^\]]*\]", "", h)
    h = re.sub(r"\[may be repeated\]", "", h)
    return re.sub(r"\s+", " ", h).strip()


def crawl(cli, args, out):
    text = help_text(cli, args)
    subs = []
    m = re.search(r"Subcommands:\n(.*?)(?:\n\n|\Z)", text, re.S)
    if m:
        for line in m.group(1).splitlines():
            if line.strip():
                subs.append(line.split()[0])
    if not subs and args:
        if args[0] not in SKIP:
            entry = parse(text)
            entry["path"] = args
            out.append(entry)
        return
    for sub in subs:
        crawl(cli, args + [sub], out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cli", default=os.environ.get("KICAD_CLI") or os.path.expanduser("~/.local/bin/kicad-cli"))
    args = ap.parse_args()
    version = subprocess.run([args.cli, "version"], capture_output=True, text=True).stdout.strip()
    commands = []
    crawl(args.cli, [], commands)
    commands.sort(key=lambda c: c["path"])
    with open(OUT, "w") as f:
        json.dump({"generatedFrom": "kicad-cli " + version, "commands": commands}, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"{len(commands)} commands -> {os.path.relpath(OUT)}", file=sys.stderr)


if __name__ == "__main__":
    main()

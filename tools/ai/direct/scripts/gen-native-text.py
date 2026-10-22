#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Generate data/native-tools-text.json.

For every native TOOL_ACTION in native-enriched.json, read its definition in the
KiCad source and record the English friendly name and tooltip, plus the
Simplified-Chinese translation from translation/pofiles/zh_CN.po.  The agent
uses this text for natural-language native tool search.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.join(HERE, "..", "data")
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))

STR = r'"((?:[^"\\]|\\.)*)"'


def unescape(s):
    return bytes(s, "utf-8").decode("unicode_escape").encode("latin-1").decode("utf-8")


def load_po(path):
    table = {}
    if not os.path.exists(path):
        return table
    msgid = msgstr = None
    field = None
    fuzzy = False

    def flush():
        if msgid and msgstr and not fuzzy:
            table.setdefault(msgid, msgstr)

    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        if line.startswith("#,") and "fuzzy" in line:
            fuzzy = True
            continue
        if line.startswith("msgctxt"):
            continue
        if line.startswith("msgid "):
            flush()
            msgid, msgstr, field = unescape(re.match(r'msgid ' + STR, line).group(1)), None, "id"
            continue
        if line.startswith("msgstr "):
            msgstr, field = unescape(re.match(r'msgstr ' + STR, line).group(1)), "str"
            continue
        m = re.match(r'^' + STR + r'$', line)
        if m:
            if field == "id":
                msgid += unescape(m.group(1))
            elif field == "str":
                msgstr += unescape(m.group(1))
            continue
        if not line.strip():
            flush()
            msgid = msgstr = field = None
            fuzzy = False
    flush()
    return table


def definition(source, line):
    path = os.path.join(ROOT, source)
    try:
        lines = open(path, encoding="utf-8", errors="ignore").read().splitlines()
    except OSError:
        return ""
    out = []
    for text in lines[max(line - 1, 0):max(line - 1, 0) + 40]:
        if out and re.match(r"\s*TOOL_ACTION\s+", text):
            break
        out.append(text)
        if re.search(r"\)\s*;\s*(?://.*)?$", text):
            break
    return "\n".join(out)


def field(block, name):
    m = re.search(r"\." + name + r"\(\s*_\(\s*" + STR + r"\s*\)", block)
    if not m:
        m = re.search(r"\." + name + r"\(\s*" + STR, block)
    return unescape(m.group(1)) if m else ""


def main():
    inventory = json.load(open(os.path.join(PKG, "native-enriched.json")))
    po = load_po(os.path.join(ROOT, "translation", "pofiles", "zh_CN.po"))
    out = {}
    for action in inventory["tools"]:
        block = definition(action["source"], action["line"])
        friendly = field(block, "FriendlyName") or field(block, "MenuText")
        tooltip = field(block, "Tooltip")
        entry = {}
        if friendly:
            entry["friendlyName"] = friendly
            if po.get(friendly):
                entry["zhName"] = po[friendly]
        if tooltip:
            entry["tooltip"] = tooltip
            if po.get(tooltip):
                entry["zhTooltip"] = po[tooltip]
        if entry:
            out[action["name"]] = entry
    for action in inventory["tools"]:
        action.update(out.get(action["name"], {}))
    with open(os.path.join(PKG, "native-enriched.json"), "w", encoding="utf-8") as f:
        json.dump(inventory, f, ensure_ascii=False, indent=2)
        f.write("\n")
    zh = sum(1 for e in out.values() if "zhName" in e)
    print(f"{len(out)} of {len(inventory['tools'])} actions described, {zh} with Chinese names",
          file=sys.stderr)


if __name__ == "__main__":
    main()

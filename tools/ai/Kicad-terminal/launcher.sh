#!/bin/sh
# User-facing AI terminal entry. Keep kicad-cli available for native automation.
set -eu
KICAD_BIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ ! -x "$KICAD_BIN_DIR/kicad-terminal" ]; then
  echo "Kicad 终端 is missing. Build tools/ai/Kicad-terminal, then run bash tools/ai/Kicad-terminal/install.sh." >&2
  exit 1
fi
# OpenCode merges inline config with the usual user and project settings.
# An explicit inherited entry wins; add KiCad without discarding other config.
OPENCODE_CONFIG_CONTENT=$(python3 - "$KICAD_BIN_DIR" <<'PY'
import json, os, shutil, sys
bin_dir = sys.argv[1]
share_dir = os.path.join(os.path.dirname(bin_dir), "share", "kicad-terminal")
server = {
    "type": "local",
    "command": [os.path.join(bin_dir, "kicad-agent"), "mcp"],
    "environment": {"KICAD_CLI": os.path.join(bin_dir, "kicad-cli")},
    "enabled": True,
}
# EDA Agent Connector (upstream easyeda-agent MCP adapter). Registered only when
# its CLI, node and the installed bundle exist; health reports a stopped daemon.
easyeda_bin = shutil.which("easyeda") or os.path.join(bin_dir, "easyeda")
node_bin = shutil.which("node")
easyeda_bundle = os.path.join(share_dir, "easyeda-mcp.mjs")
easyeda = {
    "type": "local",
    "command": [node_bin or "node", easyeda_bundle],
    "environment": {"EASYEDA_BIN": easyeda_bin},
    "enabled": True,
} if node_bin and os.access(easyeda_bin, os.X_OK) and os.path.isfile(easyeda_bundle) else None
# Always-on tool routing, so plain requests call the EDA tools without slashes.
instructions = os.path.join(share_dir, "eda-agent-instructions.md")
session_runtime = os.path.join(share_dir, "session-runtime.mjs")
def jsonc(raw, trim_commas=False):
    # Preserve strings while removing JSONC comments and trailing commas.
    out, i, quoted, escaped = [], 0, False, False
    while i < len(raw):
        char = raw[i]
        if quoted:
            out.append(char)
            if escaped: escaped = False
            elif char == '\\': escaped = True
            elif char == '"': quoted = False
            i += 1; continue
        if char == '"': quoted = True; out.append(char); i += 1; continue
        if raw[i:i+2] == '//':
            end = raw.find('\n', i+2); i = len(raw) if end < 0 else end; continue
        if raw[i:i+2] == '/*':
            end = raw.find('*/', i+2)
            if end < 0: raise ValueError('unclosed JSONC comment')
            out.append(' '); i = end+2; continue
        if trim_commas and char == ',':
            j = i+1
            while j < len(raw) and raw[j].isspace(): j += 1
            if j < len(raw) and raw[j] in '}]': i += 1; continue
        out.append(char); i += 1
    return ''.join(out)
raw = os.environ.get('OPENCODE_CONFIG_CONTENT', '')
# Strip comments first, then commas before closing braces (including after comments).
try:
    config = json.loads(jsonc(jsonc(raw), True)) if raw else {}
    if not isinstance(config, dict): raise ValueError('inline config must be an object')
    if 'mcp' not in config: config['mcp'] = {}
    if not isinstance(config['mcp'], dict): raise ValueError('mcp must be an object')
    config['mcp'].setdefault('kicad', server)
    if easyeda: config['mcp'].setdefault('easyeda', easyeda)
    if os.path.isfile(instructions):
        inherited = config.get('instructions', [])
        if not isinstance(inherited, list): raise ValueError('instructions must be an array')
        if instructions not in inherited: config['instructions'] = inherited + [instructions]
    if os.path.isfile(session_runtime):
        from pathlib import Path
        plugin = Path(session_runtime).as_uri()
        inherited_plugins = config.setdefault('plugin', [])
        if not isinstance(inherited_plugins, list): raise ValueError('plugin must be an array')
        if plugin not in inherited_plugins: inherited_plugins.append(plugin)
except (ValueError, TypeError) as error:
    print('Kicad: cannot merge inherited runtime config: '+str(error), file=sys.stderr)
    raise SystemExit(1)
try:
    credentials = {}
    try:
        with open(os.path.expanduser('~/.kicad-agent/deepseek.json')) as stream:
            credentials = json.load(stream)
    except (OSError, ValueError):
        pass
    api_key = os.environ.get('DEEPSEEK_API_KEY') or credentials.get('apiKey')
    if api_key:
        config.setdefault('provider', {}).setdefault('kicad-deepseek', {
            'npm': '@ai-sdk/anthropic', 'name': 'DeepSeek',
            'options': {'apiKey': api_key, 'baseURL': (credentials.get('baseUrl') or 'https://api.deepseek.com/anthropic').strip().rstrip('/').removesuffix('/v1') + '/v1'},
            'models': {model: {'name': name, 'reasoning': True, 'limit': {'context': 200000, 'output': 16000}, 'variants': {
                'off': {'thinking': {'type': 'disabled'}},
                **{effort: {'thinking': {'type': 'enabled', 'budgetTokens': 1024}, 'effort': effort} for effort in ['low', 'high', 'max']}
            }} for model, name in [('deepseek-flash','DeepSeek Flash'),('deepseek-v4-pro','DeepSeek V4 Pro')]}
        })
except (OSError, ValueError, TypeError):
    pass
print(json.dumps(config))
PY
)
export OPENCODE_CONFIG_CONTENT
exec "$KICAD_BIN_DIR/kicad-terminal" "$@"

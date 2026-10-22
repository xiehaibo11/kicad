"""Kicad's own update channel end to end, for a standalone and an npm global installation.

The prepared npm package is packed as built and republished as the next patch release by a local registry
fixture that serves only the @-kicadai scope; dependencies come from the normal registry.
Nothing is installed outside temporary directories, and no real Kicad release is changed.
"""
import base64
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import threading
import urllib.parse

root = Path(__file__).resolve().parent
npm_dir = root / 'npm'
output = root / 'audit/workbench'
output.mkdir(parents=True, exist_ok=True)
# The release the fixture offers: the next patch after the version being built (npm/package.json).
CURRENT = json.loads((npm_dir / 'package.json').read_text())['version']
NEXT = '.'.join(CURRENT.split('.')[:2] + [str(int(CURRENT.split('.')[2]) + 1)])
state = {'tamper': False, 'requests': []}


def run(cmd, env, cwd=None, check=True, timeout=900):
    result = subprocess.run([str(item) for item in cmd], env=env, cwd=cwd, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, timeout=timeout)
    if check and result.returncode != 0:
        raise AssertionError(f'{cmd} exited {result.returncode}:\n{result.stdout[-4000:]}')
    return result


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


with tempfile.TemporaryDirectory(prefix='Kicad-update-') as temporary:
    temporary = Path(temporary)
    env = {key: value for key, value in os.environ.items() if not key.startswith(('npm_config_', 'OPENCODE_', 'KICAD_', 'XDG_'))}
    (temporary / 'empty.npmrc').write_text('')
    env.update(npm_config_userconfig=str(temporary / 'empty.npmrc'), npm_config_cache=str(temporary / 'npm cache'),
               npm_config_update_notifier='false', npm_config_audit='false', npm_config_fund='false',
               HOME=str(temporary / 'home'), OPENCODE_DISABLE_MODELS_FETCH='1')
    (temporary / 'home').mkdir()
    for variable, folder in [('XDG_CONFIG_HOME', 'config'), ('XDG_DATA_HOME', 'data'), ('XDG_STATE_HOME', 'state'), ('XDG_CACHE_HOME', 'cache')]:
        env[variable] = str(temporary / folder)
        (temporary / folder).mkdir()

    # Package as built, and the same payload republished as the next version.
    run(['npm', 'pack', '--pack-destination', temporary], env, cwd=npm_dir)
    current_tgz = temporary / f'-kicadai-kicad-code-{CURRENT}.tgz'
    staged = temporary / 'next'
    shutil.copytree(npm_dir, staged, ignore=shutil.ignore_patterns('node_modules', '*.tgz'))
    package = json.loads((staged / 'package.json').read_text())
    package['version'] = NEXT
    (staged / 'package.json').write_text(json.dumps(package, indent=2) + '\n')
    run(['npm', 'pack', '--ignore-scripts', '--pack-destination', temporary], env, cwd=staged)
    next_tgz = temporary / f'-kicadai-kicad-code-{NEXT}.tgz'
    data = next_tgz.read_bytes()
    integrity = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
    extracted = temporary / 'extracted'
    with tarfile.open(next_tgz) as archive:
        archive.extractall(extracted, filter='data')
    payload = extracted / 'package'

    class Registry(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, body, kind='application/json'):
            raw = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(200)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            path = urllib.parse.unquote(self.path.split('?')[0])
            state['requests'].append(path)
            base = f'http://127.0.0.1:{self.server.server_port}'
            good = 'sha512-' + base64.b64encode(hashlib.sha512(b'tampered').digest()).decode() if state['tamper'] else integrity
            version = {'name': package['name'], 'version': NEXT, 'bin': package['bin'], 'dependencies': package['dependencies'],
                       'engines': package['engines'], 'os': package['os'], 'cpu': package['cpu'],
                       'dist': {'tarball': f'{base}/{next_tgz.name}', 'integrity': good}}
            if path in (f'/{package["name"]}/latest', f'/{package["name"]}/{NEXT}'):
                return self.send(version)
            if path == f'/{package["name"]}':
                return self.send({'name': package['name'], 'dist-tags': {'latest': NEXT}, 'versions': {NEXT: version}})
            if path == f'/{next_tgz.name}':
                return self.send(data, 'application/octet-stream')
            self.send_response(404)
            self.end_headers()

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Registry)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env[f'npm_config_{package["name"].split("/")[0]}:registry'] = f'http://127.0.0.1:{server.server_port}/'
    result = {'fixture': 'local scoped registry; packed package republished as ' + NEXT, 'checks': []}
    try:
        # Standalone: install.sh layout, upgraded in place by the runtime itself.
        prefix = temporary / 'standalone prefix'
        run(['bash', root / 'install.sh', '--prefix', prefix], env)
        launcher, runtime = prefix / 'bin/Kicad', prefix / 'bin/kicad-terminal'
        assert run([launcher, '--version'], env).stdout.strip() == CURRENT
        check = run([launcher, 'upgrade', '--check'], env).stdout
        assert f'Kicad {NEXT} is available' in check, check
        before = sha(runtime)
        state['tamper'] = True
        tampered = run([launcher, 'upgrade'], env, check=False)
        assert tampered.returncode != 0 and 'integrity' in tampered.stdout, tampered.stdout
        assert sha(runtime) == before, 'a failed checksum must not change the installation'
        state['tamper'] = False
        upgraded = run([launcher, 'upgrade'], env).stdout
        assert f'Kicad {NEXT} installed' in upgraded, upgraded
        share = prefix / 'share/kicad-terminal'
        assert sha(runtime) == sha(payload / 'vendor/darwin-arm64/kicad-terminal')
        assert sha(launcher) == sha(payload / 'resources/launcher.sh')
        for name in ('session-runtime.mjs', 'kicad-direct.mjs', 'eda-agent-instructions.md'):
            assert sha(share / name) == sha(payload / 'resources' / name), name
        assert (share / 'skills/kicad-engineering/SKILL.md').is_file()
        assert not list(share.glob('.kicad-update-*')), 'staging directories are removed'
        assert run([launcher, '--version'], env).returncode == 0
        result['checks'] += ['standalone: --check reports the newer release',
                             'standalone: tampered tarball rejected by sha512, installation unchanged',
                             'standalone: runtime, launcher, resources and skills replaced from the verified tarball']

        # npm global: npm installs the newer version into the same prefix.
        npm_prefix = temporary / 'npm prefix'
        npm_env = {**env, 'npm_config_prefix': str(npm_prefix)}
        run(['npm', 'install', '-g', current_tgz], npm_env)
        command = npm_prefix / 'bin/Kicad'
        assert run([command, '--version'], npm_env).stdout.strip() == CURRENT
        upgraded = run([command, 'upgrade'], npm_env).stdout
        assert f'Kicad {NEXT} installed' in upgraded and 'npm (global)' in upgraded, upgraded
        installed = json.loads((npm_prefix / f'lib/node_modules/{package["name"]}/package.json').read_text())
        assert installed['version'] == NEXT, installed['version']
        result['checks'] += ['npm global: upgrade runs npm install -g for the newer release in the same prefix']
        result['passed'] = True
        result['registryRequests'] = sorted(set(state['requests']))
    finally:
        server.shutdown()
        (output / 'update-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')

print(json.dumps(result, ensure_ascii=False))

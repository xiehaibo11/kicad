#!/usr/bin/env python3
"""Package the shared native module, without a connector, daemon or EDA extension."""
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
repo = root.parents[2]
output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root/'dist/kicad-native-tools.zip'
bundle = (root/'dist/kicad-direct.mjs').read_bytes()
source = json.loads((root/'dist/direct-manifest.json').read_text())
sha = lambda data: hashlib.sha256(data).hexdigest()
assert sha(bundle) == source['bundleSha256'], 'Rebuild the shared module first'
for relative, digest in source['sources'].items():
    assert sha((root/relative).read_bytes()) == digest, 'Stale shared module: '+relative
package = {
    'name':'@kicad/native-tools', 'version':'0.1.0', 'private':True,
    'type':'module', 'main':'./kicad-direct.mjs', 'exports':'./kicad-direct.mjs',
    'bin':{'kicad-direct':'./kicad-direct.mjs'}, 'engines':{'node':'>=22'},
    'license':'GPL-3.0-or-later',
    'description':'In-process KiCad tools shared by the native terminal and VS Code extension'
}
readme = '''# KiCad native tools

This is a ZIP distribution of the same JavaScript module shipped in the KiCad
terminal and extension. A legacy .eext filename is only a filename alias. It is
not an EasyEDA extension and must not be imported into an EDA extension manager.
No extension.json, Go executable, WebSocket connector, external EDA client or
routing daemon is included. The two built-in frontends import the bundled module
in their own processes. No stdio server or relay entrypoint is shipped.

Extract and import kicad-direct.mjs directly:

```js
import {Runtime, bindTools} from './kicad-direct.mjs';
const runtime = new Runtime({binary:'/absolute/path/kicad-cli', socket:'/tmp/kicad/api.sock'});
try { console.log(await runtime.dispatch('system.manifest', {})); }
finally { runtime.close(); }
```

bindTools(runtime, zod) returns the same 20 tool definitions used by both
frontends. Native IPC and the native CLI are the document/export boundaries.
The 333-action catalog and 971 native GUI descriptions are available through
system.manifest. GUI action submission is not proof of completion.

connector-audit.json records the old archive's 170 handlers: 72 native capability
matches require native parameters and units; 19 platform contracts are removed;
79 are implemented as native workflows with explicit input contracts and
readback. Discover each inputSchema before calling it. The 72 capability
matches are audit references rather than executable parameter aliases.
No old connector code is loaded.

Build provenance and file hashes are included. Keep all license files. Circuit
block data retains its original attribution; that creates no runtime dependency.
This module does not bundle the C++ KiCad editor or CLI. Node.js 22+ is required
for standalone shell use; in-process tools use the frontend's JavaScript host.
'''
files = {
    'kicad-direct.mjs':bundle,
    'package.json':(json.dumps(package,indent=2)+'\n').encode(),
    'README.md':readme.encode(),
    'LICENSE':(repo/'LICENSE').read_bytes(),
    'LICENSE-protobufjs.txt':(root/'dist/LICENSE-protobufjs.txt').read_bytes(),
    'LICENSE-blocks-MIT.txt':(root/'LICENSE-blocks-MIT.txt').read_bytes(),
    'direct-manifest.json':(root/'dist/direct-manifest.json').read_bytes(),
    'connector-audit.json':(root/'data/connector-audit.json').read_bytes(),
    'NATIVE-WORKFLOWS.md':(root/'NATIVE-WORKFLOWS.md').read_bytes()
}
manifest = {'format':'kicad-native-tools-zip','version':1,'runtime':'in-process JavaScript',
            'bundleSha256':sha(bundle),'files':{name:sha(data) for name,data in files.items()}}
files['archive-manifest.json']=(json.dumps(manifest,indent=2)+'\n').encode()
stream=io.BytesIO()
with zipfile.ZipFile(stream,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for name,data in sorted(files.items()):
        info=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0))
        info.create_system=3
        info.external_attr=(0o100755 if name.endswith('.mjs') else 0o100644)<<16
        archive.writestr(info,data,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
output.parent.mkdir(parents=True,exist_ok=True)
output.write_bytes(stream.getvalue())
print(json.dumps({'file':str(output),'sha256':sha(stream.getvalue()),'bundleSha256':sha(bundle),'entries':len(files)}))

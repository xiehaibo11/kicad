#!/usr/bin/env python3
"""Real native IPC acceptance on a disposable four-layer fixture, never user boards."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
CLI = ROOT / 'build/kicad/KiCad.app/Contents/MacOS/kicad-cli'
AGENT = Path.home() / '.local/bin/kicad-agent'
records = []

def fixture(path):
    uid = lambda: str(uuid.uuid4())
    text = '''(kicad_pcb
 (version 20260901)
 (generator "pcbnew")
 (general (thickness 1.6))
 (paper "A4")
 (layers
  (0 "F.Cu" signal)
  (4 "In1.Cu" signal)
  (6 "In2.Cu" signal)
  (2 "B.Cu" signal)
  (5 "F.SilkS" user "F.Silkscreen")
  (7 "B.SilkS" user "B.Silkscreen")
  (1 "F.Mask" user)
  (3 "B.Mask" user)
  (25 "Edge.Cuts" user)
  (31 "F.CrtYd" user "F.Courtyard")
  (29 "B.CrtYd" user "B.Courtyard")
  (35 "F.Fab" user)
  (33 "B.Fab" user)
 )
 (setup (pad_to_mask_clearance 0))
'''
    for x,y in [(20,20),(40,40)]:
        text += f' (via (at {x} {y}) (size 0.8) (drill 0.3) (layers "F.Cu" "B.Cu") (net "GND") (uuid "{uid()}"))\n'
    for a,b in [((10,10),(50,10)),((50,10),(50,50)),((50,50),(10,50)),((10,50),(10,10))]:
        text += f' (gr_line (start {a[0]} {a[1]}) (end {b[0]} {b[1]}) (stroke (width 0.05) (type default)) (layer "Edge.Cuts") (uuid "{uid()}"))\n'
    # Two through-hole pads anchor both inner planes; vias connect two layers.
    text += f''' (footprint "PlaneAnchor" (layer "F.Cu") (at 20 30)
 (uuid "{uid()}")
 (property "Reference" "J1" (at 0 -3) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
 (property "Value" "PlaneAnchor" (at 0 3) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
 (attr through_hole board_only exclude_from_pos_files exclude_from_bom)
 (pad "1" thru_hole circle (at 0 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (net "GND") (uuid "{uid()}"))
 (pad "2" thru_hole circle (at 20 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (net "GND") (uuid "{uid()}"))
 )\n)\n'''
    path.write_text(text)

with tempfile.TemporaryDirectory(prefix='kicad-p0-acceptance-') as directory:
    directory = Path(directory)
    document, socket = directory/'p0.kicad_pcb', directory/'api.sock'
    fixture(document)
    env = dict(os.environ, KICAD_RUN_FROM_BUILD_DIR='1')
    with (directory/'server.log').open('w') as log:
        server = subprocess.Popen([str(CLI),'api-server',str(document),'--socket',str(socket)],env=env,stdout=log,stderr=log)
    def call(action, payload=None, expect=True):
        payload = {'document':str(document), **(payload or {})}
        response = subprocess.run([str(AGENT),'--socket',str(socket),'--timeout','90s','call',action,'--payload',json.dumps(payload)],capture_output=True,text=True,timeout=100)
        result = json.loads(response.stdout)
        records.append({'action':action,'payload':payload,'result':result})
        (OUT/'p0-engineering.json').write_text(json.dumps({'ok':False,'calls':records},indent=2))
        print(action, result['ok'], result.get('error',{}),flush=True)
        assert result['ok'] is expect, result
        return result
    try:
        for _ in range(100):
            if server.poll() is not None: raise RuntimeError((directory/'server.log').read_text())
            if socket.exists():
                ready = subprocess.run([str(AGENT),'--socket',str(socket),'--timeout','2s','call','document.list','--payload','{"type":"pcb"}'],capture_output=True,text=True)
                if ready.returncode == 0: break
            time.sleep(.1)
        else: raise RuntimeError('Private API server did not become ready')
        call('board.layers.type.set',{'layers':{'In1.Cu':'power','In2.Cu':'power'}})
        vias = call('board.via.create',{'positions':[{'xMm':25,'yMm':25},{'xMm':35,'yMm':35}],'net':'GND','filled':True,'capped':True,'plugged':'both','covered':'both'})
        call('board.via.modify',{'ids':vias['data']['createdIds'],'diameterMm':0.8,'drillMm':0.35,'filled':True,'capped':True})
        for layer in ['In1.Cu','In2.Cu']:
            plane = call('board.plane.build',{'net':'GND','layers':[layer],'name':'GND_'+layer})
            assert plane['data']['verify']['plane']['connectedPads']==2
            assert plane['data']['verify']['plane']['connectedVias']==4
        # No materialized copper outside the board: require failure and rollback.
        bad = call('board.plane.build',{'net':'GND','layers':['In1.Cu'],'outline':[{'xMm':60,'yMm':60},{'xMm':65,'yMm':60},{'xMm':65,'yMm':65},{'xMm':60,'yMm':65}]},expect=False)
        assert bad['data']['rolledBack'] is True
        call('board.rule_area.create',{'name':'T1','box':{'x1Mm':12,'y1Mm':12,'x2Mm':16,'y2Mm':16},'layers':['F.Cu'],'keepout':{'tracks':True,'vias':True,'copper':True}})
        call('board.rules.region.set',{'area':'T1','clearanceMm':0.2,'trackWidthMm':0.25})
        call('document.save')
        call('document.revert')
        layers = call('board.layers.type.get')['data']
        assert layers['source']=='live'
        assert all(e['type']=='power' for e in layers['copperLayers'] if e['name'] in ('In1.Cu','In2.Cu'))
        proof = call('board.connectivity.prove',{'nets':['GND'],'requireFilledZones':True})
        assert proof['data']['ok'] is True
        drc = call('board.drc.live',{'timeoutMs':60000})['data']
        report = drc['reportJson']
        assert drc['exitCode']==0, report
        assert not report['violations'] and not report['unconnected_items']
        dest = OUT/'p0-fixture'; dest.mkdir(exist_ok=True)
        for source in directory.glob('p0.kicad_*'): shutil.copy2(source,dest/source.name)
        shutil.copy2(drc['report'],OUT/'p0-drc.json')
        (OUT/'p0-engineering.json').write_text(json.dumps({'ok':True,'fixture':'disposable generated four-layer board; two GND through-hole pads, four vias and two power planes; save, reload, native readback and zero DRC','calls':records},indent=2))
    finally:
        server.terminate()
        try: server.wait(timeout=10)
        except subprocess.TimeoutExpired: server.kill();server.wait()

// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {frontendFixture} from '../scripts/frontend-fixture.mjs';
import {blankBoard} from '../native-files.mjs';
import {decap} from '../decap.mjs';
import {clean,idOf} from '../board-common.mjs';
const binary=process.env.KICAD_TEST_CLI;
test('native decap placement clears reference text, respects distance and restores on DRC regression',{skip:!binary,timeout:90000},async()=>{
 let source=blankBoard(),nodes=['(net 1 "GND")','(net 2 "VDD")'];
 for(const [ref,x,y]of [['U1',30,30],['C1',65,65]])nodes.push(`(footprint "Test" (layer "F.Cu") (at ${x} ${y}) (uuid ${randomUUID()}) (attr smd) (fp_text reference "${ref}" (at 0 -2) (layer "F.SilkS") (effects (font (size 1 1)))) (fp_text value "Test" (at 0 2) (layer "F.Fab") (effects (font (size 1 1)))) (pad "1" smd rect (at 0 0) (size 0.5 0.5) (layers "F.Cu" "F.Mask") (net 2 "VDD")) (pad "2" smd rect (at 2 0) (size 0.5 0.5) (layers "F.Cu" "F.Mask") (net 1 "GND")))`);
 nodes.push(`(gr_rect (start 20 20) (end 100 100) (stroke (width 0.05) (type default)) (fill none) (layer "Edge.Cuts") (uuid ${randomUUID()}))`);
 source=source.slice(0,source.lastIndexOf(')'))+nodes.join('\n')+'\n)';
 const fixture=await frontendFixture(binary,{boardSource:source}),{runtime,root}=fixture,document=path.join(root,'fixture.kicad_pcb'),payload={document,apply:true,offsetMm:0.3,maxDistanceMm:5};
 const run=(a,p)=>runtime.dispatch(a,p);
 try{
  const originals=(await run('board.items.get',{document,types:['footprint']})).data.items;
  const result=await run('board.decap.place',payload);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.data.moved,1);assert.equal(result.data.drcSkipped,false);
  const checked=await run('board.decap.check',{document,maxDistanceMm:5});assert.deepEqual(checked.data.findings,[]);
  await run('board.items.update',{document,items:originals.map(json=>({type:'footprint',json:clean(json)}))});
  const refused=await run('board.decap.place',{...payload,maxDistanceMm:0.1});assert.equal(refused.error?.code,'DECAP_NO_PLACEMENT');
  let drc=0;const rolled=await decap('board.decap.place',payload,async(a,p)=>{const r=await run(a,p);if(a==='board.drc.live'&&++drc===2)r.data.summary.total+=100;return r;});
  assert.equal(rolled.error?.code,'DECAP_DRC_REGRESSION');assert.equal(rolled.data.rollback,'restored');
  const back=(await run('board.items.get',{document,types:['footprint']})).data.items;
  for(const fp of originals)assert.deepEqual(back.find(f=>idOf(f)===idOf(fp)).position,fp.position);
 }finally{await fixture.close();}
});

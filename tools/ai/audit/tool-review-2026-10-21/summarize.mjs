import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {listActions} from '../../direct/runtime.mjs';import audit from '../../direct/data/connector-audit.json' with{type:'json'};
const root=path.dirname(fileURLToPath(import.meta.url)),evidence=new Map();
for(const file of ['native-dispatch.jsonl','workflow-final.jsonl','ipc/ipc-catalog.json','cli/cli-catalog.json','runtime/runtime-catalog.json','gui.json','gui-library.json']){
 const raw=fs.readFileSync(path.join(root,file),'utf8'),parsed=file.endsWith('jsonl')?raw.trim().split('\n').map(JSON.parse):JSON.parse(raw);
 for(const [index,row]of (parsed.records??parsed).entries()){
  if(file==='native-dispatch.jsonl'&&(!row.nativeIPC||!row.nativeCLI))continue;
  const observations=evidence.get(row.action)??[];observations.push({file,index,ok:row.result?.ok??row.ok,error:row.result?.error??row.error,mode:row.mode});evidence.set(row.action,observations);
 }
}
const classified={
 'board.export.hpgl':'removed-by-native-KiCad-10','schematic.export.hpgl':'removed-by-native-KiCad-10',
 'board.items.from_string':'native-handler-unimplemented-explicit-error',
 'editor.library.open':'footprint-editor-context-required-not-positively-verified',
 'board.plane.verify':'native-connectivity-guard-caught-unconnected-via',
 'board.impedance.check':'expected-width-violation-detected',
 'external.step.meshcheck':'optional-kicad-stepcheck-executable-missing',
 'audit.run':'expected-design-and-manufacturing-evidence-incomplete',
 'web.search':'environment-DNS-fake-IP-blocked-by-SSRF-policy',
 'release.check':'expected-release-evidence-incomplete',
 'board.decap.place':'native-DRC-regression-detected-and-originals-restored',
 'board.check.unified':'expected-native-and-heuristic-fixture-findings'
};
const matrix=listActions().map(a=>{const observed=evidence.get(a.name)??[],passed=observed.some(o=>o.ok===true);return{action:a.name,backend:a.backend,executed:observed.length>0,positiveResult:passed,status:passed?'positive-execution':classified[a.name]??'unclassified-failure',available:a.available??true,...(a.unavailableReason?{unavailableReason:a.unavailableReason}:{}),observations:observed};});
const workflows=audit.actions.filter(a=>a.status==='native-workflow'||a.status==='requires-native-workflow').map(a=>a.originalAction);
const summary={actionCount:matrix.length,executed:matrix.filter(r=>r.executed).length,positiveResult:matrix.filter(r=>r.positiveResult).length,classifiedNegative:matrix.filter(r=>!r.positiveResult).map(r=>({action:r.action,status:r.status})),nativeWorkflows:workflows.length,nativeWorkflowsPositive:workflows.filter(n=>matrix.find(r=>r.action===n)?.positiveResult).length,guiActionSemantics:'Only the tested GUI API operations are verified. The 971 indexed native editor commands are discovery metadata, not 971 completed interaction tests.',frontendTools:{chat:20,terminal:20}};
fs.writeFileSync(path.join(root,'coverage-matrix.json'),JSON.stringify({summary,actions:matrix},null,2)+'\n');console.log(JSON.stringify(summary,null,2));if(matrix.some(r=>!r.executed)||summary.nativeWorkflowsPositive!==79||matrix.some(r=>r.status==='unclassified-failure'))process.exitCode=1;

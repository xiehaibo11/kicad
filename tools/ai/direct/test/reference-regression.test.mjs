import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reference} from '../reference.mjs';
test('unmatched planning query returns existing baseline cards',()=>{const r=reference('reference.plan',{query:'xyz-no-such-topic-123'});assert.equal(r.ok,true);assert.ok(r.data.topics.some(t=>t.stage==='spec'));assert.ok(r.data.topics.some(t=>t.stage==='verified'));});
test('review requests can select relevant cards without an invented stage',()=>{const r=reference('reference.plan',{query:'DDR schematic',stage:'review'});assert.equal(r.ok,true);assert.ok(r.data.topics.length);assert.throws(()=>reference('reference.plan',{stage:'not-a-stage'}),/Valid stages:.*schematic/);});

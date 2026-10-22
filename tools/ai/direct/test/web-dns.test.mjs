// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';import assert from 'node:assert/strict';
import {publicAddresses,publicIP} from '../web.mjs';
const fake=async()=>[{address:'198.18.2.4',family:4},{address:'2001:2::1b6',family:6}];
test('fake-IP DNS is resolved publicly, while returned private/mixed addresses remain blocked',async()=>{
 assert.equal(publicIP('2001:2::1b6'),false);
 const response=ip=>async(url,options)=>{assert.match(url,/^https:\/\/1\.1\.1\.1\/dns-query/);assert.equal(options.accept,'application/dns-json');return {buffer:Buffer.from(JSON.stringify({Status:0,Answer:[{type:1,data:ip}]}))};};
 assert.deepEqual(await publicAddresses('public.example',{},fake,response('1.1.1.1')),[{address:'1.1.1.1',family:4}]);
 await assert.rejects(publicAddresses('public.example',{},fake,response('127.0.0.1')),/reserved/);
 await assert.rejects(publicAddresses('local.example',{},async()=>[{address:'10.1.1.1',family:4}],()=>assert.fail('must not resolve private DNS externally')),/reserved/);
 await assert.rejects(publicAddresses('mixed.example',{},async()=>[{address:'198.18.2.4',family:4},{address:'127.0.0.1',family:4}],()=>assert.fail('must not resolve mixed private DNS externally')),/reserved/);
 await assert.rejects(publicAddresses('198.18.2.4',{},fake,()=>assert.fail('must not resolve literal IP')),/reserved/);
});

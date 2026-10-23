import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {fetchPublic} from '../web.mjs';
test('deadline includes stalled DNS; user cancellation remains distinct',async()=>{
  mock.method(dns,'lookup',async()=>new Promise(()=>{}));
  try{
    await assert.rejects(fetchPublic('https://fixture.invalid',{timeoutMs:20}),e=>e.code==='TIMEOUT');
    const controller=new AbortController();controller.abort(new Error('user cancellation'));
    await assert.rejects(fetchPublic('https://fixture.invalid',{signal:controller.signal}),/user cancellation/);
  }finally{mock.restoreAll();}
});
test('slow body and redirects share one deadline and destroy the request',async()=>{
  let requests=0,destroyed=0;
  mock.method(dns,'lookup',async()=>[{address:'1.1.1.1',family:4}]);
  mock.method(http,'get',(_url,options,callback)=>{
    const request=new EventEmitter(),body=new PassThrough();requests++;
    request.destroy=error=>{destroyed++;body.destroy(error);request.emit('error',error);};
    const abort=()=>request.destroy(options.signal.reason);
    options.signal.addEventListener('abort',abort,{once:true});
    if(requests===1){body.statusCode=302;body.headers={location:'http://fixture.invalid/slow'};setTimeout(()=>{callback(body);body.end();},10);}
    else {body.statusCode=200;body.headers={};setTimeout(()=>{callback(body);body.write('partial');},1);}
    return request;
  });
  try{await assert.rejects(fetchPublic('http://fixture.invalid',{timeoutMs:35}),e=>e.code==='TIMEOUT');assert.equal(requests,2);assert.ok(destroyed>=1);}
  finally{mock.restoreAll();}
});

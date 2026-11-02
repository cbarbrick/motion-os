import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
const origin=new URL(process.argv[2]||'http://localhost:8888').origin;
const secret=()=>randomBytes(32).toString('hex'), hash=v=>createHash('sha256').update(v).digest('hex');
const read=secret(),write=secret();
async function post(endpoint,body,requestOrigin=origin){return fetch(origin+'/.netlify/functions/'+endpoint,{method:'POST',headers:{origin:requestOrigin,'content-type':'application/json'},body:JSON.stringify(body)});}
const created=await post('app-login-start',{readHash:hash(read),writeHash:hash(write)});
assert.equal(created.status,201,'create ticket');const {id}=await created.json();
try {
 let r=await post('app-login',{action:'status',id,secret:read});assert.equal(r.status,200);assert.equal((await r.json()).state,'pending');assert.match(r.headers.get('cache-control'),/no-store/);
 r=await post('app-login',{action:'status',id,secret:write});assert.equal(r.status,403);
 r=await post('app-login',{action:'complete',id,secret:write,code:'synthetic-code-for-relay-check'});assert.equal(r.status,200);
 r=await post('app-login',{action:'status',id,secret:read});assert.equal((await r.json()).code,'synthetic-code-for-relay-check');
 r=await post('app-login',{action:'status',id,secret:read},'https://other.example');assert.equal(r.status,400);
} finally {assert.equal((await post('app-login',{action:'finish',id,secret:read})).status,200);}
assert.equal((await post('app-login',{action:'status',id,secret:read})).status,410);
console.log('Login relay: create, isolated read/write, code return, no-store, origin check and cleanup passed.');

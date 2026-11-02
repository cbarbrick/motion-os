import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';
const source=await readFile(new URL('../netlify/lib/home-login.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {startLogin,relayLogin}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const origin='https://motion.example.test';
const hash=s=>createHash('sha256').update(s).digest('hex');
function store(){const records=new Map();return {records,get:async key=>records.get(key)||null,setJSON:async(key,value)=>{if(records.has(key))return {modified:false};records.set(key,structuredClone(value));return {modified:true};},delete:async key=>{records.delete(key);}};}
const request=(body,headers={})=>new Request(origin+'/.netlify/functions/app-login',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
async function ticket(s,now=Date.now()) {const read=randomBytes(32).toString('hex'),write=randomBytes(32).toString('hex');const response=await startLogin(request({readHash:hash(read),writeHash:hash(write)}),s,now);assert.equal(response.status,201);return {...await response.json(),read,write};}

test('login relay separates read/write secrets, keeps codes immutable and deletes on finish',async()=>{
 const s=store(),t=await ticket(s),code='test-pkce-code-that-is-single-use';
 assert.equal((await relayLogin(request({action:'complete',id:t.id,secret:t.read,code}),s)).status,403);
 assert.equal((await relayLogin(request({action:'status',id:t.id,secret:t.write}),s)).status,403);
 const completed=await relayLogin(request({action:'complete',id:t.id,secret:t.write,code}),s);assert.equal(completed.status,200);assert.match(completed.headers.get('cache-control'),/no-store/);
 assert.equal((await relayLogin(request({action:'complete',id:t.id,secret:t.write,code}),s)).status,200);
 assert.equal((await relayLogin(request({action:'complete',id:t.id,secret:t.write,code:'different-valid-code-value'}),s)).status,409);
 const r=await (await relayLogin(request({action:'status',id:t.id,secret:t.read}),s)).json();assert.equal(r.code,code);
 assert.equal(JSON.stringify([...s.records.values()]).includes(t.read),false);assert.equal(JSON.stringify([...s.records.values()]).includes(t.write),false);
 await relayLogin(request({action:'finish',id:t.id,secret:t.read}),s);assert.equal(s.records.size,0);
 assert.equal((await relayLogin(request({action:'status',id:t.id,secret:t.read}),s)).status,410);
});
test('login relay rejects cross-origin, missing-origin, oversized, expired and malformed requests',async()=>{
 const s=store(),t=await ticket(s,1_000);
 for(const action of ['status','complete','finish']) assert.equal((await relayLogin(request({action,id:t.id,secret:t.read}),s,601_000)).status,410);
 assert.equal((await startLogin(request({readHash:hash(t.read),writeHash:hash(t.write)},{origin:'https://attacker.example'}),s)).status,400);
 assert.equal((await startLogin(request({readHash:hash(t.read),writeHash:hash(t.write)},{origin:''}),s)).status,400);
 assert.equal((await startLogin(request({large:'x'.repeat(9000)}),s)).status,400);
 assert.equal((await relayLogin(request({action:'status',id:'../private',secret:t.read}),s)).status,400);
 const active=await ticket(s);
 assert.equal((await relayLogin(request({action:'complete',id:active.id,secret:active.write,code:'short'}),s)).status,400);
 assert.equal((await relayLogin(request({action:'complete',id:active.id,secret:active.write,code:'valid-code-for-testing',flowId:'../wrong'}),s)).status,400);
});
test('canceling Google returns a failure without creating a session',async()=>{
 const s=store(),t=await ticket(s);
 await relayLogin(request({action:'complete',id:t.id,secret:t.write,failed:true}),s);
 const result=await (await relayLogin(request({action:'status',id:t.id,secret:t.read}),s)).json();
 assert.equal(result.failed,true);assert.equal(result.code,null);
});

test('separate browser login returns PKCE to the home app, survives reopen and refresh, and signs out',async()=>{
 const saved=new Map(), callbackSaved=new Map(), s=store(),t=await ticket(s);
 function storage(map){return {getItem:key=>map.get(key)||null,setItem:(key,value)=>{map.set(key,value);},removeItem:key=>{map.delete(key);}};}
 const user={id:'00000000-0000-4000-8000-000000000001',aud:'authenticated',email:'test@example.test'};
 const jwt=()=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'test-signature'].join('.');
 let challenge, consumed=false, refreshes=0;
 const fetcher=async(url,init)=>{
  const body=init.body?JSON.parse(init.body):{};
  if(String(url).includes('grant_type=pkce')) {
   assert.equal(body.auth_code,'single-use-code-for-home-screen');
   assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'),challenge);
   assert.equal(consumed,false);consumed=true;
  } else if(String(url).includes('grant_type=refresh_token')) {assert.match(body.refresh_token,/refresh-/);refreshes++;}
  else if(String(url).includes('/logout')) return new Response(null,{status:204});
  else throw new Error('Unexpected test auth request');
  return Response.json({access_token:jwt(),refresh_token:`refresh-${refreshes}`,expires_in:3600,token_type:'bearer',user});
 };
 const client=map=>createClient('https://project.example.test','public-test-key',{global:{fetch:fetcher},auth:{flowType:'pkce',persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'test-home-auth',storage:storage(map)}});
 const home=client(saved), browser=client(callbackSaved);
 const {data:oauth,error}=await home.auth.signInWithOAuth({provider:'google',options:{redirectTo:origin,skipBrowserRedirect:true}});assert.equal(error,null);
 challenge=new URL(oauth.url).searchParams.get('code_challenge');assert.ok(challenge);
 // The external browser has no verifier and cannot redeem the code.
 const wrong=await browser.auth.exchangeCodeForSession('single-use-code-for-home-screen',oauth.flowId?{flowId:oauth.flowId}:undefined);assert.ok(wrong.error);assert.equal(consumed,false);
 await relayLogin(request({action:'complete',id:t.id,secret:t.write,code:'single-use-code-for-home-screen'}),s);
 const result=await (await relayLogin(request({action:'status',id:t.id,secret:t.read}),s)).json();
 const login=await home.auth.exchangeCodeForSession(result.code,oauth.flowId?{flowId:oauth.flowId}:undefined);assert.equal(login.error,null);assert.equal(login.data.session.user.id,user.id);
 assert.equal(callbackSaved.size,0);assert.equal(JSON.stringify([...s.records.values()]).includes('refresh-'),false);
 await relayLogin(request({action:'finish',id:t.id,secret:t.read}),s);
 const reopened=client(saved);assert.equal((await reopened.auth.getSession()).data.session.user.id,user.id);
 assert.equal((await reopened.auth.refreshSession()).error,null);assert.equal(refreshes,1);
 assert.equal((await reopened.auth.signOut({scope:'local'})).error,null);assert.equal((await reopened.auth.getSession()).data.session,null);
 await home.auth.stopAutoRefresh();await browser.auth.stopAutoRefresh();await reopened.auth.stopAutoRefresh();
});

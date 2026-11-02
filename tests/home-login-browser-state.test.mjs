import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const storage=()=>{const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};
globalThis.localStorage=storage();globalThis.sessionStorage=storage();globalThis.location=new URL('https://motion.example.test/');globalThis.window={matchMedia:()=>({matches:true})};
const source=(await readFile(new URL('../src/home-login.ts',import.meta.url),'utf8')).replace('import.meta.env.VITE_SUPABASE_URL',JSON.stringify('https://project.example.test'));
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const m=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const id='01234567-89ab-4cde-8f01-234567890abc', expiresAt=Date.now()+600_000;
const authURL=new URL('https://project.example.test/auth/v1/authorize');authURL.search=new URLSearchParams({provider:'google',code_challenge_method:'s256',redirect_to:location.origin,code_challenge:'verifier-challenge'}).toString();
function launch(overrides={}) {const u=new URL('https://motion.example.test/');u.hash=new URLSearchParams({app_login:JSON.stringify({id,secret:'a'.repeat(64),expiresAt,authorizeUrl:authURL.href,...overrides})}).toString();return u;}
test('home-screen launch accepts only this project, Google PKCE and the same return origin',()=>{
 location=launch();assert.equal(m.readLaunch().invalid,false);
 location=launch({authorizeUrl:'https://attacker.example/'});assert.equal(m.readLaunch().invalid,true);
 const bad=new URL(authURL);bad.searchParams.set('redirect_to','https://attacker.example/');location=launch({authorizeUrl:bad.href});assert.equal(m.readLaunch().invalid,true);
 bad.searchParams.set('redirect_to','https://motion.example.test/');bad.searchParams.set('provider','github');location=launch({authorizeUrl:bad.href});assert.equal(m.readLaunch().invalid,true);
 location=launch({expiresAt:Date.now()-1});assert.equal(m.readLaunch().invalid,true);
 location=launch({expiresAt:null});assert.equal(m.readLaunch().invalid,true);
});
test('return codes and canceled callbacks are captured only for a started app login',()=>{
 location=new URL('https://motion.example.test/?code=one-time-code');assert.equal(m.readLoginReturn(),null);
 m.rememberReturn({id,secret:'a'.repeat(64),expiresAt});assert.equal(m.readLoginReturn().code,'one-time-code');
 location=new URL('https://motion.example.test/#error=access_denied');assert.equal(m.readLoginReturn().failed,true);
 m.forgetReturn();assert.equal(m.readLoginReturn(),null);
});
test('reopening a pending home app reuses its ticket and PKCE flow instead of starting another login',async()=>{
 location=new URL('https://motion.example.test/');
 const pending={id,readSecret:'b'.repeat(64),expiresAt,launchHref:launch().href,started:true,flowId:'existing-flow'};
 m.savePending(pending);assert.deepEqual(m.readPending(),pending);
 assert.deepEqual(await m.prepareHomeLogin({auth:{signInWithOAuth(){throw new Error('Should not restart OAuth');}}}),pending);
 localStorage.setItem(m.pendingKey,JSON.stringify({...pending,expiresAt:1}));assert.equal(m.readPending(),null);
});

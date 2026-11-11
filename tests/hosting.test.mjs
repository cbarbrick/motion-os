import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as crypto from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
const compile=async path=>ts.transpileModule(await readFile(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const http=await compile('../server/http.ts');
function httpModule(allowed=true){
 const exports={};
 vm.runInNewContext(http,{exports,Buffer,Response,process:{env:{CRON_SECRET:'test-only-cron-secret'}},console:{error(){}},require:name=>name==='node:crypto'?crypto:name==='@vercel/functions'?{ipAddress:()=> '127.0.0.1'}:{serverDatabase:()=>({rpc:async()=>({data:allowed})})}});
 return exports;
}
test('public Vercel endpoints enforce shared rate limits and never run blocked handlers',async()=>{
 let calls=0;
 const r=await httpModule(false).endpoint('test',25,async()=>{calls++;return new Response('ok')}).fetch(new Request('https://motion.example/api/test'));
 assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');assert.equal(calls,0);
 const ok=await httpModule(true).endpoint('test',25,async()=>new Response('ok')).fetch(new Request('https://motion.example/api/test'));
 assert.equal(ok.status,200);
});
test('scheduled jobs require the exact server-only cron secret and GET method',()=>{
 const {cronAuthorized}=httpModule();
 for(const request of [new Request('https://motion.example/api/jobs'),new Request('https://motion.example/api/jobs',{headers:{authorization:'Bearer wrong'}}),new Request('https://motion.example/api/jobs',{method:'POST',headers:{authorization:'Bearer test-only-cron-secret'}})])assert.equal(cronAuthorized(request),false);
 assert.equal(cronAuthorized(new Request('https://motion.example/api/jobs',{headers:{authorization:'Bearer test-only-cron-secret'}})),true);
});
const runtime=await compile('../server/calendar-runtime.ts');
test('reconnecting after a hosting migration reuses the registered Google calendar',async()=>{
 const calls=[],saved=[];
 class CalendarError extends Error{}
 const exports={};
 const google={CalendarError,refreshGoogle:async()=> 'test-token',seal:()=> 'encrypted-test-only',googleRequest:async(token,path)=>{calls.push(path);assert.notEqual(path,'/calendars');return Response.json({accessRole:'owner'});}};
 vm.runInNewContext(runtime,{exports,URL,Response,AbortSignal,fetch:async()=>Response.json({email_verified:true,email:'owner@example.test'}),require:name=>name==='./google-calendar.js'?google:{}});
 const rt={blobs:{get:async()=>null,set:async(key,value)=>saved.push({key,value}),delete:async()=>{}},db:{from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{calendar_id:'existing-shared-calendar',connected_by:'owner'}})})})}),rpc:async(name,args)=>{assert.equal(name,'register_google_calendar');assert.equal(args.p_calendar,'existing-shared-calendar');return {};}}};
 await exports.connect(rt,'workspace',{id:'owner',email:'owner@example.test'},'test-refresh-token');
 assert.equal(calls.length,1);assert.match(calls[0],/existing-shared-calendar/);assert.equal(saved.length,1);assert.equal(saved[0].value,'encrypted-test-only');
});

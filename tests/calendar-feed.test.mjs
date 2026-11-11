import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';
const compile=(source,common=false)=>ts.transpileModule(source,{compilerOptions:{module:common?ts.ModuleKind.CommonJS:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const dataImport=async path=>import('data:text/javascript;base64,'+Buffer.from(compile(await readFile(new URL(path,import.meta.url),'utf8'))).toString('base64'));
const google=await dataImport('../server/google-calendar.ts');
const {calendarEntries}=await dataImport('../src/calendar-feed.ts');
const workspace='00000000-0000-4000-8000-000000000001', user='00000000-0000-4000-8000-000000000002', id='00000000-0000-4000-8000-000000000003';
const start='2026-11-01T04:00:00.000Z',end='2026-12-01T05:00:00.000Z';
const local={id,workspace_id:workspace,kind:'event',title:'Local event',description:'Original',location:'Office',starts_at:'2026-11-05T15:00:00Z',ends_at:'2026-11-05T16:00:00Z',all_day:false,version:1};
const remote={id:'google1',title:'Changed in Google',description:'Google details',location:'Studio',starts_at:'2026-11-05T17:00:00Z',ends_at:'2026-11-05T18:00:00Z',all_day:false,motion_item:id,motion_version:1};
const feed={connection:{calendar_id:'shared@group.calendar.google.com',connected_by:user},events:[remote],sync:[{item_id:id,synced_version:1,requested_version:1,last_error:null}],range_start:start,range_end:end};
test('Motion events stay authoritative and editable without duplicate Google copies',()=>{
 const entries=calendarEntries([local],feed);
 assert.equal(entries.length,1);assert.equal(entries[0].title,local.title);assert.equal(entries[0].starts_at,local.starts_at);assert.equal(entries[0].item.id,id);assert.equal(entries[0].google,false);
});
test('saved edits show immediately while optional sync is pending or complete',()=>{
 const edited={...local,title:'New mobile edit',version:2};let entries=calendarEntries([edited],feed);
 assert.equal(entries.length,1);assert.equal(entries[0].title,edited.title);assert.equal(entries[0].pending,true);
 entries=calendarEntries([edited],{...feed,sync:[{item_id:id,synced_version:2}],events:[{...remote,title:edited.title,motion_version:2}]});
 assert.equal(entries.length,1);assert.equal(entries[0].pending,false);assert.equal(entries[0].item.version,2);
});
test('Google-only events supplement the calendar; Google deletion never hides saved athlete events',()=>{
 const external={...remote,id:'external',motion_item:null};
 const athleteEvent={...local,athlete_id:'athlete',event_type:'fight'};
 let entries=calendarEntries([athleteEvent],{...feed,events:[external]});
 assert.equal(entries.length,2);assert.equal(entries.find(e=>e.google).item,null);
 for(const current of [null,{...feed,events:[]}]) {
  entries=calendarEntries([athleteEvent],current);
  assert.equal(entries.length,1);assert.equal(entries[0].item.athlete_id,'athlete');assert.equal(entries[0].title,local.title);
 }
});
test('sample/offline fallback excludes tasks and preserves missing end times',()=>{
 const entries=calendarEntries([{...local,ends_at:null},{...local,id:'private',kind:'todo'}],null);
 assert.equal(entries.length,1);assert.equal(entries[0].ends_at,null);assert.equal(entries[0].pending,false);
});
test('Google reads paginate completely, expand recurrence and preserve all-day dates without exposing unrelated fields',async()=>{
 const urls=[];const events=await google.listGoogleEvents('private-token','shared@group.calendar.google.com',workspace,start,end,async(url,init)=>{
  const u=new URL(url);urls.push(u);assert.equal(u.searchParams.get('singleEvents'),'true');assert.equal(u.searchParams.get('showDeleted'),'false');assert.equal(init.headers.Authorization,'Bearer private-token');
  if(urls.length===1)return Response.json({items:[],nextPageToken:'next'});
  assert.equal(u.searchParams.get('pageToken'),'next');return Response.json({items:[{id:'all-day',summary:'Trip',start:{date:'2026-11-05'},end:{date:'2026-11-08'},attendees:[{email:'do-not-disclose@example.com'}]},
   {id:'instance',recurringEventId:'series',summary:'Recurring',start:{dateTime:'2026-11-05T09:00:00-05:00'},end:{dateTime:'2026-11-05T10:00:00-05:00'},extendedProperties:{private:{motionWorkspace:workspace,motionItem:id,motionVersion:'1'}}},
   {id:'foreign',start:{date:'2026-11-05'},end:{date:'2026-11-06'},extendedProperties:{private:{motionWorkspace:user,motionItem:id}}},
   {id:'deleted',status:'cancelled'}]});
 });assert.equal(urls.length,2);assert.equal(events.length,3);assert.equal(events[0].starts_at,'2026-11-05T00:00:00.000Z');assert.equal(events[0].ends_at,'2026-11-08T00:00:00.000Z');assert.equal(events[0].all_day,true);assert.equal(events[1].motion_item,null);assert.equal(events[2].motion_item,null);assert.ok(!JSON.stringify(events).includes('do-not-disclose'));
});
test('invalid ranges, Google denial and repeated pagination fail explicitly without returning partial calendars',async()=>{
 for(const range of [[null,end],[end,start],[start,'2027-11-01T00:00:00Z']]) assert.throws(()=>google.calendarRange(...range),/range/);
 await assert.rejects(google.listGoogleEvents('t','c',workspace,start,end,async()=>new Response('',{status:403})),/reconnect/);
 await assert.rejects(google.listGoogleEvents('t','c',workspace,start,end,async()=>Response.json({nextPageToken:'same',items:[]})),/too many/);
 await assert.rejects(google.listGoogleEvents('t','c',workspace,start,end,async()=>Response.json({items:[{id:'broken'}]})),/invalid dates/);
});
const runtimeCode=compile(await readFile(new URL('../server/calendar-runtime.ts',import.meta.url),'utf8'),true);
const handlerCode=compile(await readFile(new URL('../server/handlers/calendar-events.ts',import.meta.url),'utf8'),true);
function setup({member=true,connected=true,mismatch=false,upstream=200}={}){
 const calls=[],encryption=Buffer.alloc(32,1).toString('base64'),rt={encryption,clientId:'client',clientSecret:'secret',
  blobs:{get:async key=>{calls.push(['blob',key]);return google.seal({refreshToken:'server-only-refresh',calendarId:mismatch?'wrong':feed.connection.calendar_id,owner:user},encryption);}},
  db:{auth:{getUser:async token=>({data:{user:token==='valid'?{id:user}:null},error:null})},from(table){const filters={};const q={select(){return q},eq(k,v){filters[k]=v;return q},maybeSingle:()=>run(),single:()=>run(),then(resolve,reject){return run().then(resolve,reject)}};
   async function run(){calls.push([table,filters]);if(table==='members')return {data:member&&filters.workspace_id===workspace?{user_id:user}:null};if(table==='workspaces')return {data:{name:'Motion',owner_id:user}};if(table==='calendar_connections')return {data:connected?feed.connection:null};if(table==='calendar_sync')return {data:feed.sync};throw Error(table);}return q;}}
 };
 const fetcher=async(url,init)=>{calls.push(['google',url]);if(String(url).includes('/token'))return Response.json({access_token:'server-only-access'});return new Response(JSON.stringify({items:[{id:'google1',summary:'Google event',start:{dateTime:local.starts_at},end:{dateTime:local.ends_at}}]}),{status:upstream});};
 const mockedGoogle={...google,refreshGoogle:(...args)=>google.refreshGoogle(...args,fetcher),listGoogleEvents:(...args)=>google.listGoogleEvents(...args,fetcher)};
 const exports={};vm.runInNewContext(runtimeCode,{exports,require:name=>name.includes('google-calendar')?mockedGoogle:{},URL,Response,AbortSignal,Date,fetch:fetcher});
 const handler={};vm.runInNewContext(handlerCode,{exports:handler,require:()=>({...exports,runtime:()=>rt})});
 const request=(body={workspace,start,end},headers={})=>new Request('https://motion.example/api/calendar-events',{method:'POST',headers:{origin:'https://motion.example',authorization:'Bearer valid',...headers},body:JSON.stringify(body)});
 return {calls,request,run:req=>handler.default(req,{})};
}
test('calendar feed requires same-origin verified workspace membership before accessing Google credentials',async()=>{
 for(const headers of [{origin:'https://other.example'},{authorization:''},{authorization:'Bearer expired'}]){
  const s=setup();const r=await s.run(s.request(undefined,headers));assert.ok([401,403].includes(r.status));assert.equal(s.calls.some(c=>c[0]==='blob'||c[0]==='google'),false);
 }
 const outsider=setup({member:false});assert.equal((await outsider.run(outsider.request())).status,403);assert.equal(outsider.calls.some(c=>c[0]==='google'),false);
});
test('authorized members read only the registered calendar and never receive server credentials',async()=>{
 const s=setup();const r=await s.run(s.request({workspace,start,end,calendarId:'private-calendar-to-ignore'}));assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const data=await r.json();assert.equal(data.events[0].title,'Google event');assert.equal(data.connection.calendar_id,feed.connection.calendar_id);
 const serialized=JSON.stringify(data);assert.ok(!serialized.includes('server-only'));assert.ok(!s.calls.some(c=>JSON.stringify(c).includes('private-calendar-to-ignore')));
 assert.ok(s.calls.filter(c=>c[0]==='google').at(-1)[1].includes(encodeURIComponent(feed.connection.calendar_id)));
});
test('missing connection is explicit; mismatched credentials and upstream errors never masquerade as an empty calendar',async()=>{
 const no=setup({connected:false});const empty=await no.run(no.request());assert.equal(empty.status,200);assert.equal((await empty.json()).connection,null);assert.equal(no.calls.some(c=>c[0]==='blob'),false);
 const mismatch=setup({mismatch:true});assert.equal((await mismatch.run(mismatch.request())).status,503);assert.equal(mismatch.calls.some(c=>c[0]==='google'),false);
 const failed=setup({upstream:503});const r=await failed.run(failed.request());assert.equal(r.status,503);assert.match((await r.json()).error,/could not be loaded/);
});

test('deleted Motion events never reappear from a stale Google feed',()=>{
 assert.deepEqual(calendarEntries([],feed),[]);
});

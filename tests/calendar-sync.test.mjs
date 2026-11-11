import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
const source=await readFile(new URL('../netlify/lib/google-calendar.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {googleEvent,googleEventId,syncGoogleEvent,seal,unseal}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const owner='00000000-0000-4000-8000-000000000001',member='00000000-0000-4000-8000-000000000002',outsider='00000000-0000-4000-8000-000000000003';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;insert into auth.users values('${owner}','owner@example.test',now()),('${member}','member@example.test',now()),('${outsider}','outsider@example.test',now());`);
const migrations=new URL('../supabase/migrations/',import.meta.url);
for(const name of (await readdir(migrations)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,migrations),'utf8'));
async function as(user,query,params=[]){return db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);await tx.exec('set local role authenticated');return tx.query(query,params);});}
async function worker(query,params=[]){return db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query(query,params);});}
let w,event,job;
const eventInput={title:'Team planning',starts_at:'2026-11-05T15:00:00Z',ends_at:'2026-11-05T16:00:00Z',description:'Planning',location:'Office'};
test('members can create shared events; outsiders cannot read sync status or edit events',async()=>{
 w=(await as(owner,"select public.create_workspace('Motion','Owner') as id")).rows[0].id;
 const token=(await as(owner,'select public.get_workspace_invite($1) as token',[w])).rows[0].token;
 await as(member,"select public.join_workspace($1,'Member')",[token]);
 event=(await as(member,"select * from public.save_item($1,'event',null,0,$2)",[w,eventInput])).rows[0];
 assert.equal((await as(member,'select * from public.calendar_sync')).rows.length,1);
 assert.equal((await as(outsider,'select * from public.calendar_sync')).rows.length,0);
 await assert.rejects(as(outsider,"select public.save_item($1,'event',$2,1,$3)",[w,event.id,{title:'intrusion'}]),/Workspace access/);
 await assert.rejects(as(member,"update public.calendar_sync set synced_version=100"),/permission denied/);
 await assert.rejects(as(owner,"select public.register_google_calendar($1,$2,'calendar')",[w,owner]),/permission denied/);
 await assert.rejects(as(member,'select public.claim_calendar_sync($1)',[w]),/permission denied/);
});
test('only verified server registration connects a workspace, and existing events queue',async()=>{
 assert.equal((await worker('select public.claim_calendar_sync($1) as job',[w])).rows[0].job,null);
 await assert.rejects(worker("select public.register_google_calendar($1,$2,'calendar')",[w,member]),/owner required/);
 await worker("select public.register_google_calendar($1,$2,'calendar')",[w,owner]);
 await assert.rejects(worker("select public.register_google_calendar($1,$2,'other')",[w,owner]),/already connected/);
 assert.equal((await as(member,'select * from public.calendar_connections')).rows[0].calendar_id,'calendar');
 assert.equal((await as(outsider,'select * from public.calendar_connections')).rows.length,0);
 job=(await worker('select public.claim_calendar_sync($1) as job',[w])).rows[0].job;
 assert.equal(job.event.id,event.id);
 assert.equal((await worker('select public.claim_calendar_sync($1) as job',[w])).rows[0].job,null);
});
test('an edit during sync stays queued; stale completions cannot mark a newer event synced',async()=>{
 event=(await as(owner,"select * from public.save_item($1,'event',$2,$3,$4)",[w,event.id,event.version,{title:'Changed title'}])).rows[0];
 await worker('select public.finish_calendar_sync($1,$2,1,null)',[event.id,outsider]);
 assert.equal((await as(owner,'select synced_version from public.calendar_sync')).rows[0].synced_version,0);
 await worker('select public.finish_calendar_sync($1,$2,1,null)',[event.id,job.job.lease_id]);
 job=(await worker('select public.claim_calendar_sync($1) as job',[w])).rows[0].job;
 assert.equal(job.event.version,2);assert.equal(job.event.title,'Changed title');
 await worker('select public.finish_calendar_sync($1,$2,$3,$4)',[event.id,job.job.lease_id,2,'Google unavailable']);
 const status=(await as(owner,'select * from public.calendar_sync')).rows[0];
 assert.equal(status.synced_version,1);assert.equal(status.last_error,'Google unavailable');
 assert.ok(new Date(status.next_attempt_at)>new Date());
 assert.equal((await worker('select public.claim_calendar_sync($1) as job',[w])).rows[0].job,null);
});
test('tasks and private to-dos never enter the calendar queue',async()=>{
 await as(member,"select public.save_item($1,'todo',null,0,$2)",[w,{title:'Private'}]);
 await as(member,"select public.save_item($1,'task',null,0,$2)",[w,{title:'Task'}]);
 assert.equal((await as(owner,'select * from public.calendar_sync')).rows.length,1);
});
test('date mapping preserves instants, exclusive all-day ends, and multi-day dates',()=>{
 const e={...event,...eventInput};
 assert.equal(googleEvent(e).start.dateTime,eventInput.starts_at);
 const allDay=googleEvent({...e,all_day:true,starts_at:'2026-11-07T00:00:00Z',ends_at:'2026-11-10T00:00:00Z'});
 assert.deepEqual(allDay.start,{date:'2026-11-07'});assert.deepEqual(allDay.end,{date:'2026-11-10'});
 assert.throws(()=>googleEvent({...e,ends_at:e.starts_at}),/end must follow/);
 assert.equal(googleEvent({...e,ends_at:null}).end.dateTime,'2026-11-05T16:00:00.000Z');
});
test('retries use a stable Google ID and edits patch without creating duplicates',async()=>{
 let remote=null,creates=0,patches=0;
 const fetcher=async(_url,init)=>{
  if(!init.method)return remote?Response.json(remote):new Response('',{status:404});
  if(init.method==='POST'){creates++;remote={...JSON.parse(init.body),etag:'v1'};return Response.json(remote);}
  if(init.method==='PATCH'){patches++;assert.equal(init.headers['If-Match'],remote.etag);remote={...remote,...JSON.parse(init.body),etag:'v2'};return Response.json(remote);}
  throw new Error('Unexpected request');
 };
 await syncGoogleEvent('token','calendar',event,fetcher);
 await syncGoogleEvent('token','calendar',event,fetcher);
 await syncGoogleEvent('token','calendar',{...event,title:'New title',version:event.version+1},fetcher);
 assert.equal(creates,1);assert.equal(patches,1);assert.equal(remote.id,googleEventId(event.id));assert.equal(remote.summary,'New title');
 // A stale worker is harmless.
 await syncGoogleEvent('token','calendar',event,fetcher);assert.equal(patches,1);
});
test('temporary errors and revoked access remain explicit failures',async()=>{
 await assert.rejects(syncGoogleEvent('token','calendar',event,async()=>new Response('',{status:403})),/access is unavailable/);
 await assert.rejects(syncGoogleEvent('token','calendar',event,async()=>new Response('',{status:503})),/retry automatically/);
});
test('refresh credentials are encrypted and tampering is rejected',()=>{
 const key=Buffer.alloc(32,3).toString('base64'),encrypted=seal({refreshToken:'private-token'},key);
 assert.ok(!encrypted.includes('private-token'));assert.deepEqual(unseal(encrypted,key),{refreshToken:'private-token'});
 assert.throws(()=>unseal(encrypted,Buffer.alloc(32,4).toString('base64')));
});
test.after(()=>db.close());

test('ordinary members add athlete events to the shared calendar and teammates can edit them',async()=>{
 const athlete=(await as(member,'select * from public.save_sponsorship($1,null,0,$2)',[w,{athlete_name:'Shared calendar athlete',record_type:'athlete'}])).rows[0];
 const created=(await as(member,"select * from public.save_item($1,'event',null,0,$2)",[w,{...eventInput,title:'Athlete media day',athlete_id:athlete.id,event_type:'event'}])).rows[0];
 const shared=(await as(owner,"select * from public.items where workspace_id=$1 and kind='event' and athlete_id=$2",[w,athlete.id])).rows;
 assert.equal(shared.length,1);assert.equal(shared[0].id,created.id);assert.equal(shared[0].created_by,member);
 const edited=(await as(owner,"select * from public.save_item($1,'event',$2,$3,$4)",[w,created.id,created.version,{title:'Updated media day'}])).rows[0];
 const seen=(await as(member,'select * from public.items where id=$1',[edited.id])).rows[0];assert.equal(seen.title,'Updated media day');assert.equal(seen.athlete_id,athlete.id);
 assert.equal((await as(outsider,'select * from public.items where id=$1',[created.id])).rows.length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
const db=new PGlite();
const owner='00000000-0000-4000-8000-000000000001',member='00000000-0000-4000-8000-000000000002',outsider='00000000-0000-4000-8000-000000000003';
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;insert into auth.users values('${owner}','owner@example.test',now()),('${member}','member@example.test',now()),('${outsider}','outsider@example.test',now());`);
const migrations=new URL('../supabase/migrations/',import.meta.url);
for(const name of (await readdir(migrations)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,migrations),'utf8'));
async function as(user,query,params=[],role='authenticated'){return db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);await tx.exec(`set local role ${role}`);return tx.query(query,params);});}
const worker=(sql,args)=>as(owner,sql,args,'service_role');
let w,event,task,lease;
test('event deletion requires membership and current version; direct deletes remain denied',async()=>{
 w=(await as(owner,"select public.create_workspace('Motion','Owner') as id")).rows[0].id;
 const token=(await as(owner,'select public.get_workspace_invite($1) as token',[w])).rows[0].token;
 await as(member,"select public.join_workspace($1,'Member')",[token]);
 event=(await as(owner,"select * from public.save_item($1,'event',null,0,$2)",[w,{title:'Disposable event',starts_at:'2026-11-11T15:00:00Z'}])).rows[0];
 task=(await as(owner,"select * from public.save_item($1,'task',null,0,$2)",[w,{title:'Keep this work',event_id:event.id}])).rows[0];
 await assert.rejects(as(outsider,'select public.delete_item($1,$2,$3)',[w,event.id,event.version]),/Workspace access/);
 await assert.rejects(as(member,'select public.delete_item($1,$2,0)',[w,event.id]),/changed/);
 await assert.rejects(as(member,'delete from public.items where id=$1',[event.id]),/permission denied/);
 await worker("select public.register_google_calendar($1,$2,'shared')",[w,owner]);
 lease=(await worker('select public.claim_calendar_sync_v2($1) as job',[w])).rows[0].job;
});
test('any workspace member can delete an event while keeping its linked tasks',async()=>{
 await as(member,'select public.delete_item($1,$2,$3)',[w,event.id,event.version]);
 assert.equal((await as(owner,'select * from public.items where id=$1',[event.id])).rows.length,0);
 const kept=(await as(owner,'select * from public.items where id=$1',[task.id])).rows[0];
 assert.equal(kept.title,task.title);assert.equal(kept.event_id,null);assert.equal(kept.version,task.version+1);
 await assert.rejects(as(owner,"select public.save_item($1,'event',$2,$3,$4)",[w,event.id,event.version,{title:'Stale save'}]),/not found/);
 await assert.rejects(as(owner,"select public.save_item($1,'task',$2,$3,$4)",[w,task.id,task.version,{title:'Stale task'}]),/changed/);
 task=kept;
});
test('deletion waits for an in-flight Google write and remains queued through retries',async()=>{
 let status=(await as(member,'select * from public.calendar_sync where item_id=$1',[event.id])).rows[0];
 assert.equal(status.delete_requested,true);assert.equal(status.lease_id,lease.job.lease_id);
 assert.equal((await worker('select public.claim_calendar_sync_v2($1) as job',[w])).rows[0].job,null);
 await worker('select public.finish_calendar_sync($1,$2,$3,null)',[event.id,lease.job.lease_id,event.version]);
 assert.equal((await worker('select public.claim_calendar_sync($1) as job',[w])).rows[0].job,null);
 let next=(await worker('select public.claim_calendar_sync_v2($1) as job',[w])).rows[0].job;
 assert.equal(next.event,null);assert.equal(next.job.delete_requested,true);assert.equal(next.job.requested_version,event.version+1);
 await worker('select public.finish_calendar_sync($1,$2,$3,$4)',[event.id,next.job.lease_id,next.job.requested_version,'Temporary failure']);
 status=(await as(member,'select * from public.calendar_sync where item_id=$1',[event.id])).rows[0];
 assert.equal(status.synced_version,event.version);assert.equal(status.delete_requested,true);
 await db.query('update public.calendar_sync set next_attempt_at=now() where item_id=$1',[event.id]);
 next=(await worker('select public.claim_calendar_sync_v2($1) as job',[w])).rows[0].job;
 await worker('select public.finish_calendar_sync($1,$2,$3,null)',[event.id,next.job.lease_id,next.job.requested_version]);
 assert.equal((await worker('select public.claim_calendar_sync_v2($1) as job',[w])).rows[0].job,null);
});
test('linked tasks can be deleted too; private to-dos cannot be deleted with this RPC',async()=>{
 await as(member,'select public.delete_item($1,$2,$3)',[w,task.id,task.version]);
 assert.equal((await as(owner,'select * from public.items where id=$1',[task.id])).rows.length,0);
 const todo=(await as(owner,"select * from public.save_item($1,'todo',null,0,$2)",[w,{title:'Private'}])).rows[0];
 await assert.rejects(as(member,'select public.delete_item($1,$2,$3)',[w,todo.id,todo.version]),/Only events and tasks/);
});
const source=await readFile(new URL('../server/google-calendar.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {deleteGoogleEvent}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('Google deletes use stable IDs, workspace verification and safe idempotent retries',async()=>{
 let deletes=0;
 const existing={etag:'version',extendedProperties:{private:{motionItem:event.id,motionWorkspace:w}}};
 await deleteGoogleEvent('token','shared',event.id,w,async(url,init)=>{
  if(init.method==='DELETE'){deletes++;assert.equal(init.headers['If-Match'],'version');return new Response(null,{status:deletes===1?412:204});}
  return Response.json(existing);
 });
 assert.equal(deletes,2);
 for(const status of [404,410])await deleteGoogleEvent('token','shared',event.id,w,async()=>new Response(null,{status}));
 await assert.rejects(deleteGoogleEvent('token','shared',event.id,outsider,async()=>Response.json(existing)),/does not match/);
 await assert.rejects(deleteGoogleEvent('token','shared',event.id,w,async()=>new Response(null,{status:503})),/retry/);
});
test('server storage is inaccessible to browsers and preserves atomic create and expiry',async()=>{
 for(const role of ['anon','authenticated'])await assert.rejects(as(owner,"select public.server_store('motion-app-login','ticket/test','get')",[],role),/permission denied/);
 const create=()=>worker("select public.server_store('motion-app-login','ticket/test','create',$1) as result",[{expiresAt:Date.now()+600000}]);
 assert.equal((await create()).rows[0].result.modified,true);assert.equal((await create()).rows[0].result.modified,false);
 await worker("select public.server_store('motion-app-login','ticket/expired','set','{}',now()-interval '1 second')");
 assert.equal((await worker("select public.server_store('motion-app-login','ticket/expired','get') as value")).rows[0].value,null);
 await worker('select public.cleanup_server_store()');
 assert.equal((await db.query("select * from motion_private.server_objects where key='ticket/expired'")).rows.length,0);
 const key='a'.repeat(64);
 assert.equal((await worker('select public.server_rate_limit($1,1) as allowed',[key])).rows[0].allowed,true);
 assert.equal((await worker('select public.server_rate_limit($1,1) as allowed',[key])).rows[0].allowed,false);
});

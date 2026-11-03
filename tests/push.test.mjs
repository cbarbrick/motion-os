import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID,createECDH,randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
import vm from 'node:vm';
const source=await readFile(new URL('../netlify/lib/push.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {validPushTarget,pushPayload,pushResult,deliverPushJobs}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const ec=createECDH('prime256v1');ec.generateKeys();
const keys={p256dh:ec.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')};
const target=(name)=>({endpoint:`https://fcm.googleapis.com/fcm/send/${name}`,keys});
const db=new PGlite(),owner=randomUUID(),member=randomUUID(),outsider=randomUUID();
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
for(const id of [owner,member,outsider])await db.query('insert into auth.users values($1,$2,now())',[id,`${id}@example.test`]);
const migrations=new URL('../supabase/migrations/',import.meta.url);
for(const name of (await readdir(migrations)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,migrations),'utf8'));
async function as(user,query,params=[]){return db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);await tx.exec('set local role authenticated');return tx.query(query,params);});}
async function worker(query,params=[]){return db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query(query,params);});}
const w=(await as(owner,"select public.create_workspace('Push test','Owner') as id")).rows[0].id;
const token=(await as(owner,'select public.get_workspace_invite($1) as token',[w])).rows[0].token;
await as(member,"select public.join_workspace($1,'Member')",[token]);
const other=(await as(outsider,"select public.create_workspace('Other','Outsider') as id")).rows[0].id;
const subscribe=async(user,name)=>(await as(user,'select public.save_push_subscription($1,$2,$3) as id',[target(name).endpoint,keys.p256dh,keys.auth])).rows[0].id;
const create=async(title='Available task')=>(await as(owner,"select * from public.save_item($1,'task',null,0,$2)",[w,{title}])).rows[0];
const claim=async(workspace=w)=>(await worker('select public.claim_push_deliveries($1) as jobs',[workspace])).rows[0].jobs;
const finish=async(job,status='sent',lease=job.lease)=>worker('select public.finish_push_delivery($1,$2,$3)',[job.id,lease,status]);
let sub;
test('device capabilities are private and only the server can process deliveries',async()=>{
 sub=await subscribe(member,'member');
 assert.equal((await as(member,'select public.get_push_subscription($1) as id',[target('member').endpoint])).rows[0].id,sub);
 assert.equal((await as(owner,'select public.get_push_subscription($1) as id',[target('member').endpoint])).rows[0].id,null);
 await as(owner,'select public.remove_push_subscription($1)',[target('member').endpoint]);
 assert.equal((await as(member,'select public.get_push_subscription($1) as id',[target('member').endpoint])).rows[0].id,sub);
 await assert.rejects(as(member,'select * from motion_private.push_subscriptions'),/permission denied/);
 for(const sql of ['select public.claim_push_deliveries(null)',`select public.prepare_push_test('${sub}','${member}')`,`select public.finish_push_delivery('${sub}','${sub}','sent')`])await assert.rejects(as(member,sql),/permission denied/);
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select public.save_push_subscription($1,$2,$3)',[target('anon').endpoint,keys.p256dh,keys.auth]);}),/permission denied/);
});
test('registration is idempotent, validates providers and prevents capability theft',async()=>{
 assert.equal(await subscribe(member,'member'),sub);
 for(const endpoint of ['http://127.0.0.1/x','https://example.com/x','https://fcm.googleapis.com.evil.test/x','https://fcm.googleapis.com@127.0.0.1/x','https://fcm.googleapis.com:8443/x'])await assert.rejects(as(member,'select public.save_push_subscription($1,$2,$3)',[endpoint,keys.p256dh,keys.auth]),/not supported/);
 await assert.rejects(as(owner,'select public.save_push_subscription($1,$2,$3)',[target('member').endpoint,keys.p256dh,'b'.repeat(22)]),/changed/);
 await assert.rejects(as(member,'select public.save_push_subscription($1,$2,$3)',[target('badkeys').endpoint,'bad','bad']),/Invalid device/);
});
test('only opted-in recipients queue; worker leases and stale completions prevent duplicate dispatch',async()=>{
 await subscribe(owner,'owner');await subscribe(outsider,'outsider');
 await create();
 const jobs=await claim();assert.equal(jobs.length,1);assert.equal(jobs[0].subscription.endpoint,target('member').endpoint);assert.equal(jobs[0].kind,'task_available');
 assert.equal((await claim()).length,0);
 await finish(jobs[0],'sent',randomUUID());
 assert.equal((await db.query('select finished_at from motion_private.push_deliveries where id=$1',[jobs[0].id])).rows[0].finished_at,null);
 await finish(jobs[0]);assert.equal((await claim()).length,0);assert.equal((await claim(other)).length,0);
});
test('reading an alert before dispatch suppresses phone delivery; late opt-in has no history flood',async()=>{
 const item=await create();await as(member,'select public.read_notifications($1,null)',[w]);
 assert.equal((await claim()).length,0);
 await subscribe(member,'second-device');assert.equal((await claim()).length,0);
 const next=await create('After opt-in');const jobs=await claim();assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.kind==='task_available'));for(const j of jobs)await finish(j);
});
test('temporary failures retry with backoff; expired subscriptions are removed',async()=>{
 await create('Retry');const jobs=await claim();
 await finish(jobs[0],'retry');await finish(jobs[1],'expired');
 assert.equal((await claim()).length,0);
 const row=(await db.query('select * from motion_private.push_deliveries where id=$1',[jobs[0].id])).rows[0];assert.equal(row.attempts,1);assert.ok(new Date(row.next_attempt_at)>new Date());
 await db.query("update motion_private.push_deliveries set next_attempt_at=now()-interval '1 second' where id=$1",[jobs[0].id]);
 const retry=await claim();assert.equal(retry.length,1);assert.notEqual(retry[0].lease,jobs[0].lease);await finish(retry[0]);
});
test('changing account on a shared device discards old queued messages',async()=>{
 await subscribe(member,'shared-device');await create('Before switch');
 await subscribe(owner,'shared-device');
 const jobs=await claim();assert.ok(jobs.every(j=>j.subscription.endpoint!==target('shared-device').endpoint));for(const j of jobs)await finish(j);
});
test('tests are owner-specific and rate limited; removal and revocation stop queued messages',async()=>{
 const id=await subscribe(member,'test-device');
 await assert.rejects(worker('select public.prepare_push_test($1,$2)',[id,owner]),/Enable notifications/);
 const result=(await worker('select public.prepare_push_test($1,$2) as sub',[id,member])).rows[0].sub;assert.equal(result.endpoint,target('test-device').endpoint);
 await assert.rejects(worker('select public.prepare_push_test($1,$2)',[id,member]),/30 seconds/);
 await create('Before disable');await as(member,'select public.remove_push_subscription($1)',[target('test-device').endpoint]);
 await as(owner,'select public.remove_access($1,$2,null)',[w,member]);
 assert.equal((await claim()).length,0);
 await assert.rejects(subscribe(member,'revoked'),/Join a workspace/);
});
test('push payloads disclose no record content and retry status is bounded',async()=>{
 const payload=JSON.parse(pushPayload('event_added','example-id'));
 assert.equal(payload.title,'Motion OS');assert.equal(payload.url,'/#notifications');assert.match(payload.body,/calendar event/);
 assert.equal(pushResult({statusCode:410}),'expired');assert.equal(pushResult({statusCode:429}),'retry');assert.equal(pushResult({statusCode:503}),'retry');assert.equal(pushResult({statusCode:403}),'failed');
 assert.equal(validPushTarget(target('valid')),true);
 for(const endpoint of ['https://127.0.0.1/x','https://fcm.googleapis.com.evil.test/x','https://fcm.googleapis.com:444/x','https://user@fcm.googleapis.com/x','https://fcm.googleapis.com/x#y'])assert.equal(validPushTarget({...target('test'),endpoint}),false);
 const outcomes=[];await deliverPushJobs([
  {id:'a',lease:'1',kind:'event_added',notification:'n',subscription:target('ok')},
  {id:'b',lease:'2',kind:'task_added',notification:'n2',subscription:target('expired')},
  {id:'c',lease:'3',kind:'task_added',notification:'n3',subscription:{...target('bad'),endpoint:'https://127.0.0.1'}}
 ],async s=>{if(s.endpoint.endsWith('expired'))throw {statusCode:410};},async(j,s)=>outcomes.push([j.id,s]));
 assert.deepEqual(outcomes.sort(),[['a','sent'],['b','expired'],['c','failed']]);
});
test('service worker shows a visible push and opens only the Motion OS inbox',async()=>{
 const handlers={},shown=[],opened=[];let closed=false;
 const scope={location:{origin:'https://motion-team-os.netlify.app'},addEventListener:(name,fn)=>handlers[name]=fn,
 registration:{showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),{self:scope,URL});
 let pending;
 handlers.push({data:{json:()=>({body:'A new task is available.',url:'https://evil.test'})},waitUntil:p=>pending=p});await pending;
 assert.equal(shown[0][0],'Motion OS');assert.equal(shown[0][1].data.url,'/#notifications');
 handlers.notificationclick({notification:{close:()=>closed=true,data:{url:'https://evil.test'}},waitUntil:p=>pending=p});await pending;
 assert.equal(closed,true);assert.deepEqual(opened,['https://motion-team-os.netlify.app/#notifications']);
});
test.after(()=>db.close());

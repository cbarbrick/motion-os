import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const owner='00000000-0000-4000-8000-000000000001',member='00000000-0000-4000-8000-000000000002',outsider='00000000-0000-4000-8000-000000000003';
let w,task,token;
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;insert into auth.users values('${owner}','owner@motionbrand.com',now()),('${member}','member@outside-company.net',now()),('${outsider}','outsider@gmail.com',now());`);
const migrations=new URL('../supabase/migrations/',import.meta.url);
for(const name of (await readdir(migrations)).filter(f=>f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name,migrations),'utf8'));
async function as(user,query,params=[]){return db.transaction(async tx=>{await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user]);await tx.exec('set local role authenticated');return tx.query(query,params);});}
test('only the owner creates invite links; no membership without a valid token',async()=>{
 w=(await as(owner,"select public.create_workspace('Motion','Owner') as id")).rows[0].id;
 assert.equal((await as(outsider,'select * from public.workspaces')).rows.length,0);
 await assert.rejects(as(outsider,'select public.get_workspace_invite($1)',[w]),/owner access/);
 await assert.rejects(as(outsider,"select public.join_workspace($1,'Outside')",[outsider]),/invalid/);
 token=(await as(owner,'select public.get_workspace_invite($1) as token',[w])).rows[0].token;
 await assert.rejects(as(outsider,'select * from public.workspace_invites'),/permission denied/);
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query("select public.join_workspace($1,'Anonymous')",[token]);}),/permission denied/);
});
test('any verified account can join through the invitation regardless of email domain',async()=>{
 const joined=(await as(member,"select public.join_workspace($1,'Member') as id",[token])).rows[0].id;
 assert.equal(joined,w);assert.equal((await as(member,'select * from public.workspaces')).rows.length,1);
 await as(member,"select public.join_workspace($1,'Member')",[token]);
 assert.equal((await as(owner,'select * from public.members where workspace_id=$1',[w])).rows.length,2);
 await assert.rejects(as(member,'select public.disable_workspace_invite($1)',[w]),/owner access/);
});
test('task claiming is exclusive and rejects a second claimant',async()=>{
 task=(await as(owner,"select * from public.save_item($1,'task',null,0,$2)",[w,{title:'Claim me',definition_done:'Deliver the plan'}])).rows[0];
 const claimed=(await as(member,'select * from public.claim_task($1)',[task.id])).rows[0];assert.equal(claimed.assignee_id,member);
 await assert.rejects(as(owner,'select public.claim_task($1)',[task.id]),/no longer available/);task=claimed;
});
test('all members can assign others and complete without approval or delivery evidence',async()=>{
 task=(await as(member,"select * from public.save_item($1,'task',$2,$3,$4)",[w,task.id,task.version,{assignee_id:owner,status:'done'}])).rows[0];
 assert.equal(task.status,'done');assert.equal(task.assignee_id,owner);assert.equal(task.delivery_notes,'');
 await assert.rejects(as(member,"update public.items set status='open' where id=$1",[task.id]),/permission denied/);
 await assert.rejects(as(outsider,"select public.save_item($1,'task',$2,$3,$4)",[w,task.id,task.version,{title:'Intrusion'}]),/Workspace access/);
});
test('stale edits and removed review state fail; any member can edit shared work',async()=>{
 await assert.rejects(as(member,"select public.save_item($1,'task',$2,0,$3)",[w,task.id,{title:'Stale'}]),/changed/);
 await assert.rejects(as(member,"select public.save_item($1,'task',$2,$3,$4)",[w,task.id,task.version,{status:'review'}]),/tasks_have_no_review_step/);
 task=(await as(member,"select * from public.save_item($1,'task',$2,$3,$4)",[w,task.id,task.version,{title:'Shared edit'}])).rows[0];assert.equal(task.title,'Shared edit');
});
test('personal to-dos remain private even from workspace owner',async()=>{
 const todo=(await as(member,"select * from public.save_item($1,'todo',null,0,$2)",[w,{title:'Private reminder'}])).rows[0];
 assert.equal((await as(owner,'select * from public.items where id=$1',[todo.id])).rows.length,0);
 await assert.rejects(as(owner,"select public.save_item($1,'todo',$2,1,$3)",[w,todo.id,{title:'Read private'}]),/Private to-do/);
});
test('everyone can plan events but assignments and event links cannot cross workspaces',async()=>{
 const other=(await as(outsider,"select public.create_workspace('Other','Outsider') as id")).rows[0].id;
 const e=(await as(outsider,"select * from public.save_item($1,'event',null,0,$2)",[other,{title:'Other event',starts_at:new Date().toISOString()}])).rows[0];
 await assert.rejects(as(owner,"select public.save_item($1,'task',null,0,$2)",[w,{title:'Invalid event',event_id:e.id}]),/this workspace/);
 await assert.rejects(as(member,"select public.save_item($1,'task',null,0,$2)",[w,{title:'Invalid owner',assignee_id:outsider}]),/foreign key/);
 const created=(await as(member,"select * from public.save_item($1,'event',null,0,$2)",[w,{title:'Team event',starts_at:new Date().toISOString(),assignee_id:owner}])).rows[0];assert.equal(created.title,'Team event');
});
test('rotation invalidates the old invite and disabling stops new joins without removing members',async()=>{
 const next=(await as(owner,'select public.get_workspace_invite($1,true) as token',[w])).rows[0].token;assert.notEqual(next,token);
 await assert.rejects(as(outsider,"select public.join_workspace($1,'Outsider')",[token]),/invalid/);token=next;
 await as(owner,'select public.disable_workspace_invite($1)',[w]);
 await assert.rejects(as(outsider,"select public.join_workspace($1,'Outsider')",[token]),/invalid/);
 assert.equal((await as(member,'select * from public.workspaces')).rows.length,1);
 token=(await as(owner,'select public.get_workspace_invite($1) as token',[w])).rows[0].token;
});
test('revocation immediately blocks reads, writes, invite rejoining and legacy grants',async()=>{
 await as(owner,"select public.grant_access($1,'member@outside-company.net','member')",[w]);
 await as(owner,'select public.remove_access($1,$2,null)',[w,member]);
 assert.equal((await as(member,'select * from public.items')).rows.length,0);
 await assert.rejects(as(member,"select public.save_item($1,'idea',null,0,$2)",[w,{title:'No access'}]),/Workspace access/);
 await assert.rejects(as(member,"select public.join_workspace($1,'Member')",[token]),/access was removed/);
 await as(member,"select public.accept_access('Member')");assert.equal((await as(member,'select * from public.workspaces')).rows.length,0);
 await as(owner,'select public.restore_workspace_access($1,$2)',[w,member]);
 await as(member,"select public.join_workspace($1,'Member')",[token]);assert.equal((await as(member,'select * from public.workspaces')).rows.length,1);
});
let sponsorship;
test('members submit affiliates but cannot set decisions or bypass RPCs',async()=>{
 sponsorship=(await as(member,'select * from public.save_sponsorship($1,null,0,$2)',[w,{record_type:'affiliate',athlete_name:'Potential affiliate',sport:'Running',requested_support:'Product and $500',deliverables:'Two videos'}])).rows[0];
 assert.equal(sponsorship.status,'pending');
 await assert.rejects(as(member,'select public.save_sponsorship($1,$2,$3,$4)',[w,sponsorship.id,sponsorship.version,{status:'approved'}]),/Unknown proposal fields/);
 await assert.rejects(as(member,"update public.sponsorships set status='approved' where id=$1",[sponsorship.id]),/permission denied/);
 await assert.rejects(as(outsider,'select public.save_sponsorship($1,null,0,$2)',[w,{athlete_name:'Unauthorized'}]),/Workspace access/);
 assert.equal((await as(outsider,'select * from public.sponsorships where workspace_id=$1',[w])).rows.length,0);
});
test('only the workspace owner selects a reviewer, and that reviewer must be a member',async()=>{
 await assert.rejects(as(member,'select public.set_sponsorship_reviewer($1,$2)',[w,member]),/owner access/);
 await assert.rejects(as(owner,'select public.set_sponsorship_reviewer($1,$2)',[w,outsider]),/workspace member/);
 await assert.rejects(as(owner,"select public.review_sponsorship($1,$2,'approved','')",[sponsorship.id,sponsorship.version]),/selected sponsorship reviewer/);
 await as(owner,'select public.set_sponsorship_reviewer($1,$2)',[w,member]);
 assert.equal((await as(member,'select reviewer_id from public.sponsorship_settings where workspace_id=$1',[w])).rows[0].reviewer_id,member);
});
test('only the selected reviewer approves or denies, with immutable attributed history',async()=>{
 await assert.rejects(as(owner,"select public.review_sponsorship($1,$2,'approved','Forged decision')",[sponsorship.id,sponsorship.version]),/selected sponsorship reviewer/);
 sponsorship=(await as(member,"select * from public.review_sponsorship($1,$2,'approved','Good fit for the launch')",[sponsorship.id,sponsorship.version])).rows[0];
 assert.equal(sponsorship.status,'approved');assert.equal(sponsorship.decided_by,member);assert.ok(sponsorship.decided_at);
 const history=(await as(owner,'select * from public.sponsorship_comments where sponsorship_id=$1',[sponsorship.id])).rows;
 assert.equal(history[0].author_id,member);assert.equal(history[0].action,'approved');assert.equal(history[0].body,'Good fit for the launch');
 await assert.rejects(as(owner,"delete from public.sponsorship_comments where sponsorship_id=$1",[sponsorship.id]),/permission denied/);
 await assert.rejects(as(member,"select public.review_sponsorship($1,1,'denied','Stale')",[sponsorship.id]),/changed/);
});
test('editing reviewed terms requests a new review and preserves the old decision',async()=>{
 sponsorship=(await as(owner,'select * from public.save_sponsorship($1,$2,$3,$4)',[w,sponsorship.id,sponsorship.version,{requested_support:'Product and $1000'}])).rows[0];
 assert.equal(sponsorship.status,'pending');assert.equal(sponsorship.decided_by,null);
 const history=(await as(owner,'select action from public.sponsorship_comments where sponsorship_id=$1',[sponsorship.id])).rows;
 assert.deepEqual(new Set(history.map(c=>c.action)),new Set(['approved','updated']));
 sponsorship=(await as(member,"select * from public.review_sponsorship($1,$2,'denied','Budget too high')",[sponsorship.id,sponsorship.version])).rows[0];assert.equal(sponsorship.status,'denied');
 const same=(await as(owner,'select * from public.save_sponsorship($1,$2,$3,$4)',[w,sponsorship.id,sponsorship.version,{requested_support:'Product and $1000'}])).rows[0];assert.equal(same.status,'denied');assert.equal(same.version,sponsorship.version);
});
test('comments are attributed to the signed-in member and isolated by workspace',async()=>{
 const c=(await as(owner,"select * from public.add_sponsorship_comment($1,'Can we propose product only?')",[sponsorship.id])).rows[0];assert.equal(c.author_id,owner);assert.equal(c.action,'comment');
 await assert.rejects(as(outsider,"select public.add_sponsorship_comment($1,'No access')",[sponsorship.id]),/Workspace access/);
 assert.equal((await as(outsider,'select * from public.sponsorship_comments where sponsorship_id=$1',[sponsorship.id])).rows.length,0);
 assert.equal((await as(outsider,'select * from public.sponsorship_settings where workspace_id=$1',[w])).rows.length,0);
 await assert.rejects(as(member,"select public.add_sponsorship_comment($1,'  ')",[sponsorship.id]),/Write a comment/);
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query("select public.add_sponsorship_comment($1,'Anon')",[sponsorship.id]);}),/permission denied/);
});
test('invalid decisions and proposal fields fail without changing stored status',async()=>{
 await assert.rejects(as(member,"select public.review_sponsorship($1,$2,null,'')",[sponsorship.id,sponsorship.version]),/Invalid decision/);
 await assert.rejects(as(member,"select public.review_sponsorship($1,$2,'approved',$3)",[sponsorship.id,sponsorship.version,'x'.repeat(4001)]),/4000/);
 await assert.rejects(as(owner,'select public.save_sponsorship($1,$2,$3,$4)',[w,sponsorship.id,sponsorship.version,{profile_url:'javascript:alert(1)'}]),/check constraint/);
 assert.equal((await as(owner,'select status from public.sponsorships where id=$1',[sponsorship.id])).rows[0].status,'denied');
});
test('removing the reviewer immediately revokes review, comment and proposal read access',async()=>{
 await as(owner,'select public.remove_access($1,$2,null)',[w,member]);
 await assert.rejects(as(member,"select public.review_sponsorship($1,$2,'approved','')",[sponsorship.id,sponsorship.version]),/Workspace access/);
 await assert.rejects(as(member,"select public.add_sponsorship_comment($1,'Removed')",[sponsorship.id]),/Workspace access/);
 assert.equal((await as(member,'select * from public.sponsorships')).rows.length,0);
});

test('athlete fights are calendar events with shared content notes and linked tasks',async()=>{
 const athlete=(await as(owner,'select * from public.save_sponsorship($1,null,0,$2)',[w,{athlete_name:'Fight athlete',record_type:'athlete'}])).rows[0];
 let fight=(await as(owner,"select * from public.save_item($1,'event',null,0,$2)",[w,{title:'Championship fight',athlete_id:athlete.id,event_type:'fight',starts_at:'2026-11-14T23:00:00Z',content_needs:'Weigh-in photos\nWalkout video'}])).rows[0];
 assert.equal(fight.athlete_id,athlete.id);assert.equal(fight.event_type,'fight');assert.match(fight.content_needs,/Walkout/);
 fight=(await as(owner,"select * from public.save_item($1,'event',$2,$3,$4)",[w,fight.id,fight.version,{content_needs:'Interview after the fight',starts_at:'2026-11-15T23:00:00Z'}])).rows[0];
 assert.equal(fight.content_needs,'Interview after the fight');assert.equal(new Date(fight.starts_at).getUTCDate(),15);
 const content=(await as(owner,"select * from public.save_item($1,'task',null,0,$2)",[w,{title:'Film interview',event_id:fight.id,category:'Content'}])).rows[0];assert.equal(content.event_id,fight.id);
 await assert.rejects(as(owner,"select public.save_item($1,'event',$2,1,$3)",[w,fight.id,{content_needs:'Stale'}]),/changed/);
 await assert.rejects(as(outsider,"select public.save_item($1,'event',$2,$3,$4)",[w,fight.id,fight.version,{content_needs:'Intrusion'}]),/Workspace access/);
 assert.equal((await as(outsider,'select * from public.items where id=$1',[fight.id])).rows.length,0);
});
test('people profiles retain rate and description with reviewer decisions and undo history',async()=>{
 await as(owner,'select public.set_sponsorship_reviewer($1,$2)',[w,owner]);
 let person=(await as(owner,'select * from public.save_sponsorship($1,null,0,$2)',[w,{record_type:'person',athlete_name:'Candidate',sport:'Videographer',rate:'$750 / day',proposal:'Event filming'}])).rows[0];
 assert.equal(person.record_type,'person');assert.equal(person.rate,'$750 / day');assert.equal(person.proposal,'Event filming');
 person=(await as(owner,"select * from public.review_sponsorship($1,$2,'approved','Approved for event')",[person.id,person.version])).rows[0];assert.equal(person.decided_by,owner);
 person=(await as(owner,"select * from public.review_sponsorship($1,$2,'pending','Decision undone')",[person.id,person.version])).rows[0];assert.equal(person.status,'pending');
 person=(await as(owner,"select * from public.review_sponsorship($1,$2,'denied','Rate exceeds budget')",[person.id,person.version])).rows[0];
 person=(await as(owner,'select * from public.save_sponsorship($1,$2,$3,$4)',[w,person.id,person.version,{rate:'$650 / day'}])).rows[0];assert.equal(person.status,'pending');
 await assert.rejects(as(owner,'select public.save_sponsorship($1,$2,$3,$4)',[w,person.id,person.version,{record_type:'athlete'}]),/Record type cannot change/);
 await assert.rejects(as(owner,"select public.save_item($1,'event',null,0,$2)",[w,{title:'Invalid person event',athlete_id:person.id,starts_at:new Date().toISOString()}]),/Choose an athlete/);
});
test('athlete event links reject cross-workspace athletes and fields on private tasks',async()=>{
 const other=(await as(outsider,"select public.create_workspace('Another','Other') as id")).rows[0].id;
 const a=(await as(outsider,'select * from public.save_sponsorship($1,null,0,$2)',[other,{athlete_name:'Other athlete'}])).rows[0];
 await assert.rejects(as(owner,"select public.save_item($1,'event',null,0,$2)",[w,{title:'Wrong workspace',athlete_id:a.id,starts_at:new Date().toISOString()}]),/Choose an athlete/);
 await assert.rejects(as(owner,"select public.save_item($1,'todo',null,0,$2)",[w,{title:'Private',content_needs:'Invalid event field'}]),/athlete_fields_are_event_only/);
 await assert.rejects(as(owner,"select public.save_item($1,'event',null,0,$2)",[w,{title:'Invalid kind',event_type:'gala',starts_at:new Date().toISOString()}]),/check constraint/);
});

let sharedTask, taskNotice;
test('adding task people sends one attributed notification per new recipient',async()=>{
 await as(owner,'select public.restore_workspace_access($1,$2)',[w,member]);
 await as(member,"select public.join_workspace($1,'Member')",[token]);
 sharedTask=(await as(owner,"select * from public.save_item($1,'task',null,0,$2)",[w,{title:'Film the fight',assignee_id:owner,collaborator_ids:[owner,member,member],week_of:'2026-10-26'}])).rows[0];
 assert.deepEqual(sharedTask.collaborator_ids,[owner,member]);
 const notifications=(await as(member,'select * from public.notifications where item_id=$1',[sharedTask.id])).rows;
 assert.equal(notifications.length,1);taskNotice=notifications[0];
 assert.equal(taskNotice.actor_id,owner);assert.equal(taskNotice.actor_name,'Owner');assert.equal(taskNotice.recipient_id,member);assert.equal(taskNotice.task_title,'Film the fight');assert.equal(taskNotice.read_at,null);
 assert.equal((await as(owner,'select * from public.notifications where item_id=$1',[sharedTask.id])).rows.length,0);
 assert.equal((await as(outsider,'select * from public.notifications')).rows.length,0);
});
test('notifications cannot be forged, read or marked by another user',async()=>{
 await assert.rejects(as(member,"update public.notifications set actor_name='Forged' where id=$1",[taskNotice.id]),/permission denied/);
 await assert.rejects(as(member,"insert into public.notifications(workspace_id,recipient_id,actor_name,item_id,item_version,task_title) values($1,$2,'Forged',$3,999,'Fake')",[w,owner,sharedTask.id]),/permission denied/);
 await assert.rejects(as(owner,'select public.read_notifications($1,$2)',[w,taskNotice.id]),/not found/);
 await assert.rejects(as(outsider,'select public.read_notifications($1,null)',[w]),/Workspace access/);
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query('select * from public.notifications');}),/permission denied/);
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query('select public.read_notifications($1,null)',[w]);}),/permission denied/);
 await as(member,'select public.read_notifications($1,$2)',[w,taskNotice.id]);
 assert.ok((await as(member,'select read_at from public.notifications where id=$1',[taskNotice.id])).rows[0].read_at);
});
test('ordinary edits and owner changes within the same task team do not repeat alerts',async()=>{
 sharedTask=(await as(owner,"select * from public.save_item($1,'task',$2,$3,$4)",[w,sharedTask.id,sharedTask.version,{description:'Bring cameras',assignee_id:member}])).rows[0];
 assert.equal((await as(member,'select * from public.notifications where item_id=$1',[sharedTask.id])).rows.length,1);
 await assert.rejects(as(owner,"select public.save_item($1,'task',$2,1,$3)",[w,sharedTask.id,{collaborator_ids:[]}]),/changed/);
 sharedTask=(await as(owner,"select * from public.save_item($1,'task',$2,$3,$4)",[w,sharedTask.id,sharedTask.version,{assignee_id:owner,collaborator_ids:[]}])).rows[0];
 sharedTask=(await as(owner,"select * from public.save_item($1,'task',$2,$3,$4)",[w,sharedTask.id,sharedTask.version,{collaborator_ids:[member]}])).rows[0];
 assert.equal((await as(member,'select * from public.notifications where item_id=$1',[sharedTask.id])).rows.length,2);
});
test('owner assignment notifies the teammate; self-claim and self-assignment stay quiet',async()=>{
 const assigned=(await as(owner,"select * from public.save_item($1,'task',null,0,$2)",[w,{title:'Assigned directly',assignee_id:member}])).rows[0];
 assert.equal((await as(member,'select * from public.notifications where item_id=$1',[assigned.id])).rows.length,1);
 const own=(await as(owner,"select * from public.save_item($1,'task',null,0,$2)",[w,{title:'My own work',assignee_id:owner}])).rows[0];
 assert.equal((await as(owner,'select * from public.notifications where item_id=$1',[own.id])).rows.length,0);
 const open=(await as(owner,"select * from public.save_item($1,'task',null,0,$2)",[w,{title:'Open work'}])).rows[0];
 const available=(await as(member,'select * from public.notifications where item_id=$1',[open.id])).rows;
 assert.equal(available.length,1);assert.equal(available[0].kind,'task_available');
 await as(member,'select public.claim_task($1)',[open.id]);
 assert.equal((await as(member,'select * from public.notifications where item_id=$1',[open.id])).rows.length,1);
});
test('task people cannot cross workspaces or expose private to-dos',async()=>{
 await assert.rejects(as(owner,"select public.save_item($1,'task',null,0,$2)",[w,{title:'Invalid team',collaborator_ids:[outsider]}]),/must belong to this workspace/);
 await assert.rejects(as(owner,"select public.save_item($1,'task',null,0,$2)",[w,{title:'Invalid member',collaborator_ids:[null]}]),/Choose up to/);
 await assert.rejects(as(owner,"select public.save_item($1,'todo',null,0,$2)",[w,{title:'Private',collaborator_ids:[member]}]),/task_collaborators_only/);
 const privateTask=(await as(owner,"select * from public.save_item($1,'todo',null,0,$2)",[w,{title:'Private'}])).rows[0];
 assert.equal((await as(member,'select * from public.notifications where item_id=$1',[privateTask.id])).rows.length,0);
});
test('mark all read affects only the signed-in recipient and selected workspace',async()=>{
 await as(member,"select public.save_item($1,'task',null,0,$2)",[w,{title:'Owner notification',assignee_id:owner}]);
 const second=(await as(member,"select public.create_workspace('Second workspace','Member') as id")).rows[0].id;
 const secondToken=(await as(member,'select public.get_workspace_invite($1) as token',[second])).rows[0].token;
 await as(owner,"select public.join_workspace($1,'Owner')",[secondToken]);
 await as(owner,"select public.save_item($1,'task',null,0,$2)",[second,{title:'Second workspace task',assignee_id:member}]);
 await as(member,'select public.read_notifications($1,null)',[w]);
 assert.equal((await as(member,'select * from public.notifications where workspace_id=$1 and read_at is null',[w])).rows.length,0);
 assert.equal((await as(member,'select * from public.notifications where workspace_id=$1 and read_at is null',[second])).rows.length,1);
 assert.ok((await as(owner,'select * from public.notifications where workspace_id=$1 and read_at is null',[w])).rows.length>0);
});
test('removing a member removes their task participation and notifications immediately',async()=>{
 await as(owner,'select public.remove_access($1,$2,null)',[w,member]);
 const updated=(await as(owner,'select * from public.items where id=$1',[sharedTask.id])).rows[0];
 assert.equal(updated.collaborator_ids.includes(member),false);assert.ok(updated.version>sharedTask.version);
 assert.equal((await as(member,'select * from public.notifications where workspace_id=$1',[w])).rows.length,0);
 await assert.rejects(as(member,'select public.read_notifications($1,null)',[w]),/Workspace access/);
 await as(owner,'select public.restore_workspace_access($1,$2)',[w,member]);
 await as(member,"select public.join_workspace($1,'Member')",[token]);
 assert.equal((await as(member,'select * from public.notifications where workspace_id=$1',[w])).rows.length,0);
});

test('athletes are active immediately and never enter the review queue',async()=>{
 await as(owner,'select public.set_sponsorship_reviewer($1,$2)',[w,owner]);
 let athlete=(await as(owner,'select * from public.save_sponsorship($1,null,0,$2)',[w,{athlete_name:'Roster athlete',deliverables:'Keep these content notes'}])).rows[0];
 assert.equal(athlete.record_type,'athlete');assert.equal(athlete.status,'active');
 await assert.rejects(as(owner,"select public.review_sponsorship($1,$2,'approved','')",[athlete.id,athlete.version]),/Athletes do not require review/);
 athlete=(await as(owner,'select * from public.save_sponsorship($1,$2,$3,$4)',[w,athlete.id,athlete.version,{sport:'MMA'}])).rows[0];
 assert.equal(athlete.status,'active');assert.equal(athlete.decided_by,null);assert.equal(athlete.decided_at,null);assert.equal(athlete.deliverables,'Keep these content notes');
 assert.equal((await as(owner,'select * from public.sponsorship_comments where sponsorship_id=$1',[athlete.id])).rows.length,0);
 await as(owner,"select public.add_sponsorship_comment($1,'Film training')",[athlete.id]);
 assert.equal((await as(owner,'select body from public.sponsorship_comments where sponsorship_id=$1',[athlete.id])).rows[0].body,'Film training');
 await assert.rejects(as(owner,'select public.save_sponsorship($1,$2,$3,$4)',[w,athlete.id,athlete.version,{record_type:'affiliate'}]),/Record type cannot change/);
 await assert.rejects(as(owner,'select public.save_sponsorship($1,$2,1,$3)',[w,athlete.id,{sport:'Stale'}]),/changed/);
});
test('affiliates retain proposed commission, require review and cannot be calendar athletes',async()=>{
 const affiliate=(await as(owner,'select * from public.save_sponsorship($1,null,0,$2)',[w,{record_type:'affiliate',athlete_name:'Affiliate creator',rate:'10% commission',proposal:'Training content'}])).rows[0];
 assert.equal(affiliate.status,'pending');assert.equal(affiliate.rate,'10% commission');
 await assert.rejects(as(owner,"select public.save_item($1,'event',null,0,$2)",[w,{title:'Wrong athlete type',athlete_id:affiliate.id,starts_at:new Date().toISOString()}]),/Choose an athlete/);
 await assert.rejects(as(owner,"select public.review_sponsorship($1,$2,'active','')",[affiliate.id,affiliate.version]),/Invalid decision/);
 await assert.rejects(as(owner,'select public.save_sponsorship($1,null,0,$2)',[w,{record_type:'unknown',athlete_name:'Bad type'}]),/check constraint/);
});

test('calendar saves end time, all-day dates and workspace guests without affecting existing notes',async()=>{
 let event=(await as(member,"select * from public.save_item($1,'event',null,0,$2)",[w,{title:'Multi-day event',starts_at:'2026-10-30T00:00:00Z',ends_at:'2026-11-02T00:00:00Z',all_day:true,event_guest_ids:[owner,member,owner],content_needs:'Film the warmup',location:'Venue'}])).rows[0];
 assert.equal(event.all_day,true);assert.equal(event.ends_at.toISOString(),'2026-11-02T00:00:00.000Z');assert.equal(event.event_guest_ids.length,2);
 const original=event;
 event=(await as(owner,"select * from public.save_item($1,'event',$2,$3,$4)",[w,event.id,event.version,{description:'Updated notes'}])).rows[0];
 assert.deepEqual(event.event_guest_ids,original.event_guest_ids);assert.equal(event.ends_at.toISOString(),original.ends_at.toISOString());assert.equal(event.content_needs,'Film the warmup');
 await assert.rejects(as(owner,"select public.save_item($1,'event',$2,$3,$4)",[w,event.id,original.version,{description:'Stale'}]),/changed/);
 await assert.rejects(as(outsider,"select public.save_item($1,'event',$2,$3,$4)",[w,event.id,event.version,{description:'Intrusion'}]),/Workspace access/);
 assert.equal((await as(outsider,'select * from public.items where id=$1',[event.id])).rows.length,0);
});
test('calendar rejects invalid end times and guests outside the workspace',async()=>{
 const base={title:'Invalid event',starts_at:'2026-10-30T15:00:00Z'};
 for (const ends_at of ['2026-10-30T15:00:00Z','2026-10-30T14:00:00Z']) await assert.rejects(as(member,"select public.save_item($1,'event',null,0,$2)",[w,{...base,ends_at}]),/event_end_after_start/);
 await assert.rejects(as(member,"select public.save_item($1,'event',null,0,$2)",[w,{...base,event_guest_ids:[outsider]}]),/Guests must belong/);
 await assert.rejects(as(member,"select public.save_item($1,'event',null,0,$2)",[w,{...base,event_guest_ids:[null]}]),/Choose up to/);
 await assert.rejects(as(member,"select public.save_item($1,'task',null,0,$2)",[w,{title:'Bad task',event_guest_ids:[member]}]),/calendar_fields_only/);
});
test('removed members are removed from event guest lists without losing event notes',async()=>{
 let event=(await as(owner,"select * from public.save_item($1,'event',null,0,$2)",[w,{title:'Guest removal',starts_at:'2026-10-30T15:00:00Z',ends_at:'2026-10-30T16:00:00Z',event_guest_ids:[member],description:'Keep these notes'}])).rows[0];
 await as(owner,'select public.remove_access($1,$2,null)',[w,member]);
 const saved=(await as(owner,'select * from public.items where id=$1',[event.id])).rows[0];
 assert.deepEqual(saved.event_guest_ids,[]);assert.ok(saved.version>event.version);assert.equal(saved.description,'Keep these notes');
});

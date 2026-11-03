import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const owner='00000000-0000-4000-8000-000000000001',member='00000000-0000-4000-8000-000000000002',outsider='00000000-0000-4000-8000-000000000003';
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;insert into auth.users values('${owner}','owner@example.com',now()),('${member}','member@example.com',now()),('${outsider}','outsider@example.com',now());`);
const migrations=new URL('../supabase/migrations/',import.meta.url);
for(const name of (await readdir(migrations)).filter(f=>f.endsWith('.sql')&&f<'20261103192238').sort()) await db.exec(await readFile(new URL(name,migrations),'utf8'));
async function as(user,query,params=[]){return db.transaction(async tx=>{await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user]);await tx.exec('set local role authenticated');return tx.query(query,params);});}
const w=(await as(owner,"select public.create_workspace('Motion','Owner') as id")).rows[0].id;
const token=(await as(owner,'select public.get_workspace_invite($1) as token',[w])).rows[0].token;
await as(member,"select public.join_workspace($1,'Teammate')",[token]);
await as(owner,'select public.set_sponsorship_reviewer($1,$2)',[w,member]);
const legacy=(await as(owner,'select * from public.save_sponsorship($1,null,0,$2)',[w,{record_type:'project',athlete_name:'Existing request',proposal:'Keep original details'}])).rows[0];
await as(member,"select public.review_sponsorship($1,$2,'approved','Keep this decision')",[legacy.id,legacy.version]);
const athlete=(await as(owner,'select * from public.save_sponsorship($1,null,0,$2)',[w,{record_type:'athlete',athlete_name:'Existing athlete'}])).rows[0];
await db.exec(await readFile(new URL('20261103192238_request_approvers.sql',migrations),'utf8'));
let request;
test('per-request approver migration preserves existing decisions, details, notes and the athlete roster',async()=>{
 const saved=(await as(owner,'select * from public.sponsorships where id=$1',[legacy.id])).rows[0];
 assert.equal(saved.reviewer_id,member);assert.equal(saved.status,'approved');assert.equal(saved.proposal,'Keep original details');assert.equal(saved.decided_by,member);
 assert.equal((await as(owner,'select body from public.sponsorship_comments where sponsorship_id=$1',[legacy.id])).rows[0].body,'Keep this decision');
 const roster=(await as(owner,'select * from public.sponsorships where id=$1',[athlete.id])).rows[0];assert.equal(roster.reviewer_id,null);assert.equal(roster.status,'active');
});
test('every request type needs a workspace approver and refuses cross-workspace assignments',async()=>{
 for(const type of ['affiliate','person','athlete_proposal','project','other']) {
  await assert.rejects(as(owner,'select public.save_sponsorship($1,null,0,$2)',[w,{record_type:type,athlete_name:'Missing approver'}]),/Choose a teammate/);
  await assert.rejects(as(owner,'select public.save_sponsorship($1,null,0,$2)',[w,{record_type:type,athlete_name:'Wrong workspace',reviewer_id:outsider}]),/foreign key/);
  const saved=(await as(member,'select * from public.save_sponsorship($1,null,0,$2)',[w,{record_type:type,athlete_name:'Review this',reviewer_id:owner}])).rows[0];assert.equal(saved.reviewer_id,owner);assert.equal(saved.status,'pending');
 }
 await assert.rejects(as(owner,'select public.save_sponsorship($1,null,0,$2)',[w,{record_type:'athlete',athlete_name:'Invalid roster reviewer',reviewer_id:member}]),/roster_has_no_approver/);
});
test('each selected teammate decides their request independently of the old global reviewer setting',async()=>{
 request=(await as(member,'select * from public.save_sponsorship($1,null,0,$2)',[w,{record_type:'project',athlete_name:'Member requests owner',reviewer_id:owner}])).rows[0];
 await assert.rejects(as(member,"select public.review_sponsorship($1,$2,'approved','')",[request.id,request.version]),/selected sponsorship reviewer/);
 request=(await as(owner,"select * from public.review_sponsorship($1,$2,'approved','Approved by requested teammate')",[request.id,request.version])).rows[0];assert.equal(request.decided_by,owner);
 await assert.rejects(as(outsider,"select public.review_sponsorship($1,$2,'approved','')",[request.id,request.version]),/Workspace access/);
});
test('approvers add attributed notes without deciding or reopening a request',async()=>{
 const before=request;
 const note=(await as(owner,"select * from public.add_sponsorship_comment($1,'Please include a second camera')",[request.id])).rows[0];assert.equal(note.author_id,owner);assert.equal(note.action,'comment');
 request=(await as(member,'select * from public.sponsorships where id=$1',[request.id])).rows[0];assert.equal(request.status,'approved');assert.equal(request.version,before.version);assert.equal(request.decided_by,before.decided_by);
 await assert.rejects(as(outsider,"select public.add_sponsorship_comment($1,'Intrusion')",[request.id]),/Workspace access/);
});
test('requester can reassign; stale decisions and edits are rejected; all previous notes and decisions remain',async()=>{
 const previous=request;
 request=(await as(member,'select * from public.save_sponsorship($1,$2,$3,$4)',[w,request.id,request.version,{reviewer_id:member}])).rows[0];assert.equal(request.status,'pending');assert.equal(request.decided_by,null);assert.ok(request.version>previous.version);
 await assert.rejects(as(owner,"select public.review_sponsorship($1,$2,'approved','Old approver')",[request.id,request.version]),/selected sponsorship reviewer/);
 await assert.rejects(as(member,"select public.review_sponsorship($1,$2,'approved','Stale')",[request.id,previous.version]),/changed/);
 await assert.rejects(as(member,'select public.save_sponsorship($1,$2,$3,$4)',[w,request.id,previous.version,{reviewer_id:owner}]),/changed/);
 const history=(await as(member,'select * from public.sponsorship_comments where sponsorship_id=$1',[request.id])).rows;assert.equal(history.length,3);assert.ok(history.some(c=>c.body==='Approver changed. A new decision is needed.'));assert.ok(history.some(c=>c.action==='approved'));assert.ok(history.some(c=>c.action==='comment'));
 request=(await as(member,"select * from public.review_sponsorship($1,$2,'denied','New reviewer decision')",[request.id,request.version])).rows[0];assert.equal(request.decided_by,member);
});
test('an approver cannot redirect another person’s request; owner can reassign and cannot remove its approver',async()=>{
 let saved=(await as(owner,'select * from public.save_sponsorship($1,null,0,$2)',[w,{record_type:'other',athlete_name:'Owner requests member',reviewer_id:member}])).rows[0];
 await assert.rejects(as(member,'select public.save_sponsorship($1,$2,$3,$4)',[w,saved.id,saved.version,{reviewer_id:owner}]),/Only the requester or workspace owner/);
 await assert.rejects(as(owner,'select public.save_sponsorship($1,$2,$3,$4)',[w,saved.id,saved.version,{reviewer_id:null}]),/Choose a teammate/);
 saved=(await as(owner,'select * from public.save_sponsorship($1,$2,$3,$4)',[w,saved.id,saved.version,{reviewer_id:owner}])).rows[0];assert.equal(saved.reviewer_id,owner);
 await assert.rejects(as(member,'update public.sponsorships set reviewer_id=$1 where id=$2',[member,saved.id]),/permission denied/);
});
test('removing an approver preserves requests and history while immediately revoking notes and decisions',async()=>{
 await as(owner,'select public.remove_access($1,$2,null)',[w,member]);
 const saved=(await as(owner,'select * from public.sponsorships where id=$1',[request.id])).rows[0];assert.equal(saved.reviewer_id,null);assert.equal(saved.status,'denied');
 assert.ok((await as(owner,'select * from public.sponsorship_comments where sponsorship_id=$1',[request.id])).rows.length>0);
 await assert.rejects(as(member,"select public.review_sponsorship($1,$2,'approved','')",[request.id,request.version]),/Workspace access/);
 await assert.rejects(as(member,"select public.add_sponsorship_comment($1,'Removed')",[request.id]),/Workspace access/);
 const reassigned=(await as(owner,'select * from public.save_sponsorship($1,$2,$3,$4)',[w,saved.id,saved.version,{reviewer_id:owner}])).rows[0];assert.equal(reassigned.status,'pending');
});

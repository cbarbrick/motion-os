import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('roster migration preserves athlete content, event links and decision history',async()=>{
 const db=new PGlite();
 try {
  const owner='00000000-0000-4000-8000-000000000001';
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;insert into auth.users values('${owner}','owner@example.test',now());`);
  const dir=new URL('../supabase/migrations/',import.meta.url);
  const names=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
  const target=names.find(n=>n.endsWith('_athlete_roster_and_affiliates.sql'));
  for(const name of names.slice(0,names.indexOf(target))) await db.exec(await readFile(new URL(name,dir),'utf8'));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  const w=(await db.query("select public.create_workspace('Migration fixture','Owner') as id")).rows[0].id;
  await db.query('select public.set_sponsorship_reviewer($1,$2)',[w,owner]);
  let a=(await db.query('select * from public.save_sponsorship($1,null,0,$2)',[w,{athlete_name:'Existing athlete',deliverables:'Existing video brief',contact:'Existing contact'}])).rows[0];
  a=(await db.query("select * from public.review_sponsorship($1,$2,'approved','Prior decision')",[a.id,a.version])).rows[0];
  const e=(await db.query("select * from public.save_item($1,'event',null,0,$2)",[w,{title:'Existing fight',starts_at:'2026-11-15T23:00:00Z',athlete_id:a.id,event_type:'fight',content_needs:'Existing content notes'}])).rows[0];
  await db.exec(await readFile(new URL(target,dir),'utf8'));
  const migrated=(await db.query('select * from public.sponsorships where id=$1',[a.id])).rows[0];
  assert.equal(migrated.status,'active');assert.equal(migrated.version,a.version+1);assert.equal(migrated.decided_at,null);assert.equal(migrated.decided_by,null);assert.equal(migrated.deliverables,a.deliverables);assert.equal(migrated.contact,a.contact);
  const event=(await db.query('select * from public.items where id=$1',[e.id])).rows[0];
  assert.equal(event.athlete_id,a.id);assert.equal(event.content_needs,e.content_needs);
  assert.equal((await db.query('select body from public.sponsorship_comments where sponsorship_id=$1',[a.id])).rows[0].body,'Prior decision');
  await assert.rejects(db.query('select public.save_sponsorship($1,$2,$3,$4)',[w,a.id,a.version,{sport:'Stale edit'}]),/changed/);
 } finally { await db.close(); }
});

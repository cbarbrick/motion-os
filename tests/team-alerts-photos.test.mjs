import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const db = new PGlite();
const owner=randomUUID(),member=randomUUID(),teammate=randomUUID(),outsider=randomUUID();
await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 grant execute on function auth.uid() to authenticated;
 create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated;
 grant select,insert,update,delete on storage.objects to authenticated;
`);
for(const [id,name] of [[owner,'Owner'],[member,'Member'],[teammate,'Teammate'],[outsider,'Outsider']])
 await db.query('insert into auth.users values($1,$2,now())',[id,`${name.toLowerCase()}@example.com`]);
const migrations=new URL('../supabase/migrations/',import.meta.url);
for(const name of (await readdir(migrations)).filter(f=>f.endsWith('.sql')).sort())
 await db.exec(await readFile(new URL(name,migrations),'utf8'));
async function as(user,query,params=[]){return db.transaction(async tx=>{
 await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
 await tx.exec('set local role authenticated');return tx.query(query,params);
});}
const w=(await as(owner,"select public.create_workspace('Photo team','Owner') as id")).rows[0].id;
const token=(await as(owner,'select public.get_workspace_invite($1) as token',[w])).rows[0].token;
await as(member,"select public.join_workspace($1,'Member')",[token]);
await as(teammate,"select public.join_workspace($1,'Teammate')",[token]);
const other=(await as(outsider,"select public.create_workspace('Other','Outsider') as id")).rows[0].id;
async function save(user,kind,fields,previous=null,workspace=w){
 return (await as(user,'select * from public.save_item($1,$2,$3,$4,$5)',[workspace,kind,previous?.id||null,previous?.version||0,fields])).rows[0];
}
const notices=async(user,item)=>(await as(user,'select * from public.notifications where item_id=$1 order by created_at',[item.id])).rows;
async function checkBroadcast(item,kind){
 for(const user of [member,teammate]){
  const rows=await notices(user,item);assert.equal(rows.length,1);assert.equal(rows[0].kind,kind);assert.equal(rows[0].actor_id,owner);
 }
 assert.equal((await notices(owner,item)).length,0);assert.equal((await notices(outsider,item)).length,0);
}

test('new calendar events alert all other members once; edits stay quiet',async()=>{
 let event=await save(owner,'event',{title:'Calendar test',starts_at:'2026-11-05T12:00:00Z',ends_at:'2026-11-05T13:00:00Z'});
 await checkBroadcast(event,'event_added');
 event=await save(owner,'event',{title:'Calendar test revised'},event);
 await checkBroadcast(event,'event_added');
});
test('deliverables alert the team and deduplicate assignment notifications',async()=>{
 for(const fields of [{week_of:'2026-11-02'},{due_date:'2026-11-06'},{category:'Content'}]){
  let item=await save(owner,'task',{title:'New deliverable',assignee_id:member,collaborator_ids:[teammate],...fields});
  await checkBroadcast(item,'deliverable_added');
  item=await save(owner,'task',{description:'A normal edit'},item);
  await checkBroadcast(item,'deliverable_added');
 }
 let item=await save(owner,'task',{title:'Work gets scheduled',assignee_id:owner});
 assert.equal((await notices(member,item)).length,0);
 item=await save(owner,'task',{week_of:'2026-11-02'},item);
 await checkBroadcast(item,'deliverable_added');
});
test('available tasks alert everyone; claiming and ordinary edits do not repeat alerts',async()=>{
 let item=await save(owner,'task',{title:'Anyone can take this'});
 await checkBroadcast(item,'task_available');
 item=(await as(member,'select * from public.claim_task($1)',[item.id])).rows[0];
 await checkBroadcast(item,'task_available');
 item=await save(owner,'task',{assignee_id:null,status:'open'},item);
 assert.deepEqual((await notices(member,item)).map(n=>n.kind),['task_available','task_available']);
 item=await save(owner,'task',{status:'done',assignee_id:owner},item);
 item=await save(owner,'task',{status:'open',assignee_id:null},item);
 assert.equal((await notices(member,item)).length,3);
});
test('private todos never broadcast',async()=>{
 const todo=await save(owner,'todo',{title:'Private',due_date:'2026-11-06'});
 assert.equal((await notices(member,todo)).length,0);
});

const task=await save(owner,'task',{title:'Photo attachment test'});
const todo=await save(member,'todo',{title:'Private photo test'});
async function reserve(user,item,id=randomUUID()){
 return (await as(user,"select * from public.prepare_item_photo($1,'test.jpg',$2)",[item.id,id])).rows[0];
}
async function put(user,photo){await as(user,"insert into storage.objects(bucket_id,name) values('motion-item-photos',$1)",[photo.object_path]);}
async function finish(user,photo){return (await as(user,'select * from public.complete_item_photo($1)',[photo.id])).rows[0];}
async function objects(user,photo){return (await as(user,'select * from storage.objects where name=$1',[photo.object_path])).rows;}
let sharedPhoto,privatePhoto;
test('photo bucket is private, JPEG-only and bounded',async()=>{
 const bucket=(await db.query('select * from storage.buckets')).rows[0];
 assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),3145728);assert.deepEqual(bucket.allowed_mime_types,['image/jpeg']);
});
test('only a current member can reserve a task photo; metadata cannot be forged',async()=>{
 await assert.rejects(reserve(outsider,task),/Item access/);
 await assert.rejects(as(member,"insert into public.item_photos(workspace_id,item_id,filename,object_path) values($1,$2,'fake.jpg','fake')",[w,task.id]),/permission denied/);
 const foreignTask=await save(outsider,'task',{title:'Other workspace'},null,other);
 await assert.rejects(reserve(owner,foreignTask),/Item access/);
 sharedPhoto=await reserve(member,task);
 assert.equal((await as(owner,'select * from public.item_photos where id=$1',[sharedPhoto.id])).rows.length,1);
 assert.equal((await as(outsider,'select * from public.item_photos where id=$1',[sharedPhoto.id])).rows.length,0);
});
test('upload requires an owned reservation; completion requires a real object',async()=>{
 await assert.rejects(as(member,"insert into storage.objects(bucket_id,name) values('motion-item-photos','arbitrary.jpg')"),/row-level security/);
 await assert.rejects(put(owner,sharedPhoto),/row-level security/);
 await assert.rejects(finish(member,sharedPhoto),/not complete/);
 await put(member,sharedPhoto);
 assert.equal((await objects(member,sharedPhoto)).length,0);
 await assert.rejects(finish(owner,sharedPhoto),/Photo access/);
 sharedPhoto=await finish(member,sharedPhoto);
 assert.equal(sharedPhoto.ready,true);
 assert.equal((await objects(owner,sharedPhoto)).length,1);
 assert.equal((await objects(teammate,sharedPhoto)).length,1);
 assert.equal((await objects(outsider,sharedPhoto)).length,0);
 // Storage has no UPDATE policy, so a saved photo cannot be overwritten.
 assert.equal((await as(member,'update storage.objects set name=$1 where name=$2 returning *',['forged',sharedPhoto.object_path])).rows.length,0);
});
test('retries reuse one reservation and cannot steal another uploader’s ID',async()=>{
 assert.equal((await reserve(member,task,sharedPhoto.id)).id,sharedPhoto.id);
 assert.equal((await finish(member,sharedPhoto)).id,sharedPhoto.id);
 await assert.rejects(reserve(owner,task,sharedPhoto.id),/Photo access/);
 const retry=await reserve(member,task);
 await as(member,'select public.set_item_photo_removed($1,true)',[retry.id]);
 const resumed=await reserve(member,task,retry.id);assert.equal(resumed.removed_at,null);
 await put(member,resumed);await finish(member,resumed);
 assert.equal(Number((await db.query('select count(*) from public.item_photos where id=$1',[retry.id])).rows[0].count),1);
});
test('private todo photos are inaccessible even to the workspace owner',async()=>{
 privatePhoto=await reserve(member,todo);await put(member,privatePhoto);await finish(member,privatePhoto);
 for(const user of [owner,teammate,outsider]){
  assert.equal((await as(user,'select * from public.item_photos where id=$1',[privatePhoto.id])).rows.length,0);
  assert.equal((await objects(user,privatePhoto)).length,0);
  await assert.rejects(reserve(user,todo),/Item access/);
  await assert.rejects(as(user,'select public.set_item_photo_removed($1,true)',[privatePhoto.id]),/Item access/);
 }
 assert.equal((await objects(member,privatePhoto)).length,1);
});
test('remove hides the binary and undo restores it without a new upload',async()=>{
 await as(owner,'select public.set_item_photo_removed($1,true)',[sharedPhoto.id]);
 assert.equal((await objects(member,sharedPhoto)).length,0);
 await as(teammate,'select public.set_item_photo_removed($1,false)',[sharedPhoto.id]);
 assert.equal((await objects(member,sharedPhoto)).length,1);
});
test('the photo limit also applies to restoring or retrying old reservations',async()=>{
 const bounded=await save(owner,'todo',{title:'Bounded photo test'});
 const removed=await reserve(owner,bounded);
 await as(owner,'select public.set_item_photo_removed($1,true)',[removed.id]);
 for(let n=0;n<20;n++) await reserve(owner,bounded);
 await assert.rejects(reserve(owner,bounded),/20 photos/);
 await assert.rejects(reserve(owner,bounded,removed.id),/20 photos/);
 await assert.rejects(as(owner,'select public.set_item_photo_removed($1,false)',[removed.id]),/20 photos/);
});
test('membership revocation immediately blocks metadata, binary reads and uploads',async()=>{
 const pending=await reserve(teammate,task);
 await as(owner,'select public.remove_access($1,$2,null)',[w,teammate]);
 assert.equal((await as(teammate,'select * from public.item_photos where item_id=$1',[task.id])).rows.length,0);
 assert.equal((await objects(teammate,sharedPhoto)).length,0);
 await assert.rejects(put(teammate,pending),/row-level security/);
 await assert.rejects(reserve(teammate,task),/Item access/);
 assert.equal((await notices(teammate,task)).length,0);
});
test.after(()=>db.close());

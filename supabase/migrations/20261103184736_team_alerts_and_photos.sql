-- Team alerts share the existing recipient-only inbox and atomic item writes.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
 check(kind in ('task_added','event_added','deliverable_added','task_available'));
drop trigger notify_task_people on public.items;
create or replace function motion_private.notify_task_people() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous_people uuid[] := '{}'; people uuid[]; actor text; broadcast_kind text;
 old_deliverable boolean := false; new_deliverable boolean;
begin
 if new.kind not in ('task','event') or auth.uid() is null then return new; end if;
 select name into actor from public.members where workspace_id=new.workspace_id and user_id=auth.uid();
 if not found then return new; end if;
 people := array_remove(new.collaborator_ids || array[new.assignee_id],null);
 if tg_op='UPDATE' then
  previous_people := array_remove(old.collaborator_ids || array[old.assignee_id],null);
  old_deliverable := old.week_of is not null or old.due_date is not null or old.category='Content' or old.event_id is not null;
 end if;
 new_deliverable := new.week_of is not null or new.due_date is not null or new.category='Content' or new.event_id is not null;
 if new.kind='event' and tg_op='INSERT' then broadcast_kind := 'event_added';
 elsif new.kind='task' and new.status<>'done' then
  if new_deliverable and (tg_op='INSERT' or not old_deliverable) then broadcast_kind := 'deliverable_added';
  elsif cardinality(people)=0 and (tg_op='INSERT' or cardinality(previous_people)>0 or old.status='done') then broadcast_kind := 'task_available';
  end if;
 end if;
 insert into public.notifications(workspace_id,recipient_id,actor_id,actor_name,item_id,item_version,task_title,kind)
 select new.workspace_id,m.user_id,auth.uid(),actor,new.id,new.version,new.title,
  coalesce(broadcast_kind,'task_added')
 from public.members m
 where m.workspace_id=new.workspace_id and m.user_id<>auth.uid()
 and (broadcast_kind is not null or (new.kind='task' and m.user_id=any(people) and not(m.user_id=any(previous_people))))
 on conflict(item_id,item_version,recipient_id) do nothing;
 return new;
end; $$;
create trigger notify_task_people after insert or update on public.items
 for each row execute function motion_private.notify_task_people();
revoke execute on function motion_private.notify_task_people() from public,anon,authenticated;

-- Metadata writes use authorized RPCs. Binary uploads use private Storage RLS.
create table public.item_photos (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null,
 item_id uuid not null,
 uploader_id uuid references auth.users(id) on delete set null,
 filename text not null check(length(filename) between 1 and 180),
 object_path text not null unique,
 ready boolean not null default false,
 removed_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,item_id) references public.items(workspace_id,id) on delete cascade
);
create index item_photos_item on public.item_photos(workspace_id,item_id);
create index item_photos_uploader on public.item_photos(uploader_id);
alter table public.item_photos enable row level security;
revoke all on public.item_photos from public,anon,authenticated;
grant select on public.item_photos to authenticated;
create policy item_photos_read on public.item_photos for select to authenticated using(
 exists(select 1 from public.items i where i.id=item_id and i.workspace_id=item_photos.workspace_id
 and i.kind in ('task','todo') and public.can_read_item(i.workspace_id,i.kind,i.created_by))
);

create function public.prepare_item_photo(p_item uuid,p_filename text,p_photo uuid) returns public.item_photos
language plpgsql security definer set search_path='' as $$
declare i public.items; r public.item_photos;
begin
 select * into i from public.items where id=p_item for update;
 if auth.uid() is null or not found or not public.can_read_item(i.workspace_id,i.kind,i.created_by) then raise exception 'Item access required'; end if;
 if i.kind not in ('task','todo') then raise exception 'Photos belong to tasks, deliverables or to-dos'; end if;
 if p_filename is null or length(btrim(p_filename)) not between 1 and 180 then raise exception 'Choose a photo filename'; end if;
 if p_photo is null then raise exception 'Choose a photo'; end if;
 select * into r from public.item_photos where id=p_photo;
 if found then
  if r.item_id<>i.id or r.uploader_id is distinct from auth.uid() then raise exception 'Photo access required'; end if;
  if not r.ready then
   if (select count(*) from public.item_photos where item_id=i.id and id<>r.id and removed_at is null and (ready or created_at>now()-interval '1 hour'))>=20 then raise exception 'Up to 20 photos per item'; end if;
   update public.item_photos set removed_at=null,created_at=now() where id=r.id returning * into r;
  end if;
  return r;
 end if;
 if (select count(*) from public.item_photos where item_id=i.id and removed_at is null and (ready or created_at>now()-interval '1 hour'))>=20 then raise exception 'Up to 20 photos per item'; end if;
 insert into public.item_photos(id,workspace_id,item_id,uploader_id,filename,object_path)
 values(p_photo,i.workspace_id,i.id,auth.uid(),btrim(p_filename),i.workspace_id||'/'||i.id||'/'||p_photo||'.jpg') returning * into r;
 return r;
end; $$;

create function public.complete_item_photo(p_id uuid) returns public.item_photos
language plpgsql security definer set search_path='' as $$
declare r public.item_photos; i public.items;
begin
 select * into r from public.item_photos where id=p_id for update;
 if auth.uid() is null or not found or r.uploader_id is distinct from auth.uid() then raise exception 'Photo access required'; end if;
 select * into i from public.items where id=r.item_id;
 if not public.can_read_item(i.workspace_id,i.kind,i.created_by) then raise exception 'Item access required'; end if;
 if r.removed_at is not null then raise exception 'Photo was removed'; end if;
 if not exists(select 1 from storage.objects where bucket_id='motion-item-photos' and name=r.object_path) then raise exception 'Photo upload is not complete'; end if;
 update public.item_photos set ready=true where id=p_id returning * into r;
 return r;
end; $$;

create function public.set_item_photo_removed(p_id uuid,p_removed boolean) returns void
language plpgsql security definer set search_path='' as $$
declare r public.item_photos; i public.items;
begin
 select * into r from public.item_photos where id=p_id;
 if auth.uid() is null or not found then raise exception 'Photo access required'; end if;
 select * into i from public.items where id=r.item_id for update;
 if not public.can_read_item(i.workspace_id,i.kind,i.created_by) then raise exception 'Item access required'; end if;
 if p_removed is null then raise exception 'Choose remove or restore'; end if;
 if not p_removed and (select count(*) from public.item_photos where item_id=i.id and id<>r.id and removed_at is null and (ready or created_at>now()-interval '1 hour'))>=20 then raise exception 'Up to 20 photos per item'; end if;
 update public.item_photos set removed_at=case when p_removed then now() else null end where id=p_id;
end; $$;
revoke execute on function public.prepare_item_photo(uuid,text,uuid),public.complete_item_photo(uuid),public.set_item_photo_removed(uuid,boolean) from public,anon;
grant execute on function public.prepare_item_photo(uuid,text,uuid),public.complete_item_photo(uuid),public.set_item_photo_removed(uuid,boolean) to authenticated;

-- PGlite fixtures without Storage still exercise workspace and notification SQL.
do $$ begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('motion-item-photos','motion-item-photos',false,3145728,array['image/jpeg']);
  create policy motion_photo_upload on storage.objects for insert to authenticated with check(
   bucket_id='motion-item-photos' and exists(
    select 1 from public.item_photos p where p.object_path=name and p.uploader_id=(select auth.uid())
    and not p.ready and p.removed_at is null and p.created_at>now()-interval '1 hour'
   )
  );
  create policy motion_photo_read on storage.objects for select to authenticated using(
   bucket_id='motion-item-photos' and exists(
    select 1 from public.item_photos p where p.object_path=name and p.ready and p.removed_at is null
   )
  );
 end if;
end $$;

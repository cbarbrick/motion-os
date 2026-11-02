-- Task collaborators and recipient-only in-app notifications.
alter table public.items add column collaborator_ids uuid[] not null default '{}';
alter table public.items add constraint task_collaborators_only check(kind='task' or cardinality(collaborator_ids)=0);
alter table public.items add constraint items_workspace_id_unique unique(workspace_id,id);
create index items_collaborators on public.items using gin(collaborator_ids) where kind='task';

create table public.notifications (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null,
 recipient_id uuid not null,
 actor_id uuid references auth.users(id) on delete set null,
 actor_name text not null,
 item_id uuid not null,
 item_version integer not null,
 task_title text not null,
 kind text not null default 'task_added' check(kind='task_added'),
 created_at timestamptz not null default now(),
 read_at timestamptz,
 foreign key(workspace_id,recipient_id) references public.members(workspace_id,user_id) on delete cascade,
 foreign key(workspace_id,item_id) references public.items(workspace_id,id) on delete cascade,
 unique(item_id,item_version,recipient_id)
);
create index notifications_inbox on public.notifications(recipient_id,workspace_id,created_at desc);
create index notifications_member on public.notifications(workspace_id,recipient_id);
create index notifications_item on public.notifications(workspace_id,item_id);
create index notifications_actor on public.notifications(actor_id);
alter table public.notifications enable row level security;
revoke all on public.notifications from public,anon,authenticated;
grant select on public.notifications to authenticated;
create policy notifications_read on public.notifications for select to authenticated
 using(recipient_id=(select auth.uid()) and public.member_role(workspace_id) is not null);

create schema if not exists motion_private;
revoke all on schema motion_private from public,anon,authenticated;
create function motion_private.validate_task_people() returns trigger
language plpgsql security definer set search_path='' as $$
declare person uuid;
begin
 if new.collaborator_ids is null or array_position(new.collaborator_ids,null) is not null or cardinality(new.collaborator_ids)>100 then
  raise exception 'Choose up to 100 task members';
 end if;
 new.collaborator_ids:=array(select distinct x from unnest(new.collaborator_ids) x order by x);
 foreach person in array new.collaborator_ids loop
  perform 1 from public.members where workspace_id=new.workspace_id and user_id=person for key share;
  if not found then raise exception 'Task members must belong to this workspace'; end if;
 end loop;
 return new;
end; $$;
create trigger validate_task_people before insert or update of collaborator_ids on public.items
 for each row execute function motion_private.validate_task_people();

create function motion_private.notify_task_people() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous_people uuid[]:='{}'; actor text;
begin
 if new.kind<>'task' or auth.uid() is null then return new; end if;
 if tg_op='UPDATE' then previous_people:=array_remove(old.collaborator_ids || array[old.assignee_id],null); end if;
 select name into actor from public.members where workspace_id=new.workspace_id and user_id=auth.uid();
 if not found then return new; end if;
 insert into public.notifications(workspace_id,recipient_id,actor_id,actor_name,item_id,item_version,task_title)
 select new.workspace_id,person,auth.uid(),actor,new.id,new.version,new.title
 from (select distinct unnest(array_remove(new.collaborator_ids || array[new.assignee_id],null)) person) people
 where person<>auth.uid() and not(person=any(previous_people))
 on conflict(item_id,item_version,recipient_id) do nothing;
 return new;
end; $$;
create trigger notify_task_people after insert or update of assignee_id,collaborator_ids on public.items
 for each row execute function motion_private.notify_task_people();

create function motion_private.remove_task_member() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.items set collaborator_ids=array_remove(collaborator_ids,old.user_id),version=version+1,updated_at=now()
 where workspace_id=old.workspace_id and kind='task' and old.user_id=any(collaborator_ids);
 return old;
end; $$;
create trigger remove_task_member before delete on public.members for each row execute function motion_private.remove_task_member();
revoke execute on function motion_private.validate_task_people(),motion_private.notify_task_people(),motion_private.remove_task_member() from public,anon,authenticated;

create function public.read_notifications(p_workspace uuid,p_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.member_role(p_workspace) is null then raise exception 'Workspace access required'; end if;
 if p_id is not null and not exists(select 1 from public.notifications where id=p_id and workspace_id=p_workspace and recipient_id=auth.uid()) then
  raise exception 'Notification not found';
 end if;
 update public.notifications set read_at=now()
 where workspace_id=p_workspace and recipient_id=auth.uid() and read_at is null and (p_id is null or id=p_id);
end; $$;
revoke execute on function public.read_notifications(uuid,uuid) from public,anon;
grant execute on function public.read_notifications(uuid,uuid) to authenticated;

-- Local test databases do not have a Realtime publication.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.notifications;
 end if;
end; $$;

create or replace function public.save_item(p_workspace uuid,p_kind text,p_id uuid,p_version integer,p_data jsonb) returns public.items language plpgsql security definer set search_path='' as $$
declare r public.items; old public.items; role_name text; is_new boolean;
begin
 role_name:=public.member_role(p_workspace);
 if role_name is null then raise exception 'Workspace access required'; end if;
 if p_kind not in ('task','event','idea','todo') then raise exception 'Invalid item type'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or p_data - array['title','description','status','priority','category','assignee_id','event_id','due_date','week_of','starts_at','location','definition_done','delivery_url','delivery_notes','athlete_id','event_type','content_needs','collaborator_ids'] <> '{}'::jsonb then raise exception 'Unknown fields'; end if;
 is_new:=p_id is null;
 if not is_new then
  select * into old from public.items where id=p_id and workspace_id=p_workspace and kind=p_kind for update;
  if not found then raise exception 'Item not found'; end if;
  if old.version is distinct from p_version then raise exception 'This item changed. Reload before saving.'; end if;
  if p_kind='todo' and old.created_by<>auth.uid() then raise exception 'Private to-do'; end if;
 else
  old.id:=gen_random_uuid(); old.workspace_id:=p_workspace; old.kind:=p_kind; old.created_by:=auth.uid(); old.created_at:=now(); old.version:=0;
  old.status:=case p_kind when 'idea' then 'inbox' when 'event' then 'planned' else 'open' end;
  old.description:='';old.priority:='normal';old.category:='Operations';old.location:='';old.definition_done:='';old.delivery_url:='';old.delivery_notes:='';old.event_type:='event';old.content_needs:='';old.collaborator_ids:='{}';
 end if;
 r:=jsonb_populate_record(old,p_data);
 r.title:=btrim(r.title); r.updated_at:=now();r.version:=old.version+1;
 if p_kind='todo' then r.assignee_id:=auth.uid(); r.event_id:=null; end if;
 if p_kind='task' and r.status='doing' and r.assignee_id is null then raise exception 'Assign an owner first'; end if;
 if r.event_id is not null and not exists(select 1 from public.items where id=r.event_id and workspace_id=p_workspace and kind='event') then raise exception 'Event must belong to this workspace'; end if;
 if r.athlete_id is not null and not exists(select 1 from public.sponsorships where id=r.athlete_id and workspace_id=p_workspace and record_type='athlete') then raise exception 'Choose an athlete in this workspace'; end if;
 if is_new then
  insert into public.items select r.* returning * into r;
 else
  update public.items set title=r.title,description=r.description,status=r.status,priority=r.priority,category=r.category,assignee_id=r.assignee_id,event_id=r.event_id,due_date=r.due_date,week_of=r.week_of,starts_at=r.starts_at,location=r.location,definition_done=r.definition_done,delivery_url=r.delivery_url,delivery_notes=r.delivery_notes,athlete_id=r.athlete_id,event_type=r.event_type,content_needs=r.content_needs,collaborator_ids=r.collaborator_ids,version=r.version,updated_at=r.updated_at where id=r.id returning * into r;
 end if;
 if p_kind<>'todo' then insert into public.activity(workspace_id,actor_id,title) values(p_workspace,auth.uid(),case when is_new then 'Created ' else 'Updated ' end || r.title); end if;
 return r;
end; $$;


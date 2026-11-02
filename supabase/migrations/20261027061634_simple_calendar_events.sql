-- Calendar dates and workspace guests. Existing events keep their dates and notes.
alter table public.items
 add column ends_at timestamptz,
 add column all_day boolean not null default false,
 add column event_guest_ids uuid[] not null default '{}';
alter table public.items add constraint event_end_after_start check(ends_at is null or (kind='event' and ends_at>starts_at));
alter table public.items add constraint calendar_fields_only check(kind='event' or (not all_day and cardinality(event_guest_ids)=0));
create function motion_private.validate_event_guests() returns trigger
language plpgsql security definer set search_path='' as $$
declare person uuid;
begin
 if new.event_guest_ids is null or array_position(new.event_guest_ids,null) is not null or cardinality(new.event_guest_ids)>100 then
  raise exception 'Choose up to 100 guests';
 end if;
 new.event_guest_ids:=array(select distinct x from unnest(new.event_guest_ids) x order by x);
 foreach person in array new.event_guest_ids loop
  perform 1 from public.members where workspace_id=new.workspace_id and user_id=person for key share;
  if not found then raise exception 'Guests must belong to this workspace'; end if;
 end loop;
 return new;
end; $$;
create trigger validate_event_guests before insert or update of event_guest_ids on public.items
 for each row execute function motion_private.validate_event_guests();
create function motion_private.remove_event_guest() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.items set event_guest_ids=array_remove(event_guest_ids,old.user_id),version=version+1,updated_at=now()
 where workspace_id=old.workspace_id and kind='event' and old.user_id=any(event_guest_ids);
 return old;
end; $$;
create trigger remove_event_guest before delete on public.members for each row execute function motion_private.remove_event_guest();
revoke execute on function motion_private.validate_event_guests(),motion_private.remove_event_guest() from public,anon,authenticated;

create or replace function public.save_item(p_workspace uuid,p_kind text,p_id uuid,p_version integer,p_data jsonb) returns public.items language plpgsql security definer set search_path='' as $$
declare r public.items; old public.items; role_name text; is_new boolean;
begin
 role_name:=public.member_role(p_workspace);
 if role_name is null then raise exception 'Workspace access required'; end if;
 if p_kind not in ('task','event','idea','todo') then raise exception 'Invalid item type'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or p_data - array['title','description','status','priority','category','assignee_id','event_id','due_date','week_of','starts_at','location','definition_done','delivery_url','delivery_notes','athlete_id','event_type','content_needs','collaborator_ids','ends_at','all_day','event_guest_ids'] <> '{}'::jsonb then raise exception 'Unknown fields'; end if;
 is_new:=p_id is null;
 if not is_new then
  select * into old from public.items where id=p_id and workspace_id=p_workspace and kind=p_kind for update;
  if not found then raise exception 'Item not found'; end if;
  if old.version is distinct from p_version then raise exception 'This item changed. Reload before saving.'; end if;
  if p_kind='todo' and old.created_by<>auth.uid() then raise exception 'Private to-do'; end if;
 else
  old.id:=gen_random_uuid(); old.workspace_id:=p_workspace; old.kind:=p_kind; old.created_by:=auth.uid(); old.created_at:=now(); old.version:=0;
  old.status:=case p_kind when 'idea' then 'inbox' when 'event' then 'planned' else 'open' end;
  old.description:='';old.priority:='normal';old.category:='Operations';old.location:='';old.definition_done:='';old.delivery_url:='';old.delivery_notes:='';old.event_type:='event';old.content_needs:='';old.collaborator_ids:='{}';old.all_day:=false;old.event_guest_ids:='{}';
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
  update public.items set title=r.title,description=r.description,status=r.status,priority=r.priority,category=r.category,assignee_id=r.assignee_id,event_id=r.event_id,due_date=r.due_date,week_of=r.week_of,starts_at=r.starts_at,location=r.location,definition_done=r.definition_done,delivery_url=r.delivery_url,delivery_notes=r.delivery_notes,athlete_id=r.athlete_id,event_type=r.event_type,content_needs=r.content_needs,collaborator_ids=r.collaborator_ids,ends_at=r.ends_at,all_day=r.all_day,event_guest_ids=r.event_guest_ids,version=r.version,updated_at=r.updated_at where id=r.id returning * into r;
 end if;
 if p_kind<>'todo' then insert into public.activity(workspace_id,actor_id,title) values(p_workspace,auth.uid(),case when is_new then 'Created ' else 'Updated ' end || r.title); end if;
 return r;
end; $$;


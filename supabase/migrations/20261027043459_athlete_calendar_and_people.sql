-- Extend the shared review workflow and link athlete events to the calendar.
alter table public.sponsorships add column record_type text not null default 'athlete' check(record_type in ('athlete','person'));
alter table public.sponsorships add column rate text not null default '' check(length(rate)<=300);
alter table public.items add column athlete_id uuid;
alter table public.items add column event_type text not null default 'event' check(event_type in ('event','fight'));
alter table public.items add column content_needs text not null default '' check(length(content_needs)<=10000);
alter table public.items add constraint items_athlete_workspace foreign key(workspace_id,athlete_id) references public.sponsorships(workspace_id,id);
alter table public.items add constraint athlete_fields_are_event_only check(kind='event' or (athlete_id is null and event_type='event' and content_needs=''));
create index items_athlete_calendar on public.items(workspace_id,athlete_id,starts_at) where kind='event';
create or replace function public.save_sponsorship(p_workspace uuid,p_id uuid,p_version integer,p_data jsonb) returns public.sponsorships
language plpgsql security definer set search_path='' as $$
declare r public.sponsorships; old public.sponsorships;
begin
 if public.member_role(p_workspace) is null then raise exception 'Workspace access required'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or p_data - array['athlete_name','sport','profile_url','contact','audience','proposal','requested_support','deliverables','timing','record_type','rate'] <> '{}'::jsonb then raise exception 'Unknown proposal fields'; end if;
 if p_id is null then
  insert into public.sponsorships(workspace_id,athlete_name,sport,profile_url,contact,audience,proposal,requested_support,deliverables,timing,record_type,rate,created_by)
  values(p_workspace,btrim(p_data->>'athlete_name'),coalesce(p_data->>'sport',''),coalesce(p_data->>'profile_url',''),coalesce(p_data->>'contact',''),coalesce(p_data->>'audience',''),coalesce(p_data->>'proposal',''),coalesce(p_data->>'requested_support',''),coalesce(p_data->>'deliverables',''),coalesce(p_data->>'timing',''),coalesce(p_data->>'record_type','athlete'),coalesce(p_data->>'rate',''),auth.uid()) returning * into r;
 else
  select * into old from public.sponsorships where workspace_id=p_workspace and id=p_id for update;
  if not found then raise exception 'Proposal not found'; end if;
  if old.version is distinct from p_version then raise exception 'This proposal changed. Reload before saving.'; end if;
  r:=jsonb_populate_record(old,p_data); r.athlete_name:=btrim(r.athlete_name);
  if r.record_type is distinct from old.record_type then raise exception 'Record type cannot change'; end if;
  if row(r.athlete_name,r.sport,r.profile_url,r.contact,r.audience,r.proposal,r.requested_support,r.deliverables,r.timing,r.record_type,r.rate) is not distinct from row(old.athlete_name,old.sport,old.profile_url,old.contact,old.audience,old.proposal,old.requested_support,old.deliverables,old.timing,old.record_type,old.rate) then return old; end if;
  update public.sponsorships set athlete_name=r.athlete_name,sport=r.sport,profile_url=r.profile_url,contact=r.contact,audience=r.audience,proposal=r.proposal,requested_support=r.requested_support,deliverables=r.deliverables,timing=r.timing,rate=r.rate,status='pending',decided_by=null,decided_at=null,version=old.version+1,updated_at=now() where id=old.id returning * into r;
  if old.status<>'pending' then
   insert into public.sponsorship_comments(workspace_id,sponsorship_id,author_id,author_name,body,action)
   select p_workspace,r.id,auth.uid(),name,'Proposal changed. A new decision is needed.','updated' from public.members where workspace_id=p_workspace and user_id=auth.uid();
  end if;
 end if;
 return r;
end; $$;

create or replace function public.save_item(p_workspace uuid,p_kind text,p_id uuid,p_version integer,p_data jsonb) returns public.items language plpgsql security definer set search_path='' as $$
declare r public.items; old public.items; role_name text; is_new boolean;
begin
 role_name:=public.member_role(p_workspace);
 if role_name is null then raise exception 'Workspace access required'; end if;
 if p_kind not in ('task','event','idea','todo') then raise exception 'Invalid item type'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or p_data - array['title','description','status','priority','category','assignee_id','event_id','due_date','week_of','starts_at','location','definition_done','delivery_url','delivery_notes','athlete_id','event_type','content_needs'] <> '{}'::jsonb then raise exception 'Unknown fields'; end if;
 is_new:=p_id is null;
 if not is_new then
  select * into old from public.items where id=p_id and workspace_id=p_workspace and kind=p_kind for update;
  if not found then raise exception 'Item not found'; end if;
  if old.version is distinct from p_version then raise exception 'This item changed. Reload before saving.'; end if;
  if p_kind='todo' and old.created_by<>auth.uid() then raise exception 'Private to-do'; end if;
 else
  old.id:=gen_random_uuid(); old.workspace_id:=p_workspace; old.kind:=p_kind; old.created_by:=auth.uid(); old.created_at:=now(); old.version:=0;
  old.status:=case p_kind when 'idea' then 'inbox' when 'event' then 'planned' else 'open' end;
  old.description:='';old.priority:='normal';old.category:='Operations';old.location:='';old.definition_done:='';old.delivery_url:='';old.delivery_notes:='';old.event_type:='event';old.content_needs:='';
 end if;
 r:=jsonb_populate_record(old,p_data);
 r.title:=btrim(r.title); r.updated_at:=now();r.version:=old.version+1;
 if p_kind='todo' then r.assignee_id:=auth.uid(); r.event_id:=null; end if;
 if p_kind='task' and r.status='doing' and r.assignee_id is null then raise exception 'Assign an owner first'; end if;
 if r.event_id is not null and not exists(select 1 from public.items where id=r.event_id and workspace_id=p_workspace and kind='event') then raise exception 'Event must belong to this workspace'; end if;
 if r.athlete_id is not null and not exists(select 1 from public.sponsorships where id=r.athlete_id and workspace_id=p_workspace and record_type='athlete') then raise exception 'Choose an athlete in this workspace'; end if;
 if is_new then
  insert into public.items select r.*;
 else
  update public.items set title=r.title,description=r.description,status=r.status,priority=r.priority,category=r.category,assignee_id=r.assignee_id,event_id=r.event_id,due_date=r.due_date,week_of=r.week_of,starts_at=r.starts_at,location=r.location,definition_done=r.definition_done,delivery_url=r.delivery_url,delivery_notes=r.delivery_notes,athlete_id=r.athlete_id,event_type=r.event_type,content_needs=r.content_needs,version=r.version,updated_at=r.updated_at where id=r.id;
 end if;
 if p_kind<>'todo' then insert into public.activity(workspace_id,actor_id,title) values(p_workspace,auth.uid(),case when is_new then 'Created ' else 'Updated ' end || r.title); end if;
 return r;
end; $$;


-- Motion OS. All application writes are authorized RPCs; reads use RLS.
create table public.workspaces (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100),
  owner_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.members (
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  name text not null check(length(name) between 1 and 100),
  role text not null check(role in ('admin','lead','member')),
  primary key(workspace_id,user_id)
);
create table public.access_grants (
  workspace_id uuid references public.workspaces(id) on delete cascade,
  email text not null check(length(email) <= 254 and email = lower(email) and position('@' in email)>1),
  role text not null check(role in ('lead','member')), primary key(workspace_id,email)
);
create table public.items (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check(kind in ('task','event','idea','todo')),
  title text not null check(length(btrim(title)) between 1 and 180),
  description text not null default '' check(length(description)<=10000),
  status text not null default 'open', priority text not null default 'normal' check(priority in ('normal','high','urgent')),
  category text not null default 'Operations' check(length(category)<=60),
  assignee_id uuid, event_id uuid references public.items(id), due_date date, week_of date,
  starts_at timestamptz, location text not null default '' check(length(location)<=300),
  definition_done text not null default '' check(length(definition_done)<=4000),
  delivery_url text not null default '' check(delivery_url='' or (length(delivery_url)<=2000 and delivery_url ~ '^https://')),
  delivery_notes text not null default '' check(length(delivery_notes)<=4000),
  created_by uuid not null references auth.users(id), version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(workspace_id,assignee_id) references public.members(workspace_id,user_id),
  check ((kind='task' and status in ('open','doing','review','done')) or (kind='idea' and status in ('inbox','planned','archived')) or (kind='todo' and status in ('open','done')) or (kind='event' and status in ('planned','complete'))),
  check(kind <> 'event' or starts_at is not null),
  check(week_of is null or extract(isodow from week_of)=1)
);
create index items_workspace on public.items(workspace_id,kind,updated_at);
create table public.activity (
 id bigint generated always as identity primary key, workspace_id uuid not null references public.workspaces(id) on delete cascade,
 actor_id uuid not null references auth.users(id), title text not null, created_at timestamptz not null default now()
);
create function public.member_role(w uuid) returns text language sql stable security definer set search_path='' as $$
 select role from public.members where workspace_id=w and user_id=(select auth.uid());
$$;
create function public.can_read_item(w uuid,k text,creator uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.member_role(w) is not null and (k<>'todo' or creator=(select auth.uid()));
$$;
alter table public.workspaces enable row level security;
alter table public.members enable row level security;
alter table public.access_grants enable row level security;
alter table public.items enable row level security;
alter table public.activity enable row level security;
create policy workspaces_read on public.workspaces for select to authenticated using (public.member_role(id) is not null);
create policy members_read on public.members for select to authenticated using (public.member_role(workspace_id) is not null);
create policy grants_read on public.access_grants for select to authenticated using (public.member_role(workspace_id)='admin');
create policy items_read on public.items for select to authenticated using (public.can_read_item(workspace_id,kind,created_by));
create policy activity_read on public.activity for select to authenticated using (public.member_role(workspace_id) is not null);
revoke all on public.workspaces,public.members,public.access_grants,public.items,public.activity from anon, authenticated;
grant select on public.workspaces,public.members,public.access_grants,public.items,public.activity to authenticated;

create function public.create_workspace(p_name text,p_display_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 insert into public.workspaces(name,owner_id) values(btrim(p_name),auth.uid()) returning id into w;
 insert into public.members values(w,auth.uid(),btrim(p_display_name),'admin');
 return w;
end; $$;

-- An admin grants an email access. No email is sent by this function.
create function public.grant_access(p_workspace uuid,p_email text,p_role text) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.member_role(p_workspace) is distinct from 'admin' then raise exception 'Admin access required'; end if;
 if p_role not in ('lead','member') then raise exception 'Invalid role'; end if;
 insert into public.access_grants values(p_workspace,lower(btrim(p_email)),p_role)
 on conflict(workspace_id,email) do update set role=excluded.role;
end; $$;
create function public.accept_access(p_name text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 -- auth.users is authoritative; never trust user-editable metadata for email or role.
 insert into public.members(workspace_id,user_id,name,role)
 select g.workspace_id,auth.uid(),btrim(p_name),g.role from public.access_grants g
 join auth.users u on u.id=auth.uid() and lower(u.email)=g.email and u.email_confirmed_at is not null
 on conflict do nothing;
 delete from public.access_grants g using auth.users u
 where u.id=auth.uid() and lower(u.email)=g.email and u.email_confirmed_at is not null;
end; $$;
create function public.remove_access(p_workspace uuid,p_user uuid default null,p_email text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.member_role(p_workspace) is distinct from 'admin' then raise exception 'Admin access required'; end if;
 if exists(select 1 from public.workspaces where id=p_workspace and owner_id=p_user) then raise exception 'The workspace owner cannot be removed'; end if;
 if p_user is not null then
  update public.items set assignee_id=null,status=case when kind='task' and status<>'done' then 'open' else status end,version=version+1,updated_at=now() where workspace_id=p_workspace and assignee_id=p_user;
  delete from public.members where workspace_id=p_workspace and user_id=p_user;
 end if;
 if p_email is not null then delete from public.access_grants where workspace_id=p_workspace and email=lower(btrim(p_email)); end if;
end; $$;

create function public.save_item(p_workspace uuid,p_kind text,p_id uuid,p_version integer,p_data jsonb) returns public.items language plpgsql security definer set search_path='' as $$
declare r public.items; old public.items; role_name text; is_new boolean;
begin
 role_name:=public.member_role(p_workspace);
 if role_name is null then raise exception 'Workspace access required'; end if;
 if p_kind not in ('task','event','idea','todo') then raise exception 'Invalid item type'; end if;
 if p_data - array['title','description','status','priority','category','assignee_id','event_id','due_date','week_of','starts_at','location','definition_done','delivery_url','delivery_notes'] <> '{}'::jsonb then raise exception 'Unknown fields'; end if;
 if p_kind='event' and role_name not in ('admin','lead') then raise exception 'Only leads can edit events'; end if;
 is_new:=p_id is null;
 if not is_new then
  select * into old from public.items where id=p_id and workspace_id=p_workspace and kind=p_kind for update;
  if not found then raise exception 'Item not found'; end if;
  if old.version is distinct from p_version then raise exception 'This item changed. Reload before saving.'; end if;
  if p_kind='todo' and old.created_by<>auth.uid() then raise exception 'Private to-do'; end if;
  if p_kind<>'todo' and role_name not in ('admin','lead') and old.created_by<>auth.uid() and old.assignee_id is distinct from auth.uid() then raise exception 'Only the owner or a lead can edit this item'; end if;
 else
  old.id:=gen_random_uuid(); old.workspace_id:=p_workspace; old.kind:=p_kind; old.created_by:=auth.uid(); old.created_at:=now(); old.version:=0;
  old.status:=case p_kind when 'idea' then 'inbox' when 'event' then 'planned' else 'open' end;
  old.description:='';old.priority:='normal';old.category:='Operations';old.location:='';old.definition_done:='';old.delivery_url:='';old.delivery_notes:='';
 end if;
 r:=jsonb_populate_record(old,p_data);
 r.title:=btrim(r.title); r.updated_at:=now();r.version:=old.version+1;
 if p_kind='todo' then r.assignee_id:=auth.uid(); r.event_id:=null; end if;
 if role_name not in ('admin','lead') and r.assignee_id is distinct from old.assignee_id and r.assignee_id is not null and r.assignee_id<>auth.uid() then raise exception 'Only leads can assign other people'; end if;
 if not is_new and role_name not in ('admin','lead') and old.assignee_id is not null and old.assignee_id<>auth.uid() and r.assignee_id is distinct from old.assignee_id then raise exception 'Only leads can reassign someone else'; end if;
 if p_kind='task' and r.status='done' and r.status is distinct from old.status and role_name not in ('admin','lead') then raise exception 'A lead must approve this deliverable'; end if;
 if p_kind='task' and r.status in ('doing','review') and r.assignee_id is null then raise exception 'Assign an owner first'; end if;
 if p_kind='task' and r.status='review' and btrim(r.delivery_notes)='' and r.delivery_url='' then raise exception 'Add a delivery note or link before submitting'; end if;
 if r.event_id is not null and not exists(select 1 from public.items where id=r.event_id and workspace_id=p_workspace and kind='event') then raise exception 'Event must belong to this workspace'; end if;
 if is_new then
  insert into public.items select r.*;
 else
  update public.items set title=r.title,description=r.description,status=r.status,priority=r.priority,category=r.category,assignee_id=r.assignee_id,event_id=r.event_id,due_date=r.due_date,week_of=r.week_of,starts_at=r.starts_at,location=r.location,definition_done=r.definition_done,delivery_url=r.delivery_url,delivery_notes=r.delivery_notes,version=r.version,updated_at=r.updated_at where id=r.id;
 end if;
 if p_kind<>'todo' then insert into public.activity(workspace_id,actor_id,title) values(p_workspace,auth.uid(),case when is_new then 'Created ' else 'Updated ' end || r.title); end if;
 return r;
end; $$;

-- Row locking makes simultaneous claims deterministic: exactly one person wins.
create function public.claim_task(p_id uuid) returns public.items language plpgsql security definer set search_path='' as $$
declare r public.items;
begin
 select * into r from public.items where id=p_id for update;
 if not found or public.member_role(r.workspace_id) is null then raise exception 'Task not found'; end if;
 if r.kind<>'task' or r.assignee_id is not null or r.status<>'open' then raise exception 'This task is no longer available'; end if;
 update public.items set assignee_id=auth.uid(),status='doing',version=version+1,updated_at=now() where id=p_id returning * into r;
 insert into public.activity(workspace_id,actor_id,title) values(r.workspace_id,auth.uid(),'Claimed '||r.title);
 return r;
end; $$;

revoke execute on function public.member_role(uuid),public.can_read_item(uuid,text,uuid),public.create_workspace(text,text),public.grant_access(uuid,text,text),public.accept_access(text),public.remove_access(uuid,uuid,text),public.save_item(uuid,text,uuid,integer,jsonb),public.claim_task(uuid) from public,anon;
grant execute on function public.member_role(uuid),public.can_read_item(uuid,text,uuid),public.create_workspace(text,text),public.grant_access(uuid,text,text),public.accept_access(text),public.remove_access(uuid,uuid,text),public.save_item(uuid,text,uuid,integer,jsonb),public.claim_task(uuid) to authenticated;
-- The client refreshes from the database after mutations, on focus, and every 20 seconds.
-- No realtime publication or service-role credential is required.

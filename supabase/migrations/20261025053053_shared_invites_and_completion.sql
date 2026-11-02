-- Everyone in a workspace can organize shared work and check it off.
-- Membership, private to-dos, version checks and atomic claims remain enforced.
update public.items set status=case when assignee_id is null then 'open' else 'doing' end,
 version=version+1,updated_at=now() where kind='task' and status='review';
alter table public.items add constraint tasks_have_no_review_step check(kind<>'task' or status in ('open','doing','done'));

create table public.workspace_invites (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 token uuid not null unique default gen_random_uuid(), enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
create table public.workspace_revocations (
 workspace_id uuid references public.workspaces(id) on delete cascade,
 user_id uuid references auth.users(id) on delete cascade,
 primary key(workspace_id,user_id)
);
alter table public.workspace_invites enable row level security;
alter table public.workspace_revocations enable row level security;
revoke all on public.workspace_invites,public.workspace_revocations from public,anon,authenticated;

create function public.get_workspace_invite(p_workspace uuid,p_rotate boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if public.member_role(p_workspace) is distinct from 'admin' then raise exception 'Workspace owner access required'; end if;
 insert into public.workspace_invites(workspace_id) values(p_workspace)
 on conflict(workspace_id) do update set enabled=true,
 token=case when p_rotate then gen_random_uuid() else public.workspace_invites.token end,updated_at=now()
 returning token into result;
 return result;
end; $$;

create function public.disable_workspace_invite(p_workspace uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if public.member_role(p_workspace) is distinct from 'admin' then raise exception 'Workspace owner access required'; end if;
 update public.workspace_invites set enabled=false,updated_at=now() where workspace_id=p_workspace;
end; $$;

create function public.join_workspace(p_token uuid,p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare w uuid; added integer;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select workspace_id into w from public.workspace_invites where token=p_token and enabled for share;
 if w is null then raise exception 'This invite link is invalid or has been turned off'; end if;
 if exists(select 1 from public.workspace_revocations where workspace_id=w and user_id=auth.uid()) then
  raise exception 'Your access was removed. Ask the workspace owner to restore it';
 end if;
 insert into public.members(workspace_id,user_id,name,role) values(w,auth.uid(),btrim(p_name),'member') on conflict do nothing;
 get diagnostics added=row_count;
 if added>0 then insert into public.activity(workspace_id,actor_id,title) values(w,auth.uid(),'Joined the workspace'); end if;
 return w;
end; $$;

create or replace function public.remove_access(p_workspace uuid,p_user uuid default null,p_email text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if public.member_role(p_workspace) is distinct from 'admin' then raise exception 'Admin access required'; end if;
 if exists(select 1 from public.workspaces where id=p_workspace and owner_id=p_user) then raise exception 'The workspace owner cannot be removed'; end if;
 if p_user is not null then
  insert into public.workspace_revocations values(p_workspace,p_user) on conflict do nothing;
  update public.items set assignee_id=null,status=case when kind='task' and status<>'done' then 'open' else status end,version=version+1,updated_at=now() where workspace_id=p_workspace and assignee_id=p_user;
  delete from public.members where workspace_id=p_workspace and user_id=p_user;
 end if;
 if p_email is not null then delete from public.access_grants where workspace_id=p_workspace and email=lower(btrim(p_email)); end if;
end; $$;

-- An owner can restore a previously removed member without knowing their email.
create function public.restore_workspace_access(p_workspace uuid,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if public.member_role(p_workspace) is distinct from 'admin' then raise exception 'Admin access required'; end if;
 delete from public.workspace_revocations where workspace_id=p_workspace and user_id=p_user;
end; $$;

create or replace function public.save_item(p_workspace uuid,p_kind text,p_id uuid,p_version integer,p_data jsonb) returns public.items language plpgsql security definer set search_path='' as $$
declare r public.items; old public.items; role_name text; is_new boolean;
begin
 role_name:=public.member_role(p_workspace);
 if role_name is null then raise exception 'Workspace access required'; end if;
 if p_kind not in ('task','event','idea','todo') then raise exception 'Invalid item type'; end if;
 if p_data - array['title','description','status','priority','category','assignee_id','event_id','due_date','week_of','starts_at','location','definition_done','delivery_url','delivery_notes'] <> '{}'::jsonb then raise exception 'Unknown fields'; end if;
 is_new:=p_id is null;
 if not is_new then
  select * into old from public.items where id=p_id and workspace_id=p_workspace and kind=p_kind for update;
  if not found then raise exception 'Item not found'; end if;
  if old.version is distinct from p_version then raise exception 'This item changed. Reload before saving.'; end if;
  if p_kind='todo' and old.created_by<>auth.uid() then raise exception 'Private to-do'; end if;
 else
  old.id:=gen_random_uuid(); old.workspace_id:=p_workspace; old.kind:=p_kind; old.created_by:=auth.uid(); old.created_at:=now(); old.version:=0;
  old.status:=case p_kind when 'idea' then 'inbox' when 'event' then 'planned' else 'open' end;
  old.description:='';old.priority:='normal';old.category:='Operations';old.location:='';old.definition_done:='';old.delivery_url:='';old.delivery_notes:='';
 end if;
 r:=jsonb_populate_record(old,p_data);
 r.title:=btrim(r.title); r.updated_at:=now();r.version:=old.version+1;
 if p_kind='todo' then r.assignee_id:=auth.uid(); r.event_id:=null; end if;
 if p_kind='task' and r.status='doing' and r.assignee_id is null then raise exception 'Assign an owner first'; end if;
 if r.event_id is not null and not exists(select 1 from public.items where id=r.event_id and workspace_id=p_workspace and kind='event') then raise exception 'Event must belong to this workspace'; end if;
 if is_new then
  insert into public.items select r.*;
 else
  update public.items set title=r.title,description=r.description,status=r.status,priority=r.priority,category=r.category,assignee_id=r.assignee_id,event_id=r.event_id,due_date=r.due_date,week_of=r.week_of,starts_at=r.starts_at,location=r.location,definition_done=r.definition_done,delivery_url=r.delivery_url,delivery_notes=r.delivery_notes,version=r.version,updated_at=r.updated_at where id=r.id;
 end if;
 if p_kind<>'todo' then insert into public.activity(workspace_id,actor_id,title) values(p_workspace,auth.uid(),case when is_new then 'Created ' else 'Updated ' end || r.title); end if;
 return r;
end; $$;

revoke execute on function public.get_workspace_invite(uuid,boolean),public.disable_workspace_invite(uuid),public.join_workspace(uuid,text),public.restore_workspace_access(uuid,uuid) from public,anon;
grant execute on function public.get_workspace_invite(uuid,boolean),public.disable_workspace_invite(uuid),public.join_workspace(uuid,text),public.restore_workspace_access(uuid,uuid) to authenticated;

create or replace function public.accept_access(p_name text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 insert into public.members(workspace_id,user_id,name,role)
 select g.workspace_id,auth.uid(),btrim(p_name),g.role from public.access_grants g
 join auth.users u on u.id=auth.uid() and lower(u.email)=g.email and u.email_confirmed_at is not null
 where not exists(select 1 from public.workspace_revocations r where r.workspace_id=g.workspace_id and r.user_id=auth.uid())
 on conflict do nothing;
 delete from public.access_grants g using auth.users u
 where u.id=auth.uid() and lower(u.email)=g.email and u.email_confirmed_at is not null;
end; $$;

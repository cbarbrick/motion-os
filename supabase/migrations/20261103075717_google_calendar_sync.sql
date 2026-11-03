-- One private Google calendar per workspace. Credentials stay on the server.
create table public.calendar_connections (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 calendar_id text not null unique,
 connected_by uuid not null references auth.users(id),
 connected_at timestamptz not null default now()
);
create table public.calendar_sync (
 item_id uuid primary key references public.items(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 requested_version integer not null,
 synced_version integer not null default 0,
 last_error text,
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 lease_id uuid,
 lease_until timestamptz,
 synced_at timestamptz
);
create index calendar_sync_due on public.calendar_sync(next_attempt_at) where requested_version>synced_version;
alter table public.calendar_connections enable row level security;
alter table public.calendar_sync enable row level security;
create policy calendar_connections_read on public.calendar_connections for select to authenticated using(public.member_role(workspace_id) is not null);
create policy calendar_sync_read on public.calendar_sync for select to authenticated using(public.member_role(workspace_id) is not null);
revoke all on public.calendar_connections,public.calendar_sync from public,anon,authenticated;
grant select on public.calendar_connections,public.calendar_sync to authenticated;
grant select on public.calendar_connections,public.calendar_sync to service_role;

create function motion_private.queue_calendar_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='event' then
  insert into public.calendar_sync(item_id,workspace_id,requested_version) values(new.id,new.workspace_id,new.version)
  on conflict(item_id) do update set requested_version=excluded.requested_version,next_attempt_at=now(),attempts=0,last_error=null;
 end if;
 return new;
end;$$;
create trigger queue_calendar_event after insert or update on public.items for each row execute function motion_private.queue_calendar_event();
revoke all on function motion_private.queue_calendar_event() from public,anon,authenticated;

-- Only the server can register a verified, app-created Google calendar.
create function public.register_google_calendar(p_workspace uuid,p_owner uuid,p_calendar text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.workspaces w join public.members m on m.workspace_id=w.id and m.user_id=p_owner where w.id=p_workspace and w.owner_id=p_owner) then raise exception 'Workspace owner required'; end if;
 if exists(select 1 from public.calendar_connections where workspace_id=p_workspace and calendar_id<>p_calendar) then raise exception 'A calendar is already connected'; end if;
 insert into public.calendar_connections(workspace_id,calendar_id,connected_by) values(p_workspace,p_calendar,p_owner) on conflict(workspace_id) do update set connected_by=excluded.connected_by,connected_at=now();
 insert into public.calendar_sync(item_id,workspace_id,requested_version) select id,workspace_id,version from public.items where workspace_id=p_workspace and kind='event'
 on conflict(item_id) do update set next_attempt_at=now(),last_error=null;
end;$$;

-- Claim one event at a time. A lease serializes updates and survives process failures.
create function public.claim_calendar_sync(p_workspace uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.calendar_sync; event public.items; calendar text;
begin
 select s.* into job from public.calendar_sync s join public.calendar_connections c using(workspace_id)
 where s.requested_version>s.synced_version and s.next_attempt_at<=now() and (s.lease_until is null or s.lease_until<now()) and (p_workspace is null or s.workspace_id=p_workspace)
 order by s.next_attempt_at for update of s skip locked limit 1;
 if not found then return null; end if;
 update public.calendar_sync set lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes' where item_id=job.item_id returning * into job;
 select * into event from public.items where id=job.item_id;
 select calendar_id into calendar from public.calendar_connections where workspace_id=job.workspace_id;
 return jsonb_build_object('job',to_jsonb(job),'event',to_jsonb(event),'calendar_id',calendar);
end;$$;
create function public.finish_calendar_sync(p_item uuid,p_lease uuid,p_version integer,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.calendar_sync set
 synced_version=case when p_error is null then greatest(synced_version,p_version) else synced_version end,
 synced_at=case when p_error is null then now() else synced_at end,
 last_error=case when p_error is null then null else left(p_error,500) end,
 attempts=case when p_error is null then 0 else attempts+1 end,
 next_attempt_at=case when p_error is null then now() else now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer)) end,
 lease_id=null,lease_until=null
 where item_id=p_item and lease_id=p_lease;
end;$$;
revoke all on function public.register_google_calendar(uuid,uuid,text),public.claim_calendar_sync(uuid),public.finish_calendar_sync(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.register_google_calendar(uuid,uuid,text),public.claim_calendar_sync(uuid),public.finish_calendar_sync(uuid,uuid,integer,text) to service_role;

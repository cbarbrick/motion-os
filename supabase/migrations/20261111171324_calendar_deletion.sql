-- Keep a durable tombstone until the Google worker has removed its copy.
alter table public.calendar_sync drop constraint calendar_sync_item_id_fkey;
alter table public.calendar_sync add column delete_requested boolean not null default false;

create function public.claim_calendar_sync_v2(p_workspace uuid default null,p_include_deletions boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.calendar_sync; event public.items; calendar text;
begin
 select s.* into job from public.calendar_sync s join public.calendar_connections c using(workspace_id)
 where s.requested_version>s.synced_version and s.next_attempt_at<=now()
 and (p_include_deletions or not s.delete_requested)
 and (s.lease_until is null or s.lease_until<now()) and (p_workspace is null or s.workspace_id=p_workspace)
 order by s.next_attempt_at for update of s skip locked limit 1;
 if not found then return null; end if;
 update public.calendar_sync set lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes' where item_id=job.item_id returning * into job;
 select * into event from public.items where id=job.item_id;
 select calendar_id into calendar from public.calendar_connections where workspace_id=job.workspace_id;
 return jsonb_build_object('job',to_jsonb(job),'event',case when event.id is null then null else to_jsonb(event) end,'calendar_id',calendar);
end;$$;
-- Old workers can keep processing edits during the hosting cutover, but only
-- the new worker understands deletion jobs.
create or replace function public.claim_calendar_sync(p_workspace uuid default null) returns jsonb
language sql security definer set search_path='' as $$
 select public.claim_calendar_sync_v2(p_workspace,false);
$$;
revoke all on function public.claim_calendar_sync_v2(uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_calendar_sync_v2(uuid,boolean) to service_role;

create function public.delete_item(p_workspace uuid,p_id uuid,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare old public.items;
begin
 if public.member_role(p_workspace) is null then raise exception 'Workspace access required'; end if;
 select * into old from public.items where id=p_id and workspace_id=p_workspace for update;
 if not found then raise exception 'Item not found. Refresh the workspace.'; end if;
 if old.kind not in ('event','task') then raise exception 'Only events and tasks can be deleted here'; end if;
 if old.version is distinct from p_version then raise exception 'This item changed. Reload before deleting.'; end if;
 -- Preserve related work, and make stale editors reload the changed link.
 update public.items set event_id=null,version=version+1,updated_at=now()
 where workspace_id=p_workspace and event_id=p_id;
 if old.kind='event' then
  insert into public.calendar_sync(item_id,workspace_id,requested_version,delete_requested)
  values(old.id,old.workspace_id,old.version+1,true)
  on conflict(item_id) do update set requested_version=excluded.requested_version,
   delete_requested=true,next_attempt_at=now(),attempts=0,last_error=null;
  -- Keep any existing lease: an in-flight upsert must finish before the delete.
 end if;
 delete from public.items where id=p_id and workspace_id=p_workspace;
 insert into public.activity(workspace_id,actor_id,title) values(p_workspace,auth.uid(),'Deleted '||old.title);
end;$$;
revoke all on function public.delete_item(uuid,uuid,integer) from public,anon;
grant execute on function public.delete_item(uuid,uuid,integer) to authenticated;

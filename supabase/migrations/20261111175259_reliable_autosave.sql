-- A save receipt and the underlying write commit together. Replaying the same
-- authenticated request returns its original result without another mutation.
create table motion_private.save_receipts (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 input jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(workspace_id,user_id,request_id)
);
create index save_receipts_user on motion_private.save_receipts(user_id);
create index save_receipts_record on motion_private.save_receipts(workspace_id,((result->>'id')));
alter table motion_private.save_receipts enable row level security;
revoke all on motion_private.save_receipts from public,anon,authenticated;

create function public.save_record(p_workspace uuid,p_request uuid,p_entity text,p_kind text,p_id uuid,p_version integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt motion_private.save_receipts; body jsonb; result jsonb;
begin
 if auth.uid() is null or public.member_role(p_workspace) is null then raise exception 'Workspace access required'; end if;
 if p_request is null or p_entity not in ('item','sponsorship') or p_entity is null then raise exception 'Invalid save request'; end if;
 body:=jsonb_build_object('entity',p_entity,'kind',p_kind,'id',p_id,'version',p_version,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||auth.uid()::text||p_request::text,0));
 select * into receipt from motion_private.save_receipts where workspace_id=p_workspace and user_id=auth.uid() and request_id=p_request;
 if found then
  if receipt.result='null'::jsonb then raise exception 'Record no longer available'; end if;
  if receipt.input is distinct from body then raise exception 'Save request changed. Reload the saved record before retrying.'; end if;
  if p_entity='item' and not exists(select 1 from public.items where id=(receipt.result->>'id')::uuid and workspace_id=p_workspace and public.can_read_item(workspace_id,kind,created_by)) then raise exception 'Item no longer available'; end if;
  if p_entity='sponsorship' and not exists(select 1 from public.sponsorships where id=(receipt.result->>'id')::uuid and workspace_id=p_workspace) then raise exception 'Record no longer available'; end if;
  return receipt.result;
 end if;
 if p_entity='item' then
  result:=to_jsonb(public.save_item(p_workspace,p_kind,p_id,p_version,p_data));
 else
  result:=to_jsonb(public.save_sponsorship(p_workspace,p_id,p_version,p_data));
 end if;
 insert into motion_private.save_receipts(workspace_id,user_id,request_id,input,result) values(p_workspace,auth.uid(),p_request,body,result);
 return result;
end;$$;
revoke all on function public.save_record(uuid,uuid,text,text,uuid,integer,jsonb) from public,anon;
grant execute on function public.save_record(uuid,uuid,text,text,uuid,integer,jsonb) to authenticated;

-- Keep only an empty request tombstone after deletion: no deleted text remains
-- in receipts, and retrying an old create cannot recreate the removed record.
create function motion_private.purge_save_receipts() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 update motion_private.save_receipts set input='{}'::jsonb,result='null'::jsonb
 where workspace_id=old.workspace_id and result->>'id'=old.id::text;
 return old;
end;$$;
revoke all on function motion_private.purge_save_receipts() from public,anon,authenticated;
create trigger purge_item_save_receipts after delete on public.items for each row execute function motion_private.purge_save_receipts();
create trigger purge_sponsorship_save_receipts after delete on public.sponsorships for each row execute function motion_private.purge_save_receipts();

-- Only existing RLS-protected data is published. Clients subscribe to INSERT
-- and UPDATE; shared deletion activity triggers a fresh authorized read.
do $$ declare name text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach name in array array['items','sponsorships','sponsorship_comments','sponsorship_settings','activity','members'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=name) then
    execute format('alter publication supabase_realtime add table public.%I',name);
   end if;
  end loop;
 end if;
end;$$;

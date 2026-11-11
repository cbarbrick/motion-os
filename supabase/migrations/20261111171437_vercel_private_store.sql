-- Host-independent, server-only storage for encrypted Google connections and
-- short-lived PKCE handoffs. Browser roles cannot access these rows or RPCs.
create table motion_private.server_objects (
 namespace text not null, key text not null, value jsonb not null,
 expires_at timestamptz, primary key(namespace,key)
);
alter table motion_private.server_objects enable row level security;
create table motion_private.server_rate_limits (
 key text not null, bucket bigint not null, requests integer not null,
 primary key(key,bucket)
);
alter table motion_private.server_rate_limits enable row level security;
revoke all on motion_private.server_objects,motion_private.server_rate_limits from public,anon,authenticated;

create function public.server_store(p_namespace text,p_key text,p_action text,p_value jsonb default null,p_expires timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; affected integer;
begin
 if p_namespace not in ('motion-google-calendar','motion-app-login') or length(p_key)>200 then raise exception 'Invalid store'; end if;
 if p_action='get' then
  select value into result from motion_private.server_objects where namespace=p_namespace and key=p_key and (expires_at is null or expires_at>now());
  return result;
 elsif p_action='delete' then
  delete from motion_private.server_objects where namespace=p_namespace and key=p_key;
  return null;
 elsif p_action='create' then
  insert into motion_private.server_objects values(p_namespace,p_key,p_value,p_expires) on conflict do nothing;
  get diagnostics affected=row_count;
  return jsonb_build_object('modified',affected=1);
 elsif p_action='set' then
  insert into motion_private.server_objects values(p_namespace,p_key,p_value,p_expires)
  on conflict(namespace,key) do update set value=excluded.value,expires_at=excluded.expires_at;
  return jsonb_build_object('modified',true);
 end if;
 raise exception 'Invalid store action';
end;$$;
create function public.server_rate_limit(p_key text,p_limit integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare count integer; minute bigint:=floor(extract(epoch from now())/60);
begin
 if p_key !~ '^[0-9a-f]{64}$' or p_limit<1 or p_limit>600 then raise exception 'Invalid limit'; end if;
 insert into motion_private.server_rate_limits values(p_key,minute,1)
 on conflict(key,bucket) do update set requests=motion_private.server_rate_limits.requests+1
 returning requests into count;
 return count<=p_limit;
end;$$;
create function public.cleanup_server_store() returns void
language plpgsql security definer set search_path='' as $$
begin
 delete from motion_private.server_objects where expires_at<=now();
 delete from motion_private.server_rate_limits where bucket<floor(extract(epoch from now())/60)-60;
end;$$;
revoke all on function public.server_store(text,text,text,jsonb,timestamptz),public.server_rate_limit(text,integer),public.cleanup_server_store() from public,anon,authenticated;
grant execute on function public.server_store(text,text,text,jsonb,timestamptz),public.server_rate_limit(text,integer),public.cleanup_server_store() to service_role;

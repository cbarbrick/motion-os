-- Device capabilities and delivery jobs never appear in the public Data API.
create table motion_private.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique,
 p256dh text not null,
 auth_key text not null,
 created_at timestamptz not null default now(),
 last_test_at timestamptz
);
create index push_subscriptions_user on motion_private.push_subscriptions(user_id);
alter table motion_private.push_subscriptions enable row level security;
revoke all on motion_private.push_subscriptions from public,anon,authenticated,service_role;
create table motion_private.push_deliveries (
 id uuid primary key default gen_random_uuid(),
 notification_id uuid not null references public.notifications(id) on delete cascade,
 subscription_id uuid not null references motion_private.push_subscriptions(id) on delete cascade,
 created_at timestamptz not null default now(),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 lease_id uuid,
 lease_until timestamptz,
 finished_at timestamptz,
 last_status text,
 unique(notification_id,subscription_id)
);
create index push_deliveries_subscription on motion_private.push_deliveries(subscription_id);
create index push_deliveries_pending on motion_private.push_deliveries(next_attempt_at) where finished_at is null;
alter table motion_private.push_deliveries enable row level security;
revoke all on motion_private.push_deliveries from public,anon,authenticated,service_role;

create function public.save_push_subscription(p_endpoint text,p_p256dh text,p_auth text) returns uuid
language plpgsql security definer set search_path='' as $$
declare s motion_private.push_subscriptions; result uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.members where user_id=auth.uid()) then raise exception 'Join a workspace first'; end if;
 if p_endpoint is null or length(p_endpoint)>2048 or p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/[^[:space:]#]+$'
 then raise exception 'This browser push service is not supported'; end if;
 if p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87}$' or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$' then raise exception 'Invalid device subscription'; end if;
 -- Serialize device registration, including concurrent enables on two tabs.
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 perform pg_advisory_xact_lock(hashtext(p_endpoint));
 select * into s from motion_private.push_subscriptions where endpoint=p_endpoint for update;
 if found then
  if s.p256dh<>p_p256dh or s.auth_key<>p_auth then raise exception 'Device subscription changed; turn notifications off and on again'; end if;
  if s.user_id=auth.uid() then return s.id; end if;
  -- A shared device changes account. Old queued notifications must not follow it.
  delete from motion_private.push_subscriptions where id=s.id;
 end if;
 if (select count(*) from motion_private.push_subscriptions where user_id=auth.uid())>=10 then raise exception 'Up to 10 devices per account'; end if;
 insert into motion_private.push_subscriptions(user_id,endpoint,p256dh,auth_key) values(auth.uid(),p_endpoint,p_p256dh,p_auth) returning id into result;
 return result;
end; $$;
create function public.get_push_subscription(p_endpoint text) returns uuid
language sql stable security definer set search_path='' as $$
 select id from motion_private.push_subscriptions where endpoint=p_endpoint and user_id=auth.uid()
 and exists(select 1 from public.members where user_id=auth.uid());
$$;
create function public.remove_push_subscription(p_endpoint text) returns void
language sql security definer set search_path='' as $$
 delete from motion_private.push_subscriptions where endpoint=p_endpoint and user_id=auth.uid();
$$;
revoke execute on function public.save_push_subscription(text,text,text),public.get_push_subscription(text),public.remove_push_subscription(text) from public,anon;
grant execute on function public.save_push_subscription(text,text,text),public.get_push_subscription(text),public.remove_push_subscription(text) to authenticated;

create function motion_private.queue_push_notification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into motion_private.push_deliveries(notification_id,subscription_id)
 select new.id,s.id from motion_private.push_subscriptions s where s.user_id=new.recipient_id;
 return new;
end; $$;
create trigger queue_push_notification after insert on public.notifications for each row execute function motion_private.queue_push_notification();
revoke all on function motion_private.queue_push_notification() from public,anon,authenticated;

create function public.claim_push_deliveries(p_workspace uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare jobs jsonb;
begin
 -- No historical flood, no delivery after reading, removal, or membership loss.
 delete from motion_private.push_deliveries d where d.created_at<now()-interval '2 days'
 or (d.finished_at is null and (d.attempts>=6 and (d.lease_until is null or d.lease_until<now())
 or not exists(select 1 from public.notifications n join public.members m on m.workspace_id=n.workspace_id and m.user_id=n.recipient_id
 join motion_private.push_subscriptions s on s.id=d.subscription_id and s.user_id=n.recipient_id
 where n.id=d.notification_id and n.read_at is null and n.created_at>now()-interval '1 day')));
 with selected as (
  select d.id from motion_private.push_deliveries d join public.notifications n on n.id=d.notification_id
  where d.finished_at is null and d.next_attempt_at<=now() and (d.lease_until is null or d.lease_until<now())
  and (p_workspace is null or n.workspace_id=p_workspace)
  order by d.created_at limit 20 for update of d skip locked
 ), claimed as (
  update motion_private.push_deliveries d set lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds',attempts=attempts+1
  from selected where d.id=selected.id returning d.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'lease',c.lease_id,'kind',n.kind,'notification',n.id,
 'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth_key)))), '[]') into jobs
 from claimed c join public.notifications n on n.id=c.notification_id join motion_private.push_subscriptions s on s.id=c.subscription_id;
 return jobs;
end; $$;
create function public.finish_push_delivery(p_id uuid,p_lease uuid,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare s uuid;
begin
 if p_status not in ('sent','expired','retry','failed') then raise exception 'Invalid delivery result'; end if;
 select subscription_id into s from motion_private.push_deliveries where id=p_id and lease_id=p_lease for update;
 if not found then return; end if;
 if p_status='expired' then delete from motion_private.push_subscriptions where id=s; return; end if;
 update motion_private.push_deliveries set finished_at=case when p_status in ('sent','failed') then now() else null end,
 last_status=p_status,lease_id=null,lease_until=null,
 next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer))
 where id=p_id and lease_id=p_lease;
end; $$;
create function public.prepare_push_test(p_id uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s motion_private.push_subscriptions;
begin
 select * into s from motion_private.push_subscriptions where id=p_id and user_id=p_user for update;
 if not found or not exists(select 1 from public.members where user_id=p_user) then raise exception 'Enable notifications on this device first'; end if;
 if s.last_test_at>now()-interval '30 seconds' then raise exception 'Wait 30 seconds before another test'; end if;
 update motion_private.push_subscriptions set last_test_at=now() where id=s.id;
 return jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth_key));
end; $$;
revoke all on function public.claim_push_deliveries(uuid),public.finish_push_delivery(uuid,uuid,text),public.prepare_push_test(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_push_deliveries(uuid),public.finish_push_delivery(uuid,uuid,text),public.prepare_push_test(uuid,uuid) to service_role;

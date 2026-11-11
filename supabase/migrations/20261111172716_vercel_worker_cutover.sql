-- The replacement Vercel workers own queue processing after this cutover.
-- Legacy Netlify jobs become harmless no-ops; pending work stays in the same queues.
create function public.claim_push_deliveries_v2(p_workspace uuid default null) returns jsonb
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

revoke all on function public.claim_push_deliveries_v2(uuid) from public,anon,authenticated;
grant execute on function public.claim_push_deliveries_v2(uuid) to service_role;
create or replace function public.claim_push_deliveries(p_workspace uuid default null) returns jsonb
language sql security definer set search_path='' as $$ select '[]'::jsonb; $$;
create or replace function public.claim_calendar_sync(p_workspace uuid default null) returns jsonb
language sql security definer set search_path='' as $$ select null::jsonb; $$;

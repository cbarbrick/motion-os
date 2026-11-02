-- Sponsorship review is separate from ordinary task completion.
create table public.sponsorship_settings (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 reviewer_id uuid references auth.users(id) on delete set null
);
create table public.sponsorships (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 athlete_name text not null check(length(btrim(athlete_name)) between 1 and 180),
 sport text not null default '' check(length(sport)<=100),
 profile_url text not null default '' check(profile_url='' or (length(profile_url)<=2000 and profile_url ~ '^https://')),
 contact text not null default '' check(length(contact)<=300),
 audience text not null default '' check(length(audience)<=1000),
 proposal text not null default '' check(length(proposal)<=10000),
 requested_support text not null default '' check(length(requested_support)<=4000),
 deliverables text not null default '' check(length(deliverables)<=4000),
 timing text not null default '' check(length(timing)<=1000),
 status text not null default 'pending' check(status in ('pending','approved','denied')),
 decided_by uuid references auth.users(id) on delete set null, decided_at timestamptz,
 created_by uuid references auth.users(id) on delete set null,
 version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,id)
);
create table public.sponsorship_comments (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
 sponsorship_id uuid not null, author_id uuid references auth.users(id) on delete set null,
 author_name text not null, body text not null check(length(body)<=4000),
 action text not null default 'comment' check(action in ('comment','approved','denied','pending','updated')),
 created_at timestamptz not null default now(),
 foreign key(workspace_id,sponsorship_id) references public.sponsorships(workspace_id,id) on delete cascade
);
create index sponsorships_workspace on public.sponsorships(workspace_id,updated_at);
create index sponsorship_comments_proposal on public.sponsorship_comments(workspace_id,sponsorship_id,created_at);
alter table public.sponsorship_settings enable row level security;
alter table public.sponsorships enable row level security;
alter table public.sponsorship_comments enable row level security;
revoke all on public.sponsorship_settings,public.sponsorships,public.sponsorship_comments from public,anon,authenticated;
grant select on public.sponsorship_settings,public.sponsorships,public.sponsorship_comments to authenticated;
create policy sponsorship_settings_read on public.sponsorship_settings for select to authenticated using(public.member_role(workspace_id) is not null);
create policy sponsorships_read on public.sponsorships for select to authenticated using(public.member_role(workspace_id) is not null);
create policy sponsorship_comments_read on public.sponsorship_comments for select to authenticated using(public.member_role(workspace_id) is not null);

create function public.set_sponsorship_reviewer(p_workspace uuid,p_reviewer uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if public.member_role(p_workspace) is distinct from 'admin' then raise exception 'Workspace owner access required'; end if;
 if p_reviewer is not null and not exists(select 1 from public.members where workspace_id=p_workspace and user_id=p_reviewer) then raise exception 'Reviewer must be a workspace member'; end if;
 insert into public.sponsorship_settings values(p_workspace,p_reviewer)
 on conflict(workspace_id) do update set reviewer_id=excluded.reviewer_id;
end; $$;

create function public.save_sponsorship(p_workspace uuid,p_id uuid,p_version integer,p_data jsonb) returns public.sponsorships
language plpgsql security definer set search_path='' as $$
declare r public.sponsorships; old public.sponsorships;
begin
 if public.member_role(p_workspace) is null then raise exception 'Workspace access required'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or p_data - array['athlete_name','sport','profile_url','contact','audience','proposal','requested_support','deliverables','timing'] <> '{}'::jsonb then raise exception 'Unknown proposal fields'; end if;
 if p_id is null then
  insert into public.sponsorships(workspace_id,athlete_name,sport,profile_url,contact,audience,proposal,requested_support,deliverables,timing,created_by)
  values(p_workspace,btrim(p_data->>'athlete_name'),coalesce(p_data->>'sport',''),coalesce(p_data->>'profile_url',''),coalesce(p_data->>'contact',''),coalesce(p_data->>'audience',''),coalesce(p_data->>'proposal',''),coalesce(p_data->>'requested_support',''),coalesce(p_data->>'deliverables',''),coalesce(p_data->>'timing',''),auth.uid()) returning * into r;
 else
  select * into old from public.sponsorships where workspace_id=p_workspace and id=p_id for update;
  if not found then raise exception 'Proposal not found'; end if;
  if old.version is distinct from p_version then raise exception 'This proposal changed. Reload before saving.'; end if;
  r:=jsonb_populate_record(old,p_data); r.athlete_name:=btrim(r.athlete_name);
  if row(r.athlete_name,r.sport,r.profile_url,r.contact,r.audience,r.proposal,r.requested_support,r.deliverables,r.timing) is not distinct from row(old.athlete_name,old.sport,old.profile_url,old.contact,old.audience,old.proposal,old.requested_support,old.deliverables,old.timing) then return old; end if;
  update public.sponsorships set athlete_name=r.athlete_name,sport=r.sport,profile_url=r.profile_url,contact=r.contact,audience=r.audience,proposal=r.proposal,requested_support=r.requested_support,deliverables=r.deliverables,timing=r.timing,status='pending',decided_by=null,decided_at=null,version=old.version+1,updated_at=now() where id=old.id returning * into r;
  if old.status<>'pending' then
   insert into public.sponsorship_comments(workspace_id,sponsorship_id,author_id,author_name,body,action)
   select p_workspace,r.id,auth.uid(),name,'Proposal changed. A new decision is needed.','updated' from public.members where workspace_id=p_workspace and user_id=auth.uid();
  end if;
 end if;
 return r;
end; $$;

create function public.review_sponsorship(p_id uuid,p_version integer,p_status text,p_comment text default '') returns public.sponsorships
language plpgsql security definer set search_path='' as $$
declare r public.sponsorships; reviewer uuid;
begin
 select * into r from public.sponsorships where id=p_id for update;
 if not found or public.member_role(r.workspace_id) is null then raise exception 'Workspace access required'; end if;
 select reviewer_id into reviewer from public.sponsorship_settings where workspace_id=r.workspace_id for share;
 if reviewer is null or reviewer is distinct from auth.uid() then raise exception 'Only the selected sponsorship reviewer can decide'; end if;
 if r.version is distinct from p_version then raise exception 'This proposal changed. Reload before deciding.'; end if;
 if p_status is null or p_status not in ('pending','approved','denied') then raise exception 'Invalid decision'; end if;
 if p_comment is null or length(p_comment)>4000 then raise exception 'Comment must be at most 4000 characters'; end if;
 update public.sponsorships set status=p_status,decided_by=case when p_status='pending' then null else auth.uid() end,decided_at=case when p_status='pending' then null else now() end,version=version+1,updated_at=now() where id=p_id returning * into r;
 insert into public.sponsorship_comments(workspace_id,sponsorship_id,author_id,author_name,body,action)
 select r.workspace_id,r.id,auth.uid(),name,btrim(p_comment),p_status from public.members where workspace_id=r.workspace_id and user_id=auth.uid();
 return r;
end; $$;

create function public.add_sponsorship_comment(p_id uuid,p_body text) returns public.sponsorship_comments
language plpgsql security definer set search_path='' as $$
declare w uuid; result public.sponsorship_comments;
begin
 select workspace_id into w from public.sponsorships where id=p_id;
 if w is null or public.member_role(w) is null then raise exception 'Workspace access required'; end if;
 if p_body is null or length(btrim(p_body)) not between 1 and 4000 then raise exception 'Write a comment of 1–4000 characters'; end if;
 insert into public.sponsorship_comments(workspace_id,sponsorship_id,author_id,author_name,body)
 select w,p_id,auth.uid(),name,btrim(p_body) from public.members where workspace_id=w and user_id=auth.uid() returning * into result;
 return result;
end; $$;
revoke execute on function public.set_sponsorship_reviewer(uuid,uuid),public.save_sponsorship(uuid,uuid,integer,jsonb),public.review_sponsorship(uuid,integer,text,text),public.add_sponsorship_comment(uuid,text) from public,anon;
grant execute on function public.set_sponsorship_reviewer(uuid,uuid),public.save_sponsorship(uuid,uuid,integer,jsonb),public.review_sponsorship(uuid,integer,text,text),public.add_sponsorship_comment(uuid,text) to authenticated;

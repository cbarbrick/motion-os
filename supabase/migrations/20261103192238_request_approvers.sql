-- Each request chooses its own approver. Keep legacy decisions and history.
alter table public.sponsorships add column reviewer_id uuid;
update public.sponsorships s set reviewer_id=st.reviewer_id
from public.sponsorship_settings st where st.workspace_id=s.workspace_id and s.record_type<>'athlete';
alter table public.sponsorships add constraint sponsorships_request_reviewer_fk
 foreign key(workspace_id,reviewer_id) references public.members(workspace_id,user_id) on delete set null (reviewer_id);
create index sponsorships_request_reviewer on public.sponsorships(workspace_id,reviewer_id);
alter table public.sponsorships add constraint roster_has_no_approver check(record_type<>'athlete' or reviewer_id is null);

create or replace function public.save_sponsorship(p_workspace uuid,p_id uuid,p_version integer,p_data jsonb) returns public.sponsorships
language plpgsql security definer set search_path='' as $$
declare r public.sponsorships; old public.sponsorships;
begin
 if public.member_role(p_workspace) is null then raise exception 'Workspace access required'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or p_data - array['athlete_name','sport','profile_url','contact','audience','proposal','requested_support','deliverables','timing','record_type','rate','reviewer_id'] <> '{}'::jsonb then raise exception 'Unknown proposal fields'; end if;
 if p_id is null then
  if coalesce(p_data->>'record_type','athlete') in ('affiliate','person','athlete_proposal','project','other') and nullif(p_data->>'reviewer_id','') is null then raise exception 'Choose a teammate to approve this request'; end if;
  insert into public.sponsorships(workspace_id,athlete_name,sport,profile_url,contact,audience,proposal,requested_support,deliverables,timing,record_type,rate,status,created_by,reviewer_id)
  values(p_workspace,btrim(p_data->>'athlete_name'),coalesce(p_data->>'sport',''),coalesce(p_data->>'profile_url',''),coalesce(p_data->>'contact',''),coalesce(p_data->>'audience',''),coalesce(p_data->>'proposal',''),coalesce(p_data->>'requested_support',''),coalesce(p_data->>'deliverables',''),coalesce(p_data->>'timing',''),coalesce(p_data->>'record_type','athlete'),coalesce(p_data->>'rate',''),case when coalesce(p_data->>'record_type','athlete')='athlete' then 'active' else 'pending' end,auth.uid(),nullif(p_data->>'reviewer_id','')::uuid) returning * into r;
 else
  select * into old from public.sponsorships where workspace_id=p_workspace and id=p_id for update;
  if not found then raise exception 'Proposal not found'; end if;
  if old.version is distinct from p_version then raise exception 'This proposal changed. Reload before saving.'; end if;
  r:=jsonb_populate_record(old,p_data); r.athlete_name:=btrim(r.athlete_name);
  if r.record_type is distinct from old.record_type then raise exception 'Record type cannot change'; end if;
  if r.reviewer_id is distinct from old.reviewer_id and old.created_by is distinct from auth.uid() and not exists(select 1 from public.workspaces where id=p_workspace and owner_id=auth.uid()) then raise exception 'Only the requester or workspace owner can change the approver'; end if;
  if r.record_type<>'athlete' and r.reviewer_id is null then raise exception 'Choose a teammate to approve this request'; end if;
  if row(r.athlete_name,r.sport,r.profile_url,r.contact,r.audience,r.proposal,r.requested_support,r.deliverables,r.timing,r.record_type,r.rate,r.reviewer_id) is not distinct from row(old.athlete_name,old.sport,old.profile_url,old.contact,old.audience,old.proposal,old.requested_support,old.deliverables,old.timing,old.record_type,old.rate,old.reviewer_id) then return old; end if;
  update public.sponsorships set athlete_name=r.athlete_name,sport=r.sport,profile_url=r.profile_url,contact=r.contact,audience=r.audience,proposal=r.proposal,requested_support=r.requested_support,deliverables=r.deliverables,timing=r.timing,rate=r.rate,reviewer_id=r.reviewer_id,status=case when old.record_type='athlete' then 'active' else 'pending' end,decided_by=null,decided_at=null,version=old.version+1,updated_at=now() where id=old.id returning * into r;
  if old.record_type<>'athlete' and (old.status<>'pending' or r.reviewer_id is distinct from old.reviewer_id) then
   insert into public.sponsorship_comments(workspace_id,sponsorship_id,author_id,author_name,body,action)
   select p_workspace,r.id,auth.uid(),name,case when r.reviewer_id is distinct from old.reviewer_id then 'Approver changed. A new decision is needed.' else 'Proposal changed. A new decision is needed.' end,'updated' from public.members where workspace_id=p_workspace and user_id=auth.uid();
  end if;
 end if;
 return r;
end; $$;

create or replace function public.review_sponsorship(p_id uuid,p_version integer,p_status text,p_comment text default '') returns public.sponsorships
language plpgsql security definer set search_path='' as $$
declare r public.sponsorships; reviewer uuid;
begin
 select * into r from public.sponsorships where id=p_id for update;
 if not found or public.member_role(r.workspace_id) is null then raise exception 'Workspace access required'; end if;
 if r.record_type='athlete' then raise exception 'Athletes do not require review'; end if;
 reviewer:=r.reviewer_id;
 if reviewer is null or reviewer is distinct from auth.uid() then raise exception 'Only the selected sponsorship reviewer can decide'; end if;
 if r.version is distinct from p_version then raise exception 'This proposal changed. Reload before deciding.'; end if;
 if p_status is null or p_status not in ('pending','approved','denied') then raise exception 'Invalid decision'; end if;
 if p_comment is null or length(p_comment)>4000 then raise exception 'Comment must be at most 4000 characters'; end if;
 update public.sponsorships set status=p_status,decided_by=case when p_status='pending' then null else auth.uid() end,decided_at=case when p_status='pending' then null else now() end,version=version+1,updated_at=now() where id=p_id returning * into r;
 insert into public.sponsorship_comments(workspace_id,sponsorship_id,author_id,author_name,body,action)
 select r.workspace_id,r.id,auth.uid(),name,btrim(p_comment),p_status from public.members where workspace_id=r.workspace_id and user_id=auth.uid();
 return r;
end; $$;

-- Preserve the authenticated RPC boundary on replacement functions.
revoke execute on function public.save_sponsorship(uuid,uuid,integer,jsonb),public.review_sponsorship(uuid,integer,text,text) from public,anon;
grant execute on function public.save_sponsorship(uuid,uuid,integer,jsonb),public.review_sponsorship(uuid,integer,text,text) to authenticated;

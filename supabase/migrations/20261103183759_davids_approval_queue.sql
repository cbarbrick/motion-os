-- Extend David's queue while keeping the active athlete roster distinct.
-- The existing authorized RPCs already create non-roster records as pending,
-- restrict decisions to the selected reviewer, and reopen changed proposals.
alter table public.sponsorships drop constraint sponsorships_record_type_check;
alter table public.sponsorships add constraint sponsorships_record_type_check
 check(record_type in ('athlete','affiliate','person','athlete_proposal','project','other'));
alter table public.sponsorships drop constraint sponsorships_status_check;
alter table public.sponsorships add constraint sponsorships_status_check check(
 (record_type='athlete' and status='active' and decided_by is null and decided_at is null)
 or (record_type in ('affiliate','person','athlete_proposal','project','other') and status in ('pending','approved','denied'))
);

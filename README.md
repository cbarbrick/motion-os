# Motion OS

Motion’s shared workspace for people, weekly deliverables, athletes, affiliate proposals, tasks people can claim, events with preparation and content tasks, ideas and private to-dos. The sibling `motion-os` commerce preview is separate.

## Develop together

This repository contains the `motion-team-os` application. See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and the branch/pull-request workflow. New contributors can run the app in sample mode without production credentials. GitHub access and live app membership are managed separately.

## Shared Motion OS Google Calendar, November 3, 2026

The Calendar page is a shared, editable Motion OS calendar. Every active workspace member can create and edit events through the existing authorized save RPC. The owner connects Google once to create a dedicated **Motion OS** secondary calendar. The previous Executive Assistant embed is removed; its events and sharing are not changed.

Owner setup: open Calendar, select **Connect Google Calendar**, use the same Google account as the workspace owner, and approve the `calendar.app.created` scope. This scope is limited to calendars created by this app. Normal team sign-in still requests only identity. A new member needs no separate Google Calendar grant to work through Motion OS. The owner’s **Open in Google** link is available after connection; direct access in Google itself is separate from OS membership.

Events save to Supabase first, then enter a durable sync queue in the same transaction. An immediate server request and a once-per-minute production worker copy titles, descriptions, locations, timed dates and exclusive all-day dates to Google. A stable Google event ID makes retries idempotent; leases and conditional updates prevent stale workers overwriting newer edits. Errors and pending sync are visible on Calendar. Existing workspace events are queued on connection. Tasks, private to-dos and sample data never sync. Guest IDs remain workspace labels and do not send Google invitations. This is OS-to-Google sync; edits made directly in Google are not imported.

Server credentials are configured for the production context and consumed only by Netlify functions: `CALENDAR_SUPABASE_URL`, `CALENDAR_SUPABASE_SECRET`, `CALENDAR_GOOGLE_CLIENT_ID`, `CALENDAR_GOOGLE_CLIENT_SECRET`, and a base64 32-byte `CALENDAR_ENCRYPTION_KEY`. The Google client must be the existing Supabase Google provider client, with Google Calendar API enabled. Refresh credentials are encrypted in the private `motion-google-calendar` Netlify Blobs store. Keep the encryption key stable across deploys. The current Netlify plan requires the default all-scopes setting; credentials are marked secret with values only in production, never prefixed with `VITE_`, and are not bundled into the frontend. Preview deploys and sample mode cannot use the production integration. No credentials belong in Git or browser builds.

Apply `20261103075717_google_calendar_sync.sql` before deploying. Public sync metadata has member-only RLS; worker RPCs are service-role-only. Only the workspace owner can start a connection, and the server verifies their current membership and matching Google identity. If a Google calendar creation request has an ambiguous network failure, a creation marker prevents duplicate calendars; inspect the owner’s Google account before clearing that marker.

Validation: 53 tests cover existing access behavior plus queue authorization, workspace isolation, updates during sync, retries without duplicates, all-day dates and credential encryption. Production build passes. The live sync endpoint rejects unauthenticated requests with HTTP 401. Hosted checks confirm member-only RLS and service-only worker RPCs; the security advisor reports no findings on the new calendar tables or functions. Browser checks cover the published connection state and sample event creation. On November 3, the owner approved Google access and Calendar API activation in `motion-os-512705`. The dedicated Motion OS calendar is connected; the existing event was backfilled and verified in Google Calendar. Hosted sync metadata confirms its saved version is fully synced, with zero pending events or errors. Live creation/backfill is verified; update/retry behavior is covered by automated tests. The owner link opens their Google Calendar account without trying to subscribe them to a calendar they already own.

## Simplified workspace update, October 27

Tasks is the first navigation item and the default landing view. My tasks, All tasks, person filters and Team week are in one place. The task list is vertical, includes all assigned people and supports checkoff, assignment and taking unassigned work. Task creation starts with title, people, due date and notes. Other saved fields remain under More details. People, athlete, affiliate, idea and private to-do forms also keep optional fields collapsed. Review cards use explicit Approve/Deny buttons with no sideways drag.

The calendar editor follows the core fields in [Google Calendar's event form](https://support.google.com/calendar/answer/72143?hl=en): title, start/end, all-day, guests, location and description. Guests are existing Motion workspace members, not external email invitations. Athlete links and content notes remain under More details. End dates, all-day events and guest IDs save through the existing authorized RPC. Multi-day events appear on every covered calendar day. All-day date boundaries are stored at UTC midnight with an exclusive end date. Existing event dates and notes are unchanged. Calendar sync, Google Meet, recurring events and reminder delivery are not added by this update.

All editors have a definite viewport-bounded height, a vertically scrolling body and a visible footer. Mobile editors use the full available viewport, stack inputs and use 16px input text. Checks cover a 1280px desktop, 390px mobile and 320px by 400px compact viewport; actual iPhone keyboard behavior still needs device acceptance. Published as Netlify deploy `6ae04571cc9d71e019166e02`. Hosted RPC create/edit checks passed inside a transaction and all test rows were rolled back. All 45 automated tests passed, including date boundaries, guest workspace isolation, optimistic versions, task notifications and saved sign-in.


## Live status, October 27, 2026

- Live at https://motion-team-os.netlify.app, using the official Motion wordmark, icons, Archivo fonts and cyan/charcoal palette from the provided Motion Assets.
- Google sign-in is connected to Supabase. Google Auth Platform is **External / In production**, with only `openid`, email and profile scopes. Personal and work Google accounts are permitted; workspace membership is enforced separately.
- Charlotte’s work Google account has signed in, created the Motion workspace, created and claimed the onboarding task, and saved notes. Signing out and returning through Google works. The shared-invitation join flow has been verified with this existing account.
- Workspace owner creates/copies an invitation from **Team & access**. Anyone with its active link can sign in and join as a member. All members can assign shared work, edit events and ideas, and check tasks Done. Ordinary tasks have no approval stage. Affiliates and potential hires have a separate designated reviewer. Athletes have no review stage.
- The owner can replace or disable the invite link and remove member access. A removed member cannot rejoin through the same or a new invite until the owner restores access using the `restore_workspace_access` RPC. This restore operation currently has no UI.
- Email/password, magic-link and password-reset interfaces are implemented but **disabled in the deployed app**. The user chose Google-only for now. Custom SMTP is not configured. Email confirmation remains enabled in Supabase; do not disable it to bypass email setup. No Resend account or integration was created.
- No teammate invitation messages were sent. The owner shares the link. No real coworker accounts or event schedules were fabricated. Sample data is explicitly marked and stays in that browser.

## October 27 update

- **Home-screen sign-in:** installed apps now prepare Google PKCE in their own storage, open a separate same-origin sign-in window, and receive the one-time code through a short-lived Netlify relay. The six-digit matching code makes the destination app explicit before continuing to Google. Safari never redeems the code with its unrelated storage. The installed app exchanges it using its original verifier and saves the session through Supabase. Reopening a pending login resumes it; reopening a completed login restores the saved session. Visibility, pageshow and reconnection also restore auth state. Explicit sign-out clears pending handoffs.
- The relay stores hashes of separate 256-bit read/write secrets and a PKCE code, never access/refresh tokens or PKCE verifiers. Requests require the same origin, have bounded JSON bodies, no-store responses, short expiry, immutable results and IP rate limits. Completed entries are deleted; an hourly function removes expired abandoned entries. Preview stores are separate from production. No database/auth permission or session-timeout settings were relaxed. Google callback remains the existing site origin.
- Published home-screen sign-in update: deploy `6ae040790321ad1acc4c2cb4`, including the three Netlify functions. Local and hosted relay checks verify create/poll/complete/cleanup, separate read/write authorization and cross-origin rejection. Reloading the live workspace preserves Charlotte’s existing sign-in. Browser checks verified the matching-code screen and reuse of a pending login after reload.
- Home-screen verification includes isolated-browser PKCE exchange with the real Supabase client and mocked auth transport, saved-session reopening/refresh/sign-out, code expiry/cancellation, wrong-secret and cross-origin rejection, callback validation, and pending-login reuse. An actual iPhone home-screen acceptance test remains necessary; desktop emulation cannot prove iOS window/storage behavior.

- **Roster and affiliates:** Athletes has no review status, reviewer selector or approval buttons. Existing athlete records migrated to Active while preserving profile IDs, notes, comments and event links. Steve was renamed SteveWillDoIt without changing his existing video deliverables. Added Tommy McMillen, Andy Glaze, Christine Ferea, Brendan Allen, Kai Kamaka III and Connor O’Sullivan from https://www.motionpouches.com/athletes, with public profile links and concise descriptions. No unverified fight dates, rates or commercial terms were added.
- **Affiliates** is a separate review queue with proposal details, rate/commission, comments, approval/denial cards, undo and saved decision filters. The database rejects review decisions on athletes and keeps affiliates out of athlete calendar selectors. David remains unassigned until he joins. No real affiliate proposals or decisions were fabricated.
- Published roster/affiliate update: deploy `6ae034adc5d8d0a9aa80e49e`. The live signed-in workspace shows seven active athletes, Steve’s original video notes, the separate Affiliates route, no athlete review controls and no Netlify badge. Reviewer remains unset.
- Roster verification covers migration preservation, active-on-create/edit, blocked athlete review, reviewer-only affiliate decisions, invalid type/status rejection and affiliate/calendar separation. Browser checks cover affiliate creation, approve, undo, deny, reload persistence, comment history, revised terms returning to Pending review, and athlete profiles without review controls.

- The Powered by Netlify badge is disabled in Project configuration > General. This is a project setting and applies to all visitors; no CSS workaround or redeploy is needed.

- **Task people and notifications:** add joined teammates under **People on this task**. Assigning an owner or adding a teammate saves one recipient-only alert with the signed-in sender and task. Self-assignment and ordinary edits send no alert. The notification bell shows unread counts, opens the task and marks it read; **Mark all read** is scoped to the current recipient/workspace. New incoming alerts show an in-app toast. Supabase Realtime refreshes on notification changes, with the existing 20-second/focus refresh as fallback. These are in-app alerts; push and email delivery are not configured. **Invite someone new** opens Team & access for sharing the workspace invite.
- Tasks appear in My week and Team week for their owner and added teammates. Removing workspace access removes that person’s task participation and notifications. Existing tasks are preserved and do not generate retroactive alerts.
- Direct page titles, bold text, higher contrast and larger form controls. Removed slogans and em dashes from app copy.
- Fixed sample navigation: only a new `#join=` fragment triggers invitation handling. A stored invitation no longer exits sample mode on each route. **View sample** and **Return to workspace** preserve the current Google session; actual sign-out is separate.
- **Athletes** shows upcoming fights and events. Add an event from the profile or select its athlete in **Calendar**. These are the same saved event records, so edits appear in both places. Event type, date, location and **Content needed** autosave. Existing event content/preparation tasks remain linked. Calendar filters by athlete and Fight/Event.
- **People** stores name, role, description, rate, portfolio/contact, scope and availability. The selected reviewer uses swipe right/left or explicit Approve/Deny buttons, optional decision notes, Skip and Undo. **All people** filters saved decisions. The same owner-selected reviewer handles affiliates and people. No decision is automated; no emails or offers are sent.
- New fields are backward compatible. Existing records default to athlete/event. A profile cannot change type after creation, and calendar athlete links require an athlete in the same workspace.
- Browser verification covers the pending-invitation navigation regression, person creation, swipe approval, undo, denial, event creation, date changes, content notes, calendar filtering and mobile swipe advance to the next candidate. Sample records remain local. Hosted transaction tests were rolled back. The published app was checked with Charlotte’s signed-in account: enter sample, navigate People/Athletes/Calendar, reload, return to the live workspace with the original Google session intact. Production HTML, service worker, manifest and offline page match the final local build. Task invitations and notifications were published in deploy `6ae03272461744f989a4de98`; live checks verified the bell, inbox, task people picker and Invite someone new navigation while preserving the signed-in account. Incoming-toast behavior was checked with local sample data.

## Resources to reuse

- [Netlify project](https://app.netlify.com/projects/motion-team-os): `076a97b9-2021-4a62-b1a5-3d39f1e05a4b`.
- [Supabase project](https://supabase.com/dashboard/project/morugcmqedreoyawlept): `morugcmqedreoyawlept`, Motion OS in cbarbrick’s Org, US East.
- [Google Auth Platform](https://console.cloud.google.com/auth/overview?project=motion-os-512705): `motion-os-512705`, under the user-confirmed `cbdplususa.com` organization. Support/contact: `char@motionbrand.com`.
- Google OAuth client: Motion OS Web. JavaScript origin `https://motion-team-os.netlify.app`; callback `https://morugcmqedreoyawlept.supabase.co/auth/v1/callback`.
- Supabase Site URL and allowed return URL: `https://motion-team-os.netlify.app`. Localhost is not allowlisted.
- Google client secret is stored in Supabase’s provider configuration and the production Netlify function secret used for calendar token refresh. It is never included in frontend variables or Git.

## Run and deploy

```sh
npm install
npm run dev
npm test
npm run build
node --env-file=.env.local tests/live-access.mjs
npx netlify-cli deploy --site 076a97b9-2021-4a62-b1a5-3d39f1e05a4b --dir dist --prod --no-build
```

`.env.local` contains only the project URL, publishable browser key and auth feature flags. Both it and `.netlify/` are ignored. Never put a service-role key or OAuth secret in a `VITE_` variable. Current flags: `VITE_GOOGLE_AUTH_ENABLED=true`, `VITE_EMAIL_AUTH_ENABLED=false`. There is no Git continuous deployment attached. Manual deploys are atomic.

## Workflow and saving

1. Post a task with its brief, deadline, priority and optional definition of done. Assign any teammate or leave it open for someone to claim.
2. Claims are exclusive at the database. Any member can assign/reassign shared tasks and edit shared records.
3. **Team week** groups tasks under their owner and each added teammate, plus unassigned work for the chosen week. Tasks appear by their explicit Monday week start, or by due date when no week is set. An explicit week takes precedence. Navigate between weeks, add a task directly under a teammate, and check completed work off there. Undated/unplanned tasks link back to the task board. Private to-dos stay out of this view.
4. Link tasks to events. The Content board shows the same task records, filtered by Content category. Event detail shows linked preparation and content deliverables.
5. Check off finished work directly. Notes and HTTPS deliverable links are optional. Uncheck to reopen. States are Open, In progress and Done.
6. Ideas use Inbox, Planned and Archived. Personal to-dos are private to their creator, including from workspace owners through the app.
7. **Athletes** is the current roster. New athletes are active immediately, with no approval controls. Profiles, comments, deliverables and linked calendar events remain editable. **Affiliates** stores proposed partners, category, rate/commission, description, deliverables and dates. Any member can submit, edit and comment. The owner selects a reviewer from joined members. Only that reviewer can approve, deny or reopen affiliate and potential-hire proposals. Decisions and comments retain their authenticated author and date. Editing reviewed terms returns the proposal to Pending review and preserves prior decisions in history.

**David setup:** his email is not yet known and he has not joined. No live reviewer is selected. After David joins through the workspace invite, choose him under **Affiliates → Reviewer**. Proposals and comments can be saved before then.

Existing records autosave after 800 ms or when the editor closes. New records stay as device drafts until Create is clicked. The interface displays draft/saving/saved/error states. Optimistic versions reject stale edits; conflict drafts can be downloaded before reloading. Workspace data refreshes on focus and every 20 seconds. This is not simultaneous document editing or offline synchronization.

Invitation tokens are random UUIDs in URL fragments, which are not sent as request paths or referrers. Pending invitations are stored locally for seven days so a Google return can resume joining, then cleared on acceptance or cancellation. The database checks enabled tokens and revocations; membership is never inferred from email domains or user-editable metadata.

## Database and verification

All six migrations under `supabase/migrations/` have been applied. Do not edit applied migrations; append new ones. All writes use explicitly authorized SQL RPCs. Reads use RLS. Direct writes and anonymous RPC execution are denied.

Thirty-nine tests (29 PGlite/PostgreSQL workflow/security/migration tests, seven home-screen auth tests and three planning/model tests) cover invite permissions, external-domain joining, idempotent joining, token rotation/disable, atomic claims, shared assignment/completion, stale edits, rejection of the legacy Review state, private to-dos, cross-workspace isolation, and revocation/restore including legacy email grants. Sponsorship checks cover reviewer-only decisions, owner-only reviewer selection, authenticated comment attribution, stale edits, decision reset on changed details, direct-write denial, workspace isolation and removal of reviewer access. Weekly tests cover Monday/Sunday boundaries, year transitions and explicit-week precedence. Hosted anonymous checks deny reads on all eleven tables and deny create/join, all four sponsorship RPCs and the notification-read RPC.

Browser verification covers official desktop/mobile branding, task checkoff moving a card to Done, Google sign-in after making the audience external, invitation capture and joining, cloud workspace creation, task creation/claiming, autosave, event linkage and sample persistence. New-feature checks cover grouped weekly tasks, week navigation, prefilled assignment/week, sponsorship creation, approval, comments, changed-detail review reset, denial, reload persistence and mobile layouts. A transaction against hosted Supabase also verified proposal creation, reviewer selection, approval, comment attribution and changed-detail reset, then rolled back all test records. Task-notification checks cover multi-recipient additions, attribution, owner assignment, no self-alerts, duplicate suppression, read state, forged-write denial, private to-dos and membership removal. Browser checks cover notification opening/read persistence, task additions, weekly placement and the 390px mobile layout. A hosted transaction checked collaborator storage and the notification-read RPC, then rolled back. A second real account and installation on an actual phone still need a teammate’s acceptance test; Charlotte’s personal Google account was signed out, and no other person’s account was used.

Supabase advisors identify intentional SECURITY DEFINER RPCs and two internal tables with RLS but no direct-access policies. Both tables have all client privileges revoked; they are accessed only through authorized RPCs. See [RPC advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [RLS advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Leaked-password protection is disabled; review [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) if email accounts are launched.

## Home-screen app

Safari: **Share → Add to Home Screen**. Chrome on Android: **menu → Install app / Add to Home screen**. The manifest includes the official Motion icons. The service worker caches only an offline message and icon, never private records, API responses or tokens. Shared work requires a connection.

## Deferred work

For email/password accounts, first connect a verified email sender in Supabase Auth SMTP, verify confirmation/reset delivery to a non-team address, then enable the email build flag and redeploy. [Supabase SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp). Motion’s current public DNS points to Google Workspace mail and GoDaddy DNS; this is not proof of a configured transactional sender.

After the team tries the core workflow: comments/mentions on ordinary tasks, recurring deliverables, event templates, push/email notifications, file uploads, content publish channels, calendar integrations and scheduled backups/restore testing. Current deliverables use links and notes. JSON export is an extra copy, not a database backup. OS-to-Google calendar syncing is implemented above; reminder emails are not connected.

# Working on Motion OS together

## Local setup

Use Node.js 22.12 or newer and npm. The repository is public; collaborators must accept their GitHub invitation before pushing branches to it:

```sh
git clone https://github.com/cbarbrick/motion-os.git
cd motion-os
npm ci
cp .env.example .env.local
npm run dev
```

Open the local URL printed by Vite. With the example environment values left blank, choose **View sample** to develop the interface using browser-only sample data. This is enough to work on layouts and most interaction flows. Your local edits to sample records do not change the live workspace.

The Calendar page uses native Day, Week and Month views of shared workspace events, including events linked to athletes. Sample calendar records stay in the browser and never sync to Google. Any active workspace member can add or edit events. Production retains an optional owner-connected Google calendar; server sync does not control whether saved Motion events appear. See README.md for the production-only connection and queue. Keep credentials out of local frontend variables and Git.

Connected sign-in and database work need separate environment configuration and authorized access. Coordinate that with Charlotte before using live resources. Localhost is not currently an allowed authentication redirect. Reuse the resources documented in README.md; do not create replacement production projects.

## Work on separate branches

Start each change from the latest main branch:

```sh
git switch main
git pull --ff-only
git switch -c codex/describe-your-change
```

Use a unique branch name for each piece of work. Agree on who is changing which feature, especially when working on the same files. Each person can use their own editor or AI coding assistant in their own checkout.

Before submitting a change:

```sh
npm test
npm run build
git status
git add <files-you-changed>
git commit -m "Describe the change"
git push -u origin HEAD
```

Open a pull request targeting `main`, explain what changed and how you checked it, and ask the other person to review it. Resolve any merge conflicts and rerun affected checks before merging. After a pull request merges, both contributors should pull the updated `main` before starting their next branch. These are team conventions; branch protection is not configured by this guide.

## Project boundaries

- Read AGENTS.md before making changes. Preserve workspace isolation, private to-dos, role checks, atomic claims, and optimistic edit versions.
- Keep `.env.local`, credentials, `.netlify/`, generated output and local caches out of commits. `.env.example` contains placeholders only.
- Add new database migrations rather than editing migrations that were already applied. Run the database tests for database changes.
- GitHub repository access does not grant access to the live Motion workspace, Netlify or Supabase administration.
- Publishing remains a separate manual step using the existing Netlify project. Coordinate releases with Charlotte. Pushing or merging code does not automatically deploy the live app.

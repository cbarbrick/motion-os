# Motion OS

Mobile is the primary user experience. For UI changes, verify phone layouts at 320, 375, 390 and 430 CSS pixels, including native date/select controls, touch targets, Day/Week/Month views and the event editor when affected. Check for overlapping controls and page overflow; desktop screenshots alone are not sufficient. Distinguish browser viewport checks from testing on a physical iPhone.

Use the existing Vercel and Supabase resources documented in README.md; do not create duplicates. The user authorized migrating Motion OS from Netlify to Vercel. Preserve the sibling motion-os commerce preview. Never expose Supabase service-role credentials in browser code. App data lives in Supabase; browser sample mode must stay explicitly labeled.

All application writes go through authorized SQL RPCs. Preserve RLS, strict workspace isolation, private todos, atomic task claims, role checks and optimistic versions. Applied database migrations are immutable: append changes under supabase/migrations. Run npm test for database changes and npm run build for app changes. Keep .env.local, .vercel/ and .netlify/ ignored. Account rollout is incomplete until auth redirect URLs, email delivery and a real two-account test are verified.

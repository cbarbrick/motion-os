# Motion OS

Use the existing Netlify and Supabase resources documented in README.md; do not create duplicates. Preserve the sibling motion-os commerce preview. Never expose Supabase service-role credentials in browser code. App data lives in Supabase; browser sample mode must stay explicitly labeled.

All application writes go through authorized SQL RPCs. Preserve RLS, strict workspace isolation, private todos, atomic task claims, role checks and optimistic versions. Applied database migrations are immutable: append changes under supabase/migrations. Run npm test for database changes and npm run build for app changes. Keep .env.local and .netlify/ ignored. Account rollout is incomplete until auth redirect URLs, email delivery and a real two-account test are verified.

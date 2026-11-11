// Supabase emits provider credentials once at sign-in; getSession() may omit
// them. Keep the refresh credential in memory until the calendar handoff ends.
// Never persist this credential in browser storage.
type ProviderSession = {
  user: { id: string };
  provider_refresh_token?: string | null;
};
let pending: { user: string; token: string; expires: number } | null = null;
export function captureGoogleToken(
  session: ProviderSession | null,
  now = Date.now(),
) {
  if (!session || (pending && pending.user !== session.user.id)) pending = null;
  if (session?.provider_refresh_token)
    pending = {
      user: session.user.id,
      token: session.provider_refresh_token,
      expires: now + 15 * 60_000,
    };
}
export function googleRefreshToken(user: string, now = Date.now()) {
  if (pending && pending.expires <= now) pending = null;
  return pending?.user === user ? pending.token : null;
}
export function clearGoogleToken() {
  pending = null;
}

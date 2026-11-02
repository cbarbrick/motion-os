export function invitationFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("join");
  return token &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      token,
    )
    ? token
    : null;
}

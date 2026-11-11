// Persist the exact request before sending it so a lost response can be retried
// without creating another record or applying an update twice.
export type PendingSave<T> = { request: string; input: T };
export function beginSave<T>(
  pending: PendingSave<T> | null,
  input: T,
): PendingSave<T> {
  return (
    pending || { request: crypto.randomUUID(), input: structuredClone(input) }
  );
}
export function readPendingSave<T>(value: unknown): PendingSave<T> | null {
  const pending = value as PendingSave<T> | null;
  return pending &&
    typeof pending.request === "string" &&
    /^[0-9a-f-]{36}$/i.test(pending.request) &&
    pending.input &&
    typeof pending.input === "object"
    ? pending
    : null;
}
export function rejectedSave(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  // An explicit database/API rejection cannot have committed. Network failures
  // are ambiguous, so retain their request identity for a safe replay.
  return (
    typeof code === "string" &&
    (/^[0-9A-Z]{5}$/.test(code) || /^PGRST\d+$/.test(code))
  );
}

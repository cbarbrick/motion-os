import { supabase } from "./client";
export type { CalendarSync, CalendarConnection } from "./calendar-feed";
export const pendingCalendarKey = "motion-calendar-connect";
export async function calendarAction(
  action: "connect" | "sync" | "events",
  workspace: string,
  extra: Record<string, unknown> = {},
) {
  const { data } = await supabase!.auth.getSession();
  if (!data.session) throw new Error("Sign in again.");
  const response = await fetch(`/.netlify/functions/calendar-${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify({ workspace, ...extra }),
    signal: AbortSignal.timeout(55000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Calendar sync is unavailable.");
  return result;
}
export function kickCalendarSync(workspace: string) {
  // The SQL queue is durable. A missed browser request is retried by the worker.
  void calendarAction("sync", workspace)
    .then(() => window.dispatchEvent(new Event("motion-calendar-updated")))
    .catch(() => {});
}

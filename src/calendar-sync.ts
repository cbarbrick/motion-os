import { supabase } from "./client";
export type CalendarSync = {
  item_id: string;
  requested_version: number;
  synced_version: number;
  last_error: string | null;
};
export type CalendarConnection = { calendar_id: string; connected_by: string };
export const pendingCalendarKey = "motion-calendar-connect";
export async function calendarAction(
  action: "connect" | "sync",
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
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Calendar sync is unavailable.");
  return result;
}
export function kickCalendarSync(workspace: string) {
  // The SQL queue is durable. A missed browser request is retried by the worker.
  void calendarAction("sync", workspace).catch(() => {});
}

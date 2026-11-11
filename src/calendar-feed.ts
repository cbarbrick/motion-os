import type { Item } from "./model";

export type CalendarSync = {
  item_id: string;
  requested_version: number;
  synced_version: number;
  last_error: string | null;
};
export type CalendarConnection = { calendar_id: string; connected_by: string };
export type GoogleEvent = {
  id: string;
  title: string;
  description: string;
  location: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  motion_item: string | null;
  motion_version: number;
};
export type CalendarFeed = {
  connection: CalendarConnection | null;
  events: GoogleEvent[];
  sync: CalendarSync[];
  range_start: string;
  range_end: string;
  fetched_at: string;
};
export type CalendarEntry = Pick<
  GoogleEvent,
  "title" | "description" | "location" | "starts_at" | "all_day"
> & {
  id: string;
  ends_at: string | null;
  item: Item | null;
  google: boolean;
  pending: boolean;
};

// Motion events are authoritative and never disappear because of Google sync.
// Google-only events remain available as read-only additions to the calendar.
export function calendarEntries(
  items: Item[],
  feed: CalendarFeed | null,
): CalendarEntry[] {
  const local = items.filter((i) => i.kind === "event" && i.starts_at);
  const ids = new Set(local.map((i) => i.id));
  const entries: CalendarEntry[] = local.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    location: item.location,
    starts_at: item.starts_at!,
    ends_at: item.ends_at,
    all_day: item.all_day,
    item,
    google: false,
    pending:
      !!feed?.connection &&
      !feed.sync.some(
        (s) => s.item_id === item.id && s.synced_version >= item.version,
      ),
  }));
  for (const remote of feed?.events || []) {
    if (remote.motion_item && ids.has(remote.motion_item)) continue;
    entries.push({
      ...remote,
      id: `google:${remote.id}`,
      item: null,
      google: true,
      pending: false,
    });
  }
  return entries.sort(
    (a, b) =>
      Date.parse(a.starts_at) - Date.parse(b.starts_at) ||
      a.id.localeCompare(b.id),
  );
}

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

// Google is the display source after a successful read. Unsynced OS edits take
// precedence until Google reports the corresponding version, without duplicates.
export function calendarEntries(
  items: Item[],
  feed: CalendarFeed | null,
): CalendarEntry[] {
  const local = new Map(
    items
      .filter((i) => i.kind === "event" && i.starts_at)
      .map((i) => [i.id, i]),
  );
  const entries: CalendarEntry[] = [];
  const addLocal = (item: Item, pending: boolean): CalendarEntry => ({
    id: item.id,
    title: item.title,
    description: item.description,
    location: item.location,
    starts_at: item.starts_at!,
    ends_at: item.ends_at,
    all_day: item.all_day,
    item,
    google: false,
    pending,
  });
  const byStart = (a: CalendarEntry, b: CalendarEntry) =>
    Date.parse(a.starts_at) - Date.parse(b.starts_at) ||
    a.id.localeCompare(b.id);
  if (!feed?.connection)
    return [...local.values()].map((i) => addLocal(i, false)).sort(byStart);
  const seen = new Set<string>();
  for (const remote of feed.events) {
    const item = remote.motion_item ? local.get(remote.motion_item) : undefined;
    if (item && remote.motion_version < item.version) {
      if (!seen.has(item.id)) entries.push(addLocal(item, true));
      seen.add(item.id);
      continue;
    }
    if (item) seen.add(item.id);
    const fields = {
      title: remote.title,
      description: remote.description,
      location: remote.location,
      starts_at: remote.starts_at,
      ends_at: remote.ends_at,
      all_day: remote.all_day,
    };
    entries.push({
      ...fields,
      id: `google:${remote.id}`,
      item: item ? { ...item, ...fields } : null,
      google: true,
      pending: false,
    });
  }
  for (const item of local.values()) {
    if (seen.has(item.id)) continue;
    const synced = feed.sync.find((s) => s.item_id === item.id);
    // An event already synced but absent from this Google range was moved or
    // deleted in Google. Do not resurrect its old local copy.
    if (!synced || synced.synced_version < item.version)
      entries.push(addLocal(item, true));
  }
  return entries.sort(byStart);
}

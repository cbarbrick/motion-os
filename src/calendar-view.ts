import { addDays, localDate, weekStart, type ItemInput } from "./model";
import { eventOnDay, eventStartDay, eventEndDay } from "./event-time";
import type { CalendarEntry } from "./calendar-feed";

export type CalendarView = "day" | "week" | "month";

export function calendarDays(date: string, view: CalendarView) {
  const anchor = new Date(`${date}T12:00:00`);
  const first =
    view === "month"
      ? weekStart(new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12))
      : view === "week"
        ? weekStart(anchor)
        : date;
  return Array.from(
    { length: view === "month" ? 42 : view === "week" ? 7 : 1 },
    (_, i) => addDays(first, i),
  );
}

export function moveCalendarDate(
  date: string,
  view: CalendarView,
  direction: number,
) {
  if (view !== "month")
    return addDays(date, direction * (view === "week" ? 7 : 1));
  const anchor = new Date(`${date}T12:00:00`);
  const target = new Date(
    anchor.getFullYear(),
    anchor.getMonth() + direction,
    1,
    12,
  );
  const last = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  target.setDate(Math.min(anchor.getDate(), last));
  return localDate(target);
}

export function newCalendarEvent(
  day: string,
  hour = 9,
  allDay = false,
): Partial<ItemInput> {
  const start = new Date(`${day}T00:00:00`);
  start.setHours(hour);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    starts_at: allDay ? `${day}T00:00:00.000Z` : start.toISOString(),
    ends_at: allDay ? `${addDays(day, 1)}T00:00:00.000Z` : end.toISOString(),
    all_day: allDay,
  };
}

// Each day uses wall-clock minutes, so local dates stay correct across DST.
// Overlapping events get separate columns; short events still have a tap target.
export function timedEvents(entries: CalendarEntry[], day: string) {
  const minutes = (iso: string) => {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  };
  const segments = entries
    .filter((e) => !e.all_day && eventOnDay(e, day))
    .map((event) => {
      const start = eventStartDay(event) < day ? 0 : minutes(event.starts_at);
      const end = !event.ends_at
        ? start + 60
        : eventEndDay(event) > day ||
            (event.ends_at && localDate(new Date(event.ends_at)) > day)
          ? 1440
          : minutes(event.ends_at);
      return {
        event,
        start,
        end: Math.min(1440, Math.max(end, start + 30)),
        column: 0,
        columns: 1,
      };
    })
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.end - a.end ||
        a.event.id.localeCompare(b.event.id),
    );
  let group: typeof segments = [],
    groupEnd = -1;
  const finish = () => {
    const columns = Math.max(1, ...group.map((s) => s.column + 1));
    group.forEach((s) => {
      s.columns = columns;
    });
  };
  for (const segment of segments) {
    if (segment.start >= groupEnd) {
      finish();
      group = [];
      groupEnd = -1;
    }
    const used = new Set(
      group.filter((s) => s.end > segment.start).map((s) => s.column),
    );
    while (used.has(segment.column)) segment.column++;
    group.push(segment);
    groupEnd = Math.max(groupEnd, segment.end);
  }
  finish();
  return segments;
}

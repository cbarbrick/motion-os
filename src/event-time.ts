import { addDays, localDate, type ItemInput } from "./model";

type EventTime = Pick<ItemInput, "starts_at" | "ends_at" | "all_day">;
export function eventStartDay(event: EventTime) {
  if (!event.starts_at) return "";
  return event.all_day
    ? event.starts_at.slice(0, 10)
    : localDate(new Date(event.starts_at));
}
// All-day end dates are exclusive, matching Google Calendar's date convention.
export function eventEndDay(event: EventTime) {
  if (!event.ends_at) return eventStartDay(event);
  return event.all_day
    ? addDays(event.ends_at.slice(0, 10), -1)
    : localDate(new Date(new Date(event.ends_at).getTime() - 1));
}
export function eventOnDay(event: EventTime, day: string) {
  return eventStartDay(event) <= day && eventEndDay(event) >= day;
}
export function eventTimeLabel(event: EventTime) {
  if (event.all_day) return "All day";
  if (!event.starts_at) return "";
  const time = (value: string) =>
    new Date(value).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  return event.ends_at
    ? `${time(event.starts_at)} to ${time(event.ends_at)}`
    : time(event.starts_at);
}
export function localDateTime(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

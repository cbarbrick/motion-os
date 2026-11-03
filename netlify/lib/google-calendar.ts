import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Item } from "../../src/model";
export const googleScope =
  "https://www.googleapis.com/auth/calendar.app.created";
const base = "https://www.googleapis.com/calendar/v3";
export class CalendarError extends Error {
  constructor(
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}
export function seal(value: unknown, secret: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(secret, "base64"), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((v) => v.toString("base64"))
    .join(".");
}
export function unseal<T>(value: string, secret: string): T {
  const [iv, tag, ciphertext] = value
    .split(".")
    .map((v) => Buffer.from(v, "base64"));
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(secret, "base64"),
    iv,
  );
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    ),
  );
}
export async function refreshGoogle(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  fetcher = fetch,
): Promise<string> {
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token)
    throw new CalendarError(
      "Google connection expired or unavailable. The workspace owner can reconnect it.",
    );
  return data.access_token;
}
export async function googleRequest(
  token: string,
  path: string,
  init: RequestInit = {},
  fetcher = fetch,
) {
  return fetcher(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(10000),
  });
}
export function googleEvent(item: Item) {
  if (!item.starts_at)
    throw new CalendarError("Add a start date to this event.", 400);
  const end =
    item.ends_at ||
    new Date(
      new Date(item.starts_at).getTime() + (item.all_day ? 86400000 : 3600000),
    ).toISOString();
  if (!(new Date(end) > new Date(item.starts_at)))
    throw new CalendarError("The event end must follow its start.", 400);
  const date = (value: string) =>
    item.all_day
      ? { date: value.slice(0, 10) }
      : { dateTime: value, timeZone: "America/New_York" };
  return {
    summary: item.title,
    description: item.description,
    location: item.location,
    start: date(item.starts_at),
    end: date(end),
    extendedProperties: {
      private: {
        motionWorkspace: item.workspace_id,
        motionItem: item.id,
        motionVersion: String(item.version),
      },
    },
  };
}
export const googleEventId = (id: string) => `motion${id.replaceAll("-", "")}`;
export async function syncGoogleEvent(
  token: string,
  calendarId: string,
  item: Item,
  fetcher = fetch,
) {
  const path = `/calendars/${encodeURIComponent(calendarId)}/events`,
    id = googleEventId(item.id);
  const body = googleEvent(item);
  // Read + conditional patch prevents an expired worker overwriting a newer version.
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await googleRequest(token, `${path}/${id}`, {}, fetcher);
    let response: Response;
    if (existing.status === 404) {
      response = await googleRequest(
        token,
        `${path}?sendUpdates=none`,
        { method: "POST", body: JSON.stringify({ ...body, id }) },
        fetcher,
      );
      if (response.status === 409) continue; // Same stable ID already inserted by a retry.
    } else if (existing.ok) {
      const current = await existing.json();
      if (current.status === "cancelled")
        throw new CalendarError(
          "This event was deleted in Google Calendar. Create a new event in Motion OS to restore it.",
        );
      if (
        current.extendedProperties?.private?.motionItem !== item.id ||
        current.extendedProperties?.private?.motionWorkspace !==
          item.workspace_id
      )
        throw new CalendarError(
          "Google event does not match this workspace. Contact the workspace owner.",
        );
      if (
        Number(current.extendedProperties?.private?.motionVersion) >=
        item.version
      )
        return;
      response = await googleRequest(
        token,
        `${path}/${id}?sendUpdates=none`,
        {
          method: "PATCH",
          headers: { "If-Match": current.etag },
          body: JSON.stringify(body),
        },
        fetcher,
      );
      if (response.status === 412) continue;
    } else response = existing;
    if (response.ok) return;
    if (response.status === 401 || response.status === 403)
      throw new CalendarError(
        "Google access is unavailable. The workspace owner can reconnect the calendar.",
      );
    if (response.status === 429 || response.status >= 500)
      throw new CalendarError(
        "Google is temporarily unavailable. Motion OS will retry automatically.",
      );
    throw new CalendarError(
      "Google could not save this event. Check its dates and reconnect if needed.",
    );
  }
  throw new CalendarError(
    "Calendar changed during sync. Motion OS will retry automatically.",
  );
}

export function calendarRange(start: unknown, end: unknown) {
  const stamp = (v: unknown) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(v) &&
    Number.isFinite(Date.parse(v));
  if (
    !stamp(start) ||
    !stamp(end) ||
    Date.parse(end as string) <= Date.parse(start as string) ||
    Date.parse(end as string) - Date.parse(start as string) > 62 * 86400000
  )
    throw new CalendarError(
      "Choose a calendar range of up to two months.",
      400,
    );
  return {
    start: new Date(start as string).toISOString(),
    end: new Date(end as string).toISOString(),
  };
}

export async function listGoogleEvents(
  token: string,
  calendarId: string,
  workspace: string,
  start: string,
  end: string,
  fetcher = fetch,
) {
  const range = calendarRange(start, end);
  const events: import("../../src/calendar-feed").GoogleEvent[] = [];
  let page: string | undefined;
  const seenPages = new Set<string>();
  for (let count = 0; count < 10; count++) {
    const query = new URLSearchParams({
      timeMin: range.start,
      timeMax: range.end,
      singleEvents: "true",
      orderBy: "startTime",
      showDeleted: "false",
      maxResults: "1000",
      fields:
        "nextPageToken,items(id,status,summary,description,location,start,end,recurringEventId,extendedProperties/private)",
    });
    if (page) query.set("pageToken", page);
    const response = await googleRequest(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events?${query}`,
      {},
      fetcher,
    );
    if (!response.ok)
      throw new CalendarError(
        response.status === 401 || response.status === 403
          ? "Google access is unavailable. The workspace owner can reconnect the calendar."
          : "Google Calendar could not be loaded. Try refreshing again.",
      );
    const data = await response.json();
    if (!data || (data.items !== undefined && !Array.isArray(data.items)))
      throw new CalendarError(
        "Google returned an incomplete calendar. Try refreshing again.",
      );
    for (const event of data.items || []) {
      if (event.status === "cancelled") continue;
      const allDay = !!event.start?.date;
      const from = allDay
        ? `${event.start.date}T00:00:00.000Z`
        : event.start?.dateTime;
      const to = allDay
        ? `${event.end?.date}T00:00:00.000Z`
        : event.end?.dateTime;
      if (
        !event.id ||
        !from ||
        !to ||
        !Number.isFinite(Date.parse(from)) ||
        !Number.isFinite(Date.parse(to))
      )
        throw new CalendarError(
          "A Google event has invalid dates. Refresh or check it in Google Calendar.",
        );
      const meta = event.extendedProperties?.private;
      const linked =
        !event.recurringEventId &&
        meta?.motionWorkspace === workspace &&
        /^[0-9a-f-]{36}$/i.test(meta.motionItem || "");
      events.push({
        id: event.id,
        title: event.summary || "Untitled event",
        description: event.description || "",
        location: event.location || "",
        starts_at: from,
        ends_at: to,
        all_day: allDay,
        motion_item: linked ? meta.motionItem : null,
        motion_version:
          linked && Number.isFinite(Number(meta.motionVersion))
            ? Number(meta.motionVersion)
            : 0,
      });
    }
    page = data.nextPageToken;
    if (!page) return events;
    if (seenPages.has(page)) break;
    seenPages.add(page);
  }
  throw new CalendarError(
    "This date range has too many events to load completely. Try a smaller range.",
  );
}

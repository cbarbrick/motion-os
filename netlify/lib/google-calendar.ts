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

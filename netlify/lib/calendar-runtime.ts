import { createClient } from "@supabase/supabase-js";
import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import {
  CalendarError,
  googleRequest,
  refreshGoogle,
  seal,
  unseal,
  syncGoogleEvent,
  calendarRange,
  listGoogleEvents,
} from "./google-calendar";
import type { Item } from "../../src/model";
const env = (key: string) => Netlify.env.get(key) || "";
export function runtime(context: Context) {
  if (context.deploy.context !== "production")
    throw new CalendarError(
      "Google syncing is available on the production site only.",
      403,
    );
  const url = env("CALENDAR_SUPABASE_URL"),
    key = env("CALENDAR_SUPABASE_SECRET");
  if (
    !url ||
    !key ||
    !env("CALENDAR_GOOGLE_CLIENT_ID") ||
    !env("CALENDAR_GOOGLE_CLIENT_SECRET") ||
    !env("CALENDAR_ENCRYPTION_KEY")
  )
    throw new CalendarError(
      "Google Calendar setup is not ready. Contact the workspace owner.",
    );
  return {
    db: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    blobs: getStore({ name: "motion-google-calendar", consistency: "strong" }),
    encryption: env("CALENDAR_ENCRYPTION_KEY"),
    clientId: env("CALENDAR_GOOGLE_CLIENT_ID"),
    clientSecret: env("CALENDAR_GOOGLE_CLIENT_SECRET"),
  };
}
type Runtime = ReturnType<typeof runtime>;
type Connection = { refreshToken: string; calendarId: string; owner: string };
export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
export function failure(error: unknown) {
  return json(
    {
      error:
        error instanceof CalendarError
          ? error.message
          : "Calendar sync is unavailable. Your events remain saved in Motion OS.",
    },
    error instanceof CalendarError ? error.status : 503,
  );
}
export async function authorize(
  request: Request,
  rt: Runtime,
  workspace: string,
  ownerOnly = false,
) {
  if (request.method !== "POST") throw new CalendarError("Use POST.", 405);
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new CalendarError("Open this action from Motion OS.", 403);
  if (!/^[0-9a-f-]{36}$/i.test(workspace))
    throw new CalendarError("Choose a workspace.", 400);
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new CalendarError("Sign in first.", 401);
  const { data, error } = await rt.db.auth.getUser(token);
  if (error || !data.user) throw new CalendarError("Sign in again.", 401);
  const member = await rt.db
    .from("members")
    .select("user_id")
    .eq("workspace_id", workspace)
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (member.error || !member.data)
    throw new CalendarError("Workspace access required.", 403);
  const w = await rt.db
    .from("workspaces")
    .select("name,owner_id")
    .eq("id", workspace)
    .single();
  if (w.error || (ownerOnly && w.data.owner_id !== data.user.id))
    throw new CalendarError(
      "Only the workspace owner can connect Google Calendar.",
      403,
    );
  return { user: data.user, workspace: w.data };
}
async function connection(rt: Runtime, workspace: string) {
  const value = await rt.blobs.get(`connection/${workspace}`, { type: "text" });
  return value ? unseal<Connection>(value, rt.encryption) : null;
}
export async function readCalendar(
  rt: Runtime,
  workspace: string,
  start: unknown,
  end: unknown,
) {
  const range = calendarRange(start, end);
  const [registered, sync] = await Promise.all([
    rt.db
      .from("calendar_connections")
      .select("calendar_id,connected_by")
      .eq("workspace_id", workspace)
      .maybeSingle(),
    rt.db
      .from("calendar_sync")
      .select("item_id,requested_version,synced_version,last_error")
      .eq("workspace_id", workspace),
  ]);
  if (registered.error || sync.error)
    throw new CalendarError(
      "Could not read the calendar connection. Try refreshing again.",
    );
  const result: import("../../src/calendar-feed").CalendarFeed = {
    connection: registered.data,
    sync: sync.data || [],
    events: [],
    range_start: range.start,
    range_end: range.end,
    fetched_at: new Date().toISOString(),
  };
  if (!registered.data) return result;
  const saved = await connection(rt, workspace);
  if (
    !saved ||
    saved.calendarId !== registered.data.calendar_id ||
    saved.owner !== registered.data.connected_by
  )
    throw new CalendarError(
      "The workspace owner needs to reconnect Google Calendar.",
    );
  const token = await refreshGoogle(
    saved.refreshToken,
    rt.clientId,
    rt.clientSecret,
  );
  result.events = await listGoogleEvents(
    token,
    saved.calendarId,
    workspace,
    range.start,
    range.end,
  );
  return result;
}
export async function connect(
  rt: Runtime,
  workspaceId: string,
  user: { id: string; email?: string },
  refreshToken: string,
) {
  if (!refreshToken || refreshToken.length > 4096)
    throw new CalendarError("Reconnect and allow Google Calendar access.", 400);
  const token = await refreshGoogle(refreshToken, rt.clientId, rt.clientSecret);
  const identity = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    },
  );
  const googleUser = await identity.json();
  if (
    !identity.ok ||
    !googleUser.email_verified ||
    googleUser.email?.toLowerCase() !== user.email?.toLowerCase()
  )
    throw new CalendarError(
      "Connect the same Google account you use as the Motion workspace owner.",
      403,
    );
  let saved = await connection(rt, workspaceId);
  if (saved && saved.owner !== user.id)
    throw new CalendarError(
      "The existing calendar connection belongs to a different workspace owner.",
      403,
    );
  if (!saved) {
    const lock = await rt.blobs.setJSON(
      `creating/${workspaceId}`,
      { at: new Date().toISOString() },
      { onlyIfNew: true },
    );
    if (!lock.modified)
      throw new CalendarError(
        "Calendar creation is already in progress. Refresh before trying again.",
      );
    // Keep the creation marker on an ambiguous network failure to prevent duplicates.
    const created = await googleRequest(token, "/calendars", {
      method: "POST",
      body: JSON.stringify({
        summary: "Motion OS",
        timeZone: "America/New_York",
        description:
          "Shared Motion OS workspace calendar. Manage events in Motion OS.",
      }),
    });
    if (!created.ok) {
      await rt.blobs.delete(`creating/${workspaceId}`);
      throw new CalendarError(
        "Google could not create the calendar. Enable the Calendar API and approve the requested calendar access.",
      );
    }
    const calendar = await created.json();
    if (!calendar.id)
      throw new CalendarError(
        "Google did not return a calendar. Contact the workspace owner before retrying.",
      );
    saved = { refreshToken, calendarId: calendar.id, owner: user.id };
  } else {
    const check = await googleRequest(
      token,
      `/calendars/${encodeURIComponent(saved.calendarId)}/events?maxResults=1&fields=accessRole`,
    );
    const access = await check.json();
    if (!check.ok || !["owner", "writer"].includes(access.accessRole))
      throw new CalendarError(
        "This Google account cannot edit the connected calendar.",
        403,
      );
    saved.refreshToken = refreshToken;
  }
  await rt.blobs.set(`connection/${workspaceId}`, seal(saved, rt.encryption));
  const registered = await rt.db.rpc("register_google_calendar", {
    p_workspace: workspaceId,
    p_owner: user.id,
    p_calendar: saved.calendarId,
  });
  if (registered.error)
    throw new CalendarError(
      "Google is connected, but workspace registration needs a retry. Reconnect to finish.",
    );
  await rt.blobs.delete(`creating/${workspaceId}`);
  return { connected: true };
}
export async function drain(
  rt: Runtime,
  workspace: string | null = null,
  limit = 5,
) {
  const started = Date.now(),
    tokens = new Map<string, string>();
  let synced = 0;
  for (let i = 0; i < limit && Date.now() - started < 20000; i++) {
    const result = await rt.db.rpc("claim_calendar_sync", {
      p_workspace: workspace,
    });
    if (result.error) throw new Error("Could not claim calendar queue");
    if (!result.data) break;
    const { job, event, calendar_id } = result.data as {
      job: { item_id: string; lease_id: string };
      event: Item;
      calendar_id: string;
    };
    let error: string | null = null;
    try {
      let token = tokens.get(event.workspace_id);
      if (!token) {
        const c = await connection(rt, event.workspace_id);
        if (!c || c.calendarId !== calendar_id)
          throw new CalendarError(
            "The workspace owner needs to connect Google Calendar.",
          );
        token = await refreshGoogle(
          c.refreshToken,
          rt.clientId,
          rt.clientSecret,
        );
        tokens.set(event.workspace_id, token);
      }
      await syncGoogleEvent(token, calendar_id, event);
      synced++;
    } catch (e) {
      error =
        e instanceof CalendarError
          ? e.message
          : "Calendar sync was interrupted. Motion OS will retry automatically.";
    }
    const completed = await rt.db.rpc("finish_calendar_sync", {
      p_item: job.item_id,
      p_lease: job.lease_id,
      p_version: event.version,
      p_error: error,
    });
    if (completed.error) throw new Error("Could not finish calendar queue");
  }
  return { synced };
}

import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./client";
import {
  calendarAction,
  pendingCalendarKey,
  type CalendarConnection,
  type CalendarSync,
} from "./calendar-sync";
import type { Item } from "./model";

export function GoogleCalendar({
  preview,
  workspace,
  owner,
  session,
  events,
  onOpen,
}: {
  preview: boolean;
  workspace: string;
  owner: boolean;
  session: Session | null;
  events: Item[];
  onOpen: (event: Item) => void;
}) {
  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [sync, setSync] = useState<CalendarSync[]>([]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [loaded, setLoaded] = useState(preview);
  const connecting = useRef(false);
  async function refresh() {
    if (preview || !supabase) return;
    const [c, s] = await Promise.all([
      supabase
        .from("calendar_connections")
        .select("calendar_id,connected_by")
        .eq("workspace_id", workspace)
        .maybeSingle(),
      supabase
        .from("calendar_sync")
        .select("item_id,requested_version,synced_version,last_error")
        .eq("workspace_id", workspace),
    ]);
    if (c.error || s.error)
      throw new Error(
        "Could not load Google sync status. Your events are saved in Motion OS.",
      );
    setConnection(c.data);
    setSync(s.data || []);
    setLoaded(true);
  }
  useEffect(() => {
    let active = true;
    const update = () => {
      if (active && document.visibilityState === "visible")
        void refresh().catch((e) => {
          if (active) setMessage(e.message);
        });
    };
    update();
    const timer = setInterval(update, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [workspace, preview]);
  useEffect(() => {
    if (preview || !session || connecting.current) return;
    let pending;
    try {
      pending = JSON.parse(
        sessionStorage.getItem(pendingCalendarKey) || "null",
      );
    } catch {
      return;
    }
    if (
      !pending ||
      pending.workspace !== workspace ||
      pending.user !== session.user.id
    )
      return;
    if (Date.now() - pending.at > 15 * 60000) {
      sessionStorage.removeItem(pendingCalendarKey);
      setMessage("Google connection expired. Try connecting again.");
      return;
    }
    if (!session.provider_refresh_token) return;
    connecting.current = true;
    setBusy(true);
    void calendarAction("connect", workspace, {
      refreshToken: session.provider_refresh_token,
    })
      .then(async () => {
        sessionStorage.removeItem(pendingCalendarKey);
        // Keep Google refresh credentials only on the server after setup.
        await supabase!.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
        setMessage("Google Calendar connected. Saved events are syncing.");
        await calendarAction("sync", workspace);
        await refresh();
      })
      .catch((e) => setMessage(e.message))
      .finally(() => {
        setBusy(false);
        connecting.current = false;
      });
  }, [workspace, preview, session?.access_token]);
  async function connect() {
    if (!supabase || !session || !owner || preview) return;
    setBusy(true);
    setMessage("");
    sessionStorage.setItem(
      pendingCalendarKey,
      JSON.stringify({ workspace, user: session.user.id, at: Date.now() }),
    );
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: "https://www.googleapis.com/auth/calendar.app.created",
        redirectTo: `${location.origin}/#events`,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
          login_hint: session.user.email || "",
        },
      },
    });
    if (error) {
      setMessage(error.message);
      setBusy(false);
      sessionStorage.removeItem(pendingCalendarKey);
    }
  }
  async function syncNow() {
    setBusy(true);
    setMessage("");
    try {
      await calendarAction("sync", workspace);
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const pending = events.filter(
    (e) =>
      !sync.some((s) => s.item_id === e.id && s.synced_version >= e.version),
  );
  return (
    <section
      className="panel calendar-sync-panel"
      aria-label="Google Calendar connection"
    >
      <div className="calendar-sync-heading">
        <div>
          <strong>
            {preview
              ? "Sample calendar"
              : connection
                ? "Motion OS Google Calendar"
                : "Connect our Google Calendar"}
          </strong>
          <p>
            {preview
              ? "Sample events stay in this browser."
              : connection
                ? "Everyone in this workspace can add and edit events below. Changes sync to Google automatically."
                : loaded
                  ? "Everyone can plan events here. The workspace owner can connect Google once to create our calendar and sync saved events."
                  : "Checking Google connection…"}
          </p>
        </div>
        <div className="google-calendar-actions">
          {!preview && connection && (
            <button className="button" onClick={syncNow} disabled={busy}>
              <RefreshCw size={16} />
              Sync now
            </button>
          )}
          {!preview && owner && (
            <button className="button" onClick={connect} disabled={busy}>
              {busy
                ? "Connecting…"
                : connection
                  ? "Reconnect Google"
                  : "Connect Google Calendar"}
            </button>
          )}
          {!preview && connection && owner && (
            <a
              className="button"
              href={`https://calendar.google.com/calendar/r?${new URLSearchParams({ cid: btoa(connection.calendar_id), authuser: session?.user.email || "" })}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} />
              Open in Google
            </a>
          )}
        </div>
      </div>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {!preview && loaded && (
        <p className="google-calendar-help" role="status">
          {!connection
            ? "Google sync is waiting for the owner’s connection."
            : pending.length
              ? `${pending.length} event${pending.length === 1 ? "" : "s"} waiting for Google sync.`
              : "All Motion events are synced to Google."}
        </p>
      )}
      {!preview &&
        pending.some(
          (e) => sync.find((s) => s.item_id === e.id)?.last_error,
        ) && (
          <ul className="calendar-sync-errors">
            {pending.map((e) => {
              const error = sync.find((s) => s.item_id === e.id)?.last_error;
              return error ? (
                <li key={e.id}>
                  <button className="text-button" onClick={() => onOpen(e)}>
                    {e.title}
                  </button>
                  : {error}
                </li>
              ) : null;
            })}
          </ul>
        )}
    </section>
  );
}

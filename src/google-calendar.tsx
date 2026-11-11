import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, ExternalLink, RefreshCw } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./client";
import { calendarAction, pendingCalendarKey } from "./calendar-sync";
import type { CalendarConnection, CalendarFeed } from "./calendar-feed";
import type { Item } from "./model";

export function GoogleCalendar({
  preview,
  workspace,
  owner,
  session,
  events,
  start,
  end,
  onFeed,
  onOpen,
}: {
  preview: boolean;
  workspace: string;
  owner: boolean;
  session: Session | null;
  events: Item[];
  start: string;
  end: string;
  onFeed: (feed: CalendarFeed | null) => void;
  onOpen: (event: Item) => void;
}) {
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [busy, setBusy] = useState<"sync" | "connect" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!preview);
  const connecting = useRef(false),
    requestId = useRef(0);
  const refresh = useCallback(async () => {
    if (preview) return null;
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result: CalendarFeed = await calendarAction("events", workspace, {
        start,
        end,
      });
      if (id !== requestId.current) return null;
      setFeed(result);
      setConnection(result.connection);
      onFeed(result);
      setError("");
      return result;
    } catch (e) {
      if (id === requestId.current)
        setError(
          e instanceof Error ? e.message : "Could not refresh Google Calendar.",
        );
      return null;
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [preview, workspace, start, end, onFeed]);
  // Keep connection status available if the optional Google feed fails.
  useEffect(() => {
    if (preview || !supabase || !session?.user.id) return;
    let cancelled = false;
    void supabase
      .from("calendar_connections")
      .select("calendar_id, connected_by")
      .eq("workspace_id", workspace)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setConnection(data);
      });
    return () => {
      cancelled = true;
    };
  }, [preview, workspace, session?.user.id]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    update();
    const timer = setInterval(update, 30000);
    window.addEventListener("focus", update);
    window.addEventListener("motion-calendar-updated", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      ++requestId.current;
      clearInterval(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("motion-calendar-updated", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);
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
      setError("Google connection expired. Try connecting again.");
      return;
    }
    if (!session.provider_refresh_token) return;
    connecting.current = true;
    setBusy("connect");
    void calendarAction("connect", workspace, {
      refreshToken: session.provider_refresh_token,
    })
      .then(async () => {
        sessionStorage.removeItem(pendingCalendarKey);
        await supabase!.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
        setMessage("Google Calendar connected.");
        await calendarAction("sync", workspace);
        await refresh();
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        setBusy(null);
        connecting.current = false;
      });
  }, [workspace, preview, session?.access_token, refresh]);
  async function connect() {
    if (!supabase || !session || !owner || preview) return;
    setBusy("connect");
    setMessage("");
    setError("");
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
      setError(error.message);
      setBusy(null);
      sessionStorage.removeItem(pendingCalendarKey);
    }
  }
  async function syncNow() {
    setBusy("sync");
    setMessage("");
    try {
      await calendarAction("sync", workspace);
      const result = await refresh();
      if (result?.connection) setMessage("Google Calendar refreshed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const pending = events.filter(
    (e) =>
      !feed?.sync.some(
        (s) => s.item_id === e.id && s.synced_version >= e.version,
      ),
  );
  return (
    <>
      <section
        className="panel calendar-sync-panel"
        aria-label="Google Calendar connection"
      >
        <div className="calendar-sync-heading">
          <div>
            <strong className="google-calendar-label">
              <CalendarDays size={21} />
              {preview
                ? "Sample calendar"
                : connection
                  ? "Google Calendar sync"
                  : "Google Calendar"}
            </strong>
            <p>
              {preview
                ? "Sample events stay in this browser."
                : connection
                  ? "Motion events save here first and sync to Google in the background."
                  : loading
                    ? "Checking Google sync…"
                    : error
                      ? "Google sync is unavailable. Your Motion calendar still works."
                      : "Your team calendar works without Google. Connect it if you also want a copy of events in Google Calendar."}
            </p>
          </div>
          {!preview && (
            <button
              className="button"
              onClick={syncNow}
              disabled={!!busy || loading}
            >
              <RefreshCw size={16} />
              {busy === "sync" ? "Refreshing…" : "Refresh calendar"}
            </button>
          )}
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
            {feed?.connection
              ? " Your Motion events remain saved and editable."
              : " Your Motion events remain saved and editable."}
          </p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {!preview && connection && !error && (
          <p className="google-calendar-help" role="status">
            {loading
              ? "Refreshing Google events…"
              : pending.length
                ? `${pending.length} event${pending.length === 1 ? "" : "s"} saving to Google. Your events are already saved in Motion OS.`
                : feed
                  ? `Loaded from Google Calendar · ${new Date(feed.fetched_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                  : "Google Calendar connected."}
          </p>
        )}
        {!preview &&
          pending.some(
            (e) => feed?.sync.find((s) => s.item_id === e.id)?.last_error,
          ) && (
            <ul className="calendar-sync-errors">
              {pending.map((e) => {
                const issue = feed?.sync.find(
                  (s) => s.item_id === e.id,
                )?.last_error;
                return issue ? (
                  <li key={e.id}>
                    <button className="text-button" onClick={() => onOpen(e)}>
                      {e.title}
                    </button>
                    : {issue}
                  </li>
                ) : null;
              })}
            </ul>
          )}
        {!preview && owner && (
          <details className="google-connection-settings">
            <summary>Google connection</summary>
            <div className="google-calendar-actions">
              <button className="button" onClick={connect} disabled={!!busy}>
                {busy === "connect"
                  ? "Connecting…"
                  : connection
                    ? "Reconnect Google"
                    : "Connect Google Calendar"}
              </button>
              {connection && (
                <a
                  className="button"
                  href={`https://calendar.google.com/calendar/r?${new URLSearchParams({ authuser: session?.user.email || "" })}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={16} />
                  Open in Google
                </a>
              )}
            </div>
          </details>
        )}
      </section>
    </>
  );
}

import { useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";

// Google's own UI, including on phones. OS event creation stays outside this
// read-only widget and uses the existing authenticated server sync.
export function GoogleCalendarEmbed({
  calendarId,
  email,
  syncRevision,
  onShowEvents,
}: {
  calendarId: string;
  email?: string;
  syncRevision: string;
  onShowEvents: () => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const params = new URLSearchParams({
    src: calendarId,
    ctz: "America/New_York",
    mode: "WEEK",
    showTitle: "0",
    showPrint: "0",
    showCalendars: "0",
  });
  if (email) params.set("authuser", email);
  const url = `https://calendar.google.com/calendar/embed?${params}`;
  return (
    <section className="google-calendar" aria-label="Embedded Google Calendar">
      <p className="google-calendar-intro">
        Your shared Motion OS calendar. Tap <strong>New event</strong> above to
        add to it.
      </p>
      <div className="panel google-calendar-frame">
        <iframe
          key={`${calendarId}:${email}:${syncRevision}:${refresh}`}
          src={url}
          title="Motion OS Google Calendar"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <div className="google-calendar-actions google-embed-actions">
        <button className="button" onClick={() => setRefresh((n) => n + 1)}>
          <RefreshCw size={16} /> Reload Google view
        </button>
        <a
          className="button"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={16} /> Open Google calendar
        </a>
      </div>
      <details className="google-embed-help">
        <summary>Calendar blank or asking you to sign in?</summary>
        <p>
          This private Google view needs a Google account with access to this
          calendar. Open Google calendar to check your sign-in, then return and
          reload the view. Your Motion OS sign-in does not sign you into the
          Google widget.
        </p>
        <p>
          iPhone home-screen apps may block Google sign-in inside the widget. If
          it stays blank, open Motion OS in Safari or use the event list here.
          You can still add events with New event.
        </p>
        <button className="text-button" onClick={onShowEvents}>
          Show event list
        </button>
      </details>
    </section>
  );
}

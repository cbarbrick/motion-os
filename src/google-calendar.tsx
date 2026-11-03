import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";

// This is Google's normal calendar ID, not an iCal secret or an access token.
// Google enforces the calendar's existing sharing permissions inside the frame.
const calendarId = "emilee.e@cbdplususa.com";
const calendarUrl =
  "https://calendar.google.com/calendar/r?cid=ZW1pbGVlLmVAY2JkcGx1c3VzYS5jb20";
const compactQuery = "(max-width: 650px)";

export function GoogleCalendar({ preview }: { preview: boolean }) {
  const [compact, setCompact] = useState(
    () => window.matchMedia(compactQuery).matches,
  );
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const media = window.matchMedia(compactQuery);
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const params = new URLSearchParams({
    src: calendarId,
    ctz: "America/New_York",
    mode: compact ? "AGENDA" : "WEEK",
    showTitle: "0",
    showPrint: "0",
    showCalendars: "0",
  });

  return (
    <section className="google-calendar" aria-labelledby="google-calendar-title">
      <div className="heading google-calendar-heading">
        <div>
          <h1 id="google-calendar-title">Calendar</h1>
          <p>Executive Assistant · Eastern Time</p>
        </div>
        <div className="google-calendar-actions">
          <button
            type="button"
            className="button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw size={17} aria-hidden="true" />
            Refresh
          </button>
          <a
            className="button primary"
            href={calendarUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={17} aria-hidden="true" />
            Open Google Calendar
          </a>
        </div>
      </div>
      <p className="google-calendar-help" id="google-calendar-help">
        View the shared calendar here. Open Google Calendar to add or edit events
        if you have editing access.
        {preview && " This Google Calendar is live, even in sample mode."}
      </p>
      <div className="panel google-calendar-frame">
        <iframe
          key={`${compact}:${refresh}`}
          title="Executive Assistant Google Calendar"
          src={`https://calendar.google.com/calendar/embed?${params}`}
          aria-describedby="google-calendar-help google-calendar-access"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <p className="google-calendar-help" id="google-calendar-access">
        Can’t see events? Open Google Calendar, sign in with an account this
        calendar is shared with, then refresh here.
      </p>
    </section>
  );
}

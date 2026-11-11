import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { GoogleCalendar } from "./google-calendar";
import {
  calendarEntries,
  type CalendarEntry,
  type CalendarFeed,
} from "./calendar-feed";
import {
  calendarDays,
  moveCalendarDate,
  newCalendarEvent,
  timedEvents,
  type CalendarView,
} from "./calendar-view";
import { eventOnDay, eventStartDay, eventTimeLabel } from "./event-time";
import {
  addDays,
  dateLabel,
  localDate,
  type Item,
  type ItemInput,
  type Snapshot,
} from "./model";
import type { useWorkspace } from "./use-workspace";

const hours = Array.from({ length: 24 }, (_, i) => i);
const hourLabel = (hour: number) =>
  `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
const dayLabel = (day: string) =>
  dateLabel(day, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export function MotionCalendar({
  data,
  store,
  onOpen,
  onCreate,
}: {
  data: Snapshot;
  store: ReturnType<typeof useWorkspace>;
  onOpen: (item: Item) => void;
  onCreate: (initial?: Partial<ItemInput>) => void;
}) {
  const [date, setDate] = useState(localDate);
  const [view, setView] = useState<CalendarView>("month");
  const [athlete, setAthlete] = useState("all");
  const [eventType, setEventType] = useState("all");
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [detail, setDetail] = useState<CalendarEntry | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const today = localDate();
  const days = calendarDays(date, view);
  const start = new Date(`${days[0]}T00:00:00`).toISOString();
  const end = new Date(`${addDays(days.at(-1)!, 1)}T00:00:00`).toISOString();
  const currentFeed =
    feed?.range_start === start && feed.range_end === end ? feed : null;
  const entries = calendarEntries(data.items, currentFeed).filter(
    (e) =>
      (athlete === "all" || e.item?.athlete_id === athlete) &&
      (eventType === "all" || (e.item?.event_type || "event") === eventType),
  );
  const visibleDays =
    view === "month"
      ? days.filter((d) => d.slice(0, 7) === date.slice(0, 7))
      : days;
  const visible = entries.filter((e) =>
    visibleDays.some((d) => eventOnDay(e, d)),
  );
  const title =
    view === "month"
      ? dateLabel(date, { month: "long", year: "numeric" })
      : view === "day"
        ? dayLabel(date)
        : `${dateLabel(days[0], { month: "short", day: "numeric" })} – ${dateLabel(days[6], { month: "short", day: "numeric", year: "numeric" })}`;
  const athleteName = (e: CalendarEntry) =>
    data.sponsorships.find((s) => s.id === e.item?.athlete_id)?.athlete_name;
  const tone = (e: CalendarEntry) =>
    e.item?.athlete_id ? "athlete" : e.google ? "google" : "team";
  const openEvent = (e: CalendarEntry) =>
    e.item ? onOpen(e.item) : setDetail(e);
  const create = (day = date, hour = 9, allDay = false) =>
    onCreate({
      ...newCalendarEvent(day, hour, allDay),
      ...(athlete !== "all" ? { athlete_id: athlete } : {}),
      ...(eventType !== "all"
        ? { event_type: eventType as "fight" | "event" }
        : {}),
    });
  const showDay = (day: string) => {
    setDate(day);
    setView("day");
  };
  useEffect(() => {
    if (scroll.current && view !== "month") scroll.current.scrollTop = 8 * 64;
  }, [view, start]);
  useEffect(() => {
    if (detail) dialog.current?.showModal();
  }, [detail]);

  return (
    <div className="motion-calendar">
      <div className="heading">
        <div>
          <h1>{store.preview ? "Sample calendar" : "Calendar"}</h1>
          <p>
            {store.preview
              ? "Sample events stay in this browser."
              : "One calendar for the whole team. Everyone can add events."}
          </p>
        </div>
        <button className="button primary" onClick={() => create()}>
          <Plus size={17} /> New event
        </button>
      </div>
      <section
        className="panel native-calendar"
        aria-label="Motion team calendar"
      >
        <div className="native-calendar-toolbar">
          <div className="native-calendar-navigation">
            <button
              className="icon-button"
              aria-label={`Previous ${view}`}
              onClick={() => setDate(moveCalendarDate(date, view, -1))}
            >
              <ChevronLeft size={20} />
            </button>
            <button className="button" onClick={() => setDate(today)}>
              Today
            </button>
            <button
              className="icon-button"
              aria-label={`Next ${view}`}
              onClick={() => setDate(moveCalendarDate(date, view, 1))}
            >
              <ChevronRight size={20} />
            </button>
          </div>
          <h2 aria-live="polite">{title}</h2>
          <div
            className="tabs native-calendar-views"
            aria-label="Calendar view"
          >
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                aria-pressed={view === v}
                className={view === v ? "active" : ""}
                onClick={() => setView(v)}
              >
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="native-calendar-filters">
          <label>
            Go to date
            <input
              type="date"
              value={date}
              onChange={(e) => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value))
                  setDate(e.target.value);
              }}
            />
          </label>
          <label>
            Athlete
            <select
              value={athlete}
              onChange={(e) => setAthlete(e.target.value)}
            >
              <option value="all">All athletes & team</option>
              {data.sponsorships
                .filter((s) => s.record_type === "athlete")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.athlete_name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Type
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
            >
              <option value="all">All events</option>
              <option value="event">Events</option>
              <option value="fight">Fights</option>
            </select>
          </label>
          <span className="native-calendar-count">
            {visible.length} event{visible.length === 1 ? "" : "s"}
          </span>
        </div>
        {view === "month" ? (
          <>
            <div className="calendar-weekdays">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="native-month-grid">
              {days.map((day) => {
                const events = entries
                  .filter((e) => eventOnDay(e, day))
                  .sort((a, b) => Number(b.all_day) - Number(a.all_day));
                return (
                  <div
                    key={day}
                    className={`native-month-day ${day.slice(0, 7) !== date.slice(0, 7) ? "outside" : ""} ${day === today ? "today" : ""}`}
                  >
                    <button
                      className="native-day-number"
                      aria-label={`${dayLabel(day)} · ${events.length} events`}
                      aria-current={day === today ? "date" : undefined}
                      onClick={() => showDay(day)}
                    >
                      {Number(day.slice(8))}
                    </button>
                    {events.slice(0, 3).map((e) => (
                      <button
                        key={e.id}
                        className={`native-event-chip ${tone(e)}`}
                        onClick={() => openEvent(e)}
                        title={`${e.title} · ${eventTimeLabel(e)}${athleteName(e) ? ` · ${athleteName(e)}` : ""}`}
                      >
                        <span>
                          {e.all_day
                            ? "All day"
                            : new Date(e.starts_at).toLocaleTimeString([], {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                        </span>
                        <strong>{e.title}</strong>
                        {athleteName(e) && <span>{athleteName(e)}</span>}
                      </button>
                    ))}
                    {events.length > 3 && (
                      <button
                        className="native-more"
                        onClick={() => showDay(day)}
                      >
                        +{events.length - 3} more
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <p className="native-calendar-hint">
              Tap a time to add an event.
              {view === "week"
                ? " On small screens, swipe across to see every day."
                : ""}{" "}
              Times in{" "}
              {Intl.DateTimeFormat()
                .resolvedOptions()
                .timeZone.replaceAll("_", " ")}
              .
            </p>
            <div
              className={`native-time-scroll ${view}`}
              ref={scroll}
              tabIndex={0}
              aria-label={`${view === "week" ? "Weekly" : "Daily"} calendar. Scroll to see all times.`}
            >
              <div
                className="native-time-grid"
                style={{
                  gridTemplateColumns: `54px repeat(${days.length}, minmax(${view === "week" ? "118px" : "0px"}, 1fr))`,
                }}
              >
                <div className="native-time-head native-time-corner">
                  <CalendarDays size={18} />
                </div>
                {days.map((day) => (
                  <button
                    key={`head-${day}`}
                    className={`native-time-head ${day === today ? "today" : ""}`}
                    onClick={() => showDay(day)}
                    aria-label={`View ${dayLabel(day)}`}
                  >
                    <span>{dateLabel(day, { weekday: "short" })}</span>
                    <strong>{Number(day.slice(8))}</strong>
                  </button>
                ))}
                <div className="native-all-day-label">All day</div>
                {days.map((day) => (
                  <div key={`all-${day}`} className="native-all-day">
                    {entries
                      .filter((e) => e.all_day && eventOnDay(e, day))
                      .map((e) => (
                        <button
                          key={e.id}
                          className={`native-event-chip ${tone(e)}`}
                          onClick={() => openEvent(e)}
                        >
                          <strong>{e.title}</strong>
                          {athleteName(e) && <span>{athleteName(e)}</span>}
                        </button>
                      ))}
                    <button
                      className="native-add-all"
                      aria-label={`Add all-day event on ${dayLabel(day)}`}
                      onClick={() => create(day, 9, true)}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                ))}
                <div className="native-hour-labels">
                  {hours.map((h) => (
                    <span key={h}>{hourLabel(h)}</span>
                  ))}
                </div>
                {days.map((day) => (
                  <div
                    key={day}
                    className={`native-time-day ${day === today ? "today" : ""}`}
                  >
                    {hours.map((h) => (
                      <button
                        key={h}
                        className="native-time-slot"
                        aria-label={`Add event ${dayLabel(day)} at ${hourLabel(h)}`}
                        onClick={() => create(day, h)}
                      />
                    ))}
                    {timedEvents(entries, day).map(
                      ({
                        event: e,
                        start: minute,
                        end: until,
                        column,
                        columns,
                      }) => (
                        <button
                          key={e.id}
                          className={`native-timed-event ${tone(e)}`}
                          onClick={() => openEvent(e)}
                          title={`${e.title} · ${eventTimeLabel(e)}${athleteName(e) ? ` · ${athleteName(e)}` : ""}`}
                          style={{
                            top: (minute / 60) * 64,
                            height: ((until - minute) / 60) * 64,
                            left: `calc(${(column / columns) * 100}% + 2px)`,
                            width: `calc(${100 / columns}% - 4px)`,
                          }}
                        >
                          <strong>{e.title}</strong>
                          <span>{eventTimeLabel(e)}</span>
                          {athleteName(e) && <span>{athleteName(e)}</span>}
                        </button>
                      ),
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>
      <section className="panel native-agenda" aria-label="Events in this view">
        <div className="native-agenda-heading">
          <h2>
            {view === "day"
              ? "Day’s events"
              : view === "week"
                ? "This week’s events"
                : "This month’s events"}
          </h2>
          <span>{visible.length}</span>
        </div>
        {visible.length ? (
          visible.map((e) => (
            <button
              key={e.id}
              className={`native-agenda-event ${tone(e)}`}
              onClick={() => openEvent(e)}
            >
              <span className="date-tile">
                <small>{dateLabel(eventStartDay(e), { month: "short" })}</small>
                <strong>
                  {dateLabel(eventStartDay(e), { day: "numeric" })}
                </strong>
              </span>
              <span className="native-agenda-description">
                <strong>{e.title}</strong>
                <span>
                  {eventTimeLabel(e)}
                  {e.location ? ` · ${e.location}` : ""}
                </span>
                {athleteName(e) && (
                  <span className="native-athlete-label">
                    {athleteName(e)}
                    {e.item?.event_type === "fight" ? " · Fight" : ""}
                  </span>
                )}
                {e.google && <small>From Google · view only</small>}
              </span>
              <ChevronRight size={18} />
            </button>
          ))
        ) : (
          <div className="native-calendar-empty">
            <CalendarDays size={26} />
            <h3>
              {athlete !== "all" || eventType !== "all"
                ? "No events match these filters"
                : "Room for what’s next"}
            </h3>
            <p>Add a team event or schedule something for an athlete.</p>
            <button className="button" onClick={() => create()}>
              <Plus size={16} /> Add event
            </button>
          </div>
        )}
      </section>
      {!store.preview && (
        <details className="native-calendar-sync">
          <summary>
            Google Calendar sync <span>Optional</span>
          </summary>
          <GoogleCalendar
            preview={store.preview}
            workspace={data.workspace.id}
            owner={data.workspace.owner_id === store.userId}
            session={store.session}
            events={data.items.filter((i) => i.kind === "event")}
            start={start}
            end={end}
            onFeed={setFeed}
            onOpen={onOpen}
          />
        </details>
      )}
      {detail && (
        <dialog
          className="native-google-detail"
          ref={dialog}
          onCancel={() => setDetail(null)}
          aria-labelledby="google-event-title"
        >
          <button
            className="icon-button"
            aria-label="Close event"
            onClick={() => setDetail(null)}
          >
            <X size={20} />
          </button>
          <p>From Google Calendar · view only</p>
          <h2 id="google-event-title">{detail.title}</h2>
          <p>
            {dayLabel(eventStartDay(detail))} · {eventTimeLabel(detail)}
          </p>
          {detail.location && <p>{detail.location}</p>}
          <p className="native-event-description">
            {detail.description || "No description"}
          </p>
          <p>Edit this event in Google Calendar.</p>
        </dialog>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  Check,
  Trophy,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Cloud,
  Film,
  Home,
  Lightbulb,
  ListTodo,
  LogOut,
  Menu,
  Plus,
  Search,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import { useWorkspace } from "./use-workspace";
import { Welcome, WorkspaceSetup, JoinInvitation, ResetPassword } from "./auth";
import { Sponsorships } from "./sponsorships";
import { Editor } from "./editor";
import { GoogleCalendar } from "./google-calendar";
import { calendarEntries, type CalendarFeed } from "./calendar-feed";
import {
  eventStartDay,
  eventOnDay,
  eventEndDay,
  eventTimeLabel,
} from "./event-time";
import { Notifications } from "./notifications";
import { supabase } from "./client";
import { MotionIcon, MotionWordmark } from "./brand";
import {
  addDays,
  isInWeek,
  isOnTask,
  taskPeople,
  dateLabel,
  initials,
  inputOf,
  labels,
  localDate,
  statusLabel,
  weekStart,
  type Item,
  type ItemInput,
  type Kind,
  type Snapshot,
  type View,
} from "./model";
const nav = [
  { id: "tasks", icon: ClipboardList },
  { id: "events", icon: CalendarDays },
  { id: "sponsorships", icon: Trophy },
  { id: "affiliates", icon: ClipboardCheck },
  { id: "ideas", icon: Lightbulb },
  { id: "todos", icon: ListTodo },
  { id: "team", icon: Users },
  { id: "home", icon: Home },
] as const;
export function App() {
  const store = useWorkspace(),
    [view, setView] = useState<View>("tasks"),
    [mobile, setMobile] = useState(false),
    [search, setSearch] = useState(""),
    [taskScope, setTaskScope] = useState("mine"),
    [editor, setEditor] = useState<{
      kind: Kind;
      item: Item | null;
      initial?: Partial<ItemInput>;
    } | null>(null),
    [toast, setToast] = useState(""),
    [install, setInstall] = useState(false);
  useEffect(() => {
    const sync = () => {
      const h = location.hash.slice(1);
      if (h in labels) setView(h as View);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const go = (next: View, scope = "mine") => {
    if (next === "tasks") setTaskScope(scope);
    setView(next);
    location.hash = next;
    setMobile(false);
    setSearch("");
  };
  const open = (item: Item) => setEditor({ kind: item.kind, item });
  const create = (kind: Kind, initial?: Partial<ItemInput>) =>
    setEditor({ kind, item: null, initial });
  if (!store.authReady || store.loading)
    return (
      <div className="loading">
        <MotionIcon />
        Opening your workspace...
      </div>
    );
  if (store.recovering && store.session) return <ResetPassword store={store} />;
  if (!store.session && !store.preview) return <Welcome store={store} />;
  if (store.inviteToken && !store.preview)
    return <JoinInvitation store={store} />;
  if (!store.data) return <WorkspaceSetup store={store} />;
  const data = store.data,
    me = data.members.find((m) => m.user_id === store.userId);
  const tasks = data.items.filter((i) => i.kind === "task"),
    today = localDate(),
    week = weekStart();
  const myTasks = tasks.filter(
    (t) => isOnTask(t, store.userId) && t.status !== "done",
  );
  const unclaimed = tasks.filter((t) => !t.assignee_id && t.status === "open");
  const completed = tasks.filter((t) => t.status === "done");
  const upcoming = data.items
    .filter(
      (i) =>
        i.kind === "event" &&
        i.status !== "complete" &&
        i.starts_at &&
        eventEndDay(i) >= today,
    )
    .sort((a, b) => a.starts_at!.localeCompare(b.starts_at!));
  const filtered = data.items.filter(
    (i) =>
      (i.kind !== "todo" || i.created_by === store.userId) &&
      `${i.title} ${i.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  async function claim(item: Item) {
    try {
      await store.claim(item);
      setToast("Task assigned to you");
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  async function toggleDone(item: Item) {
    try {
      await store.save(item.kind, item, {
        ...inputOf(item),
        status:
          item.status === "done"
            ? item.assignee_id
              ? "doing"
              : "open"
            : "done",
      });
      setToast(item.status === "done" ? "Task reopened." : "Task complete");
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  const cardProps = { data, onOpen: open, onClaim: claim, onDone: toggleDone };
  return (
    <div className="shell">
      <a href="#main" className="skip">
        Skip to content
      </a>
      {mobile && (
        <button
          className="scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={mobile ? "sidebar mobile-open" : "sidebar"}>
        <button className="wordmark" onClick={() => go("home")}>
          <MotionWordmark />
        </button>
        <div className="workspace">
          <MotionIcon />
          <div>
            <strong>{data.workspace.name}</strong>
            <small>Team workspace</small>
          </div>
        </div>

        <nav>
          {nav.map(({ id, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "nav-item selected" : "nav-item"}
              onClick={() => go(id)}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{labels[id]}</span>
              {id === "tasks" && unclaimed.length > 0 && (
                <b>{unclaimed.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="install-link" onClick={() => setInstall(true)}>
            <ArrowDownToLine size={16} />
            Add to home screen
          </button>
          <button className="profile" onClick={() => go("team")}>
            <span className="avatar">{initials(me?.name || "You")}</span>
            <span>
              <strong>{me?.name || "You"}</strong>
              <small>
                {store.preview
                  ? "Sample workspace"
                  : me?.role === "admin"
                    ? "Workspace owner"
                    : me?.role}
              </small>
            </span>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <span>/</span>
            <strong>{labels[view]}</strong>
          </div>
          <div className="topbar-actions">
            <div className="search">
              <Search size={16} />
              <input
                aria-label="Search workspace"
                placeholder="Search work"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button aria-label="Clear search" onClick={() => setSearch("")}>
                  <X size={14} />
                </button>
              )}
            </div>
            <Notifications
              key={`${data.workspace.id}:${store.userId}:${store.preview}`}
              store={store}
              onOpen={open}
            />
            <span className={`connection ${!store.online ? "offline" : ""}`}>
              {store.online ? <Cloud size={15} /> : <WifiOff size={15} />}
              <span>
                {store.preview
                  ? "Sample mode"
                  : store.online
                    ? "Cloud workspace"
                    : "Offline"}
              </span>
            </span>
          </div>
        </header>
        <main id="main" className="main" tabIndex={-1}>
          {store.preview && (
            <div className="sample-banner">
              <span>
                <strong>Sample</strong> · Changes stay on this device.
              </span>
              <button onClick={store.exitPreview}>
                {store.session ? "Return to workspace" : "Exit sample"}{" "}
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          {store.error && (
            <div className="notice error" role="alert">
              {store.error}
              <button
                className="text-button"
                onClick={() => void store.refresh()}
              >
                Retry connection
              </button>
            </div>
          )}
          {!store.online && !store.preview && (
            <div className="notice">
              You’re offline. Existing data stays visible; edits remain device
              drafts until a save succeeds.
            </div>
          )}
          {search ? (
            <>
              <Heading
                eyebrow="YOUR WORKSPACE"
                title={`Results for “${search}”`}
                description={`${filtered.length} matching items`}
              />
              <div className="panel list">
                {filtered.map((i) => (
                  <ItemRow key={i.id} item={i} {...cardProps} />
                ))}
                {!filtered.length && (
                  <Empty
                    title="No matches"
                    text="Try a different title or keyword."
                  />
                )}
              </div>
            </>
          ) : (
            <>
              {view === "home" && (
                <>
                  <Heading
                    eyebrow={dateLabel(today, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                    title="Overview"
                    description=""
                  >
                    <button
                      className="button primary"
                      onClick={() => create("task")}
                    >
                      <Plus size={17} />
                      New task
                    </button>
                  </Heading>
                  <div className="stats">
                    <Stat
                      label="My tasks"
                      value={myTasks.length}
                      foot=""
                      onClick={() => go("tasks")}
                    />
                    <Stat
                      label="Unassigned"
                      value={unclaimed.length}
                      foot=""
                      onClick={() => go("tasks", "unassigned")}
                    />
                    <Stat
                      label="Completed"
                      value={completed.length}
                      foot=""
                      onClick={() => go("tasks", "done")}
                    />
                    <Stat
                      label="Upcoming events"
                      value={upcoming.length}
                      foot=""
                      onClick={() => go("events")}
                    />
                  </div>
                  <div className="home-grid">
                    <section className="panel">
                      <PanelTitle
                        title="My tasks"
                        subtitle=""
                        action="My tasks"
                        onAction={() => go("tasks")}
                      />
                      <div className="list">
                        {myTasks.slice(0, 5).map((t) => (
                          <ItemRow key={t.id} item={t} {...cardProps} />
                        ))}
                        {!myTasks.length && (
                          <Empty title="No assigned tasks" text="" />
                        )}
                      </div>
                    </section>
                    <section className="panel">
                      <PanelTitle
                        title="Upcoming events"
                        subtitle=""
                        action="All events"
                        onAction={() => go("events")}
                      />
                      {upcoming.slice(0, 3).map((e) => (
                        <EventSummary
                          key={e.id}
                          event={e}
                          data={data}
                          onOpen={open}
                        />
                      ))}
                      {!upcoming.length && (
                        <Empty title="No upcoming events" text="" />
                      )}
                    </section>
                    <section className="panel">
                      <PanelTitle
                        title="Unassigned tasks"
                        subtitle=""
                        action="View unassigned"
                        onAction={() => go("tasks", "unassigned")}
                      />
                      <div className="list">
                        {unclaimed.slice(0, 3).map((t) => (
                          <ItemRow key={t.id} item={t} {...cardProps} />
                        ))}
                        {!unclaimed.length && (
                          <Empty title="No unassigned tasks" text="" />
                        )}
                      </div>
                    </section>
                    <section className="panel">
                      <PanelTitle title="Recent updates" subtitle="" />
                      {data.activity.length ? (
                        <div className="activity">
                          {data.activity.slice(0, 5).map((a) => (
                            <div key={a.id}>
                              <span className="activity-dot" />
                              <p>
                                <strong>
                                  {data.members.find(
                                    (m) => m.user_id === a.actor_id,
                                  )?.name || "Team member"}
                                </strong>
                                <span>{a.title}</span>
                              </p>
                              <small>{dateLabel(a.created_at)}</small>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Empty title="No updates" text="" />
                      )}
                    </section>
                  </div>
                </>
              )}
              {(view === "sponsorships" ||
                view === "affiliates" ||
                view === "people") && (
                <Sponsorships
                  key={`${data.workspace.id}:${view}`}
                  store={store}
                  type={
                    view === "people"
                      ? "person"
                      : view === "affiliates"
                        ? "approval"
                        : "athlete"
                  }
                  onCreateEvent={(athlete) =>
                    create("event", {
                      athlete_id: athlete,
                      event_type: "fight",
                    })
                  }
                  onOpenEvent={open}
                />
              )}
              {view === "team_week" && (
                <TeamWeek
                  {...cardProps}
                  onCreate={(person, selectedWeek) =>
                    create("task", {
                      assignee_id: person,
                      week_of: selectedWeek,
                    })
                  }
                />
              )}
              {view === "week" && (
                <Weekly
                  data={data}
                  userId={store.userId}
                  onOpen={open}
                  onClaim={claim}
                  onDone={toggleDone}
                  onCreate={(person, selectedWeek) =>
                    create("task", {
                      assignee_id: person,
                      week_of: selectedWeek,
                    })
                  }
                />
              )}
              {(view === "tasks" || view === "content") && (
                <Board
                  key={`${view}:${taskScope}`}
                  initialScope={taskScope}
                  userId={store.userId}
                  data={data}
                  content={view === "content"}
                  onPlan={(person, week) =>
                    create("task", { assignee_id: person, week_of: week })
                  }
                  onOpen={open}
                  onClaim={claim}
                  onDone={toggleDone}
                  onCreate={(initial) =>
                    create("task", {
                      ...(view === "content" ? { category: "Content" } : {}),
                      ...initial,
                    })
                  }
                />
              )}
              {view === "events" && (
                <>
                  <Events
                    key={data.workspace.id + String(store.preview)}
                    store={store}
                    data={data}
                    onOpen={open}
                    onCreate={(day) =>
                      create(
                        "event",
                        day
                          ? {
                              starts_at: new Date(
                                day + "T09:00:00",
                              ).toISOString(),
                              ends_at: new Date(
                                day + "T10:00:00",
                              ).toISOString(),
                            }
                          : undefined,
                      )
                    }
                  />
                </>
              )}
              {view === "ideas" && (
                <>
                  <Heading eyebrow="" title="Ideas" description="">
                    <button
                      className="button primary"
                      onClick={() => create("idea")}
                    >
                      <Plus size={17} />
                      Add an idea
                    </button>
                  </Heading>
                  <div className="idea-grid">
                    {data.items
                      .filter((i) => i.kind === "idea")
                      .map((i) => (
                        <button
                          className="idea-card"
                          key={i.id}
                          onClick={() => open(i)}
                        >
                          <div>
                            <span className="category">
                              <Lightbulb size={14} />
                              {i.category}
                            </span>
                            <Badge status={i.status} />
                          </div>
                          <h3>{i.title}</h3>
                          <p>{i.description || "No description"}</p>
                          <footer>
                            <span>
                              {data.members.find(
                                (m) => m.user_id === i.created_by,
                              )?.name || "Team member"}
                            </span>
                            <ArrowRight size={17} />
                          </footer>
                        </button>
                      ))}
                  </div>
                  {!data.items.some((i) => i.kind === "idea") && (
                    <Empty title="No ideas added" text="" />
                  )}
                </>
              )}
              {view === "todos" && (
                <>
                  <Heading
                    eyebrow=""
                    title="My to-dos"
                    description="Private to your account"
                  >
                    <button
                      className="button primary"
                      onClick={() =>
                        create("todo", { assignee_id: store.userId })
                      }
                    >
                      <Plus size={17} />
                      Add to-do
                    </button>
                  </Heading>
                  <div className="panel list todo-list">
                    {data.items
                      .filter(
                        (i) =>
                          i.kind === "todo" && i.created_by === store.userId,
                      )
                      .map((t) => (
                        <div className="todo-row" key={t.id}>
                          <button
                            className={`check-box ${t.status === "done" ? "checked" : ""}`}
                            aria-label={`${t.status === "done" ? "Reopen" : "Complete"} ${t.title}`}
                            onClick={async () => {
                              try {
                                await store.save("todo", t, {
                                  ...inputOf(t),
                                  status: t.status === "done" ? "open" : "done",
                                });
                              } catch (e) {
                                setToast((e as Error).message);
                              }
                            }}
                          >
                            {t.status === "done" && <Check size={15} />}
                          </button>
                          <button
                            className={
                              t.status === "done"
                                ? "done todo-title"
                                : "todo-title"
                            }
                            onClick={() => open(t)}
                          >
                            {t.title}
                          </button>
                          <small>
                            {t.due_date ? dateLabel(t.due_date) : ""}
                          </small>
                        </div>
                      ))}
                    {!data.items.some(
                      (i) => i.kind === "todo" && i.created_by === store.userId,
                    ) && <Empty title="No to-dos" text="" />}
                  </div>
                </>
              )}
              {view === "team" && (
                <Team store={store} install={() => setInstall(true)} />
              )}
            </>
          )}
        </main>
      </div>
      {editor && (
        <Editor
          key={`${editor.item?.id || editor.kind}-${editor.initial?.category || ""}-${editor.initial?.athlete_id || ""}`}
          {...editor}
          data={data}
          userId={store.userId}
          preview={store.preview}
          onSave={store.save}
          onClose={() => setEditor(null)}
          onInviteTeam={() => go("team")}
          onOpen={open}
          onNewTask={(eventId, category) =>
            create("task", { event_id: eventId, category })
          }
        />
      )}{" "}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="Dismiss message" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {install && <Install onClose={() => setInstall(false)} />}
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
function PanelTitle({
  title,
  subtitle,
  action,
  onAction,
}: {
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="panel-title">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && (
        <button className="text-button" onClick={onAction}>
          {action}
          <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  foot,
  onClick,
}: {
  label: string;
  value: number;
  foot: string;
  onClick: () => void;
}) {
  return (
    <button className="stat" onClick={onClick}>
      <span>{label}</span>
      <strong>{value.toString().padStart(2, "0")}</strong>
      <small>
        {foot}
        <ArrowRight size={14} />
      </small>
    </button>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <span>✳</span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
    </div>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <span />
      {statusLabel[status] || status}
    </span>
  );
}
function DoneButton({
  item,
  onDone,
}: {
  item: Item;
  onDone: (item: Item) => void;
}) {
  return (
    <button
      type="button"
      className={`done-check ${item.status === "done" ? "checked" : ""}`}
      aria-label={`${item.status === "done" ? "Reopen" : "Complete"} ${item.title}`}
      aria-pressed={item.status === "done"}
      onClick={() => onDone(item)}
    >
      <Check size={16} />
    </button>
  );
}
function ItemRow({
  item,
  data,
  onOpen,
  onClaim,
  onDone,
}: {
  item: Item;
  data: Snapshot;
  onOpen: (i: Item) => void;
  onClaim: (i: Item) => void;
  onDone: (i: Item) => void;
}) {
  const owner = data.members.find((m) => m.user_id === item.assignee_id);
  return (
    <div className="item-row">
      {item.kind === "task" && <DoneButton item={item} onDone={onDone} />}
      <button className="item-main" onClick={() => onOpen(item)}>
        <span
          className={`task-symbol ${item.category === "Content" ? "content" : ""}`}
        >
          {item.category === "Content" ? (
            <Film size={16} />
          ) : (
            <ClipboardList size={16} />
          )}
        </span>
        <span>
          <strong>{item.title}</strong>
          <small>
            {item.category}
            {item.due_date ? ` · ${dateLabel(item.due_date)}` : ""}
            {item.priority !== "normal" ? ` · ${item.priority} priority` : ""}
            {item.collaborator_ids?.length
              ? ` · ${taskPeople(item)
                  .map((id) => data.members.find((m) => m.user_id === id)?.name)
                  .filter(Boolean)
                  .join(", ")}`
              : ""}
          </small>
        </span>
      </button>
      <div className="item-end">
        <Badge status={item.status} />
        {owner ? (
          <span className="avatar small" title={owner.name}>
            {initials(owner.name)}
          </span>
        ) : item.kind === "task" && item.status === "open" ? (
          <button className="claim" onClick={() => onClaim(item)}>
            Claim task <Plus size={12} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
function EventSummary({
  event,
  data,
  onOpen,
}: {
  event: Item;
  data: Snapshot;
  onOpen: (i: Item) => void;
}) {
  const ts = data.items.filter(
    (i) => i.kind === "task" && i.event_id === event.id,
  );
  return (
    <button className="event-summary" onClick={() => onOpen(event)}>
      <span className="date-tile">
        <small>{dateLabel(eventStartDay(event), { month: "short" })}</small>
        <strong>{dateLabel(eventStartDay(event), { day: "numeric" })}</strong>
      </span>
      <span>
        <strong>{event.title}</strong>
        <small>
          {event.event_type === "fight" ? "Fight" : "Event"}
          {event.athlete_id
            ? ` · ${data.sponsorships.find((s) => s.id === event.athlete_id)?.athlete_name || "Athlete"}`
            : ""}
        </small>
        <small>
          {eventTimeLabel(event)}
          {event.location ? ` · ${event.location}` : ""}
        </small>
        {event.content_needs && (
          <span className="event-content-preview">{event.content_needs}</span>
        )}
        {ts.length > 0 && (
          <em>
            {ts.filter((t) => t.status === "done").length}/{ts.length} tasks
            done
          </em>
        )}
      </span>
      <ArrowRight size={17} />
    </button>
  );
}
function TeamWeek({
  embedded = false,
  data,
  onOpen,
  onClaim,
  onDone,
  onCreate,
}: {
  embedded?: boolean;
  data: Snapshot;
  onOpen: (i: Item) => void;
  onClaim: (i: Item) => void;
  onDone: (i: Item) => void;
  onCreate: (person: string | null, week: string) => void;
}) {
  const [week, setWeek] = useState(weekStart());
  const tasks = data.items.filter((i) => isInWeek(i, week));
  const done = tasks.filter((i) => i.status === "done").length;
  const groups = [
    ...data.members.map((m) => ({ id: m.user_id, name: m.name })),
    { id: null, name: "Unassigned" },
  ];
  const unscheduled = data.items.filter(
    (i) =>
      i.kind === "task" && i.status !== "done" && !i.week_of && !i.due_date,
  ).length;
  return (
    <>
      {!embedded && (
        <Heading eyebrow="" title="Team week" description="">
          <button
            className="button primary"
            onClick={() => onCreate(null, week)}
          >
            <Plus size={17} />
            Add task
          </button>
        </Heading>
      )}
      <div className="toolbar">
        <div className="week-picker">
          <button
            aria-label="Previous week"
            onClick={() => setWeek(addDays(week, -7))}
          >
            <ChevronLeft size={18} />
          </button>
          <strong>
            {dateLabel(week)} – {dateLabel(addDays(week, 6))}
          </strong>
          <button
            aria-label="Next week"
            onClick={() => setWeek(addDays(week, 7))}
          >
            <ChevronRight size={18} />
          </button>
          <button className="text-button" onClick={() => setWeek(weekStart())}>
            This week
          </button>
        </div>
        {embedded && (
          <button
            className="button primary"
            onClick={() => onCreate(null, week)}
          >
            <Plus size={17} />
            Add task
          </button>
        )}
        <span className="team-week-summary">
          {done}/{tasks.length} done ·{" "}
          {tasks.filter((t) => !t.assignee_id).length} unassigned
        </span>
      </div>
      {unscheduled > 0 && (
        <p className="notice">
          {unscheduled} {unscheduled === 1 ? "task needs" : "tasks need"} a
          date.
        </p>
      )}
      <div className="team-week-grid">
        {groups.map((group) => {
          const list = tasks
            .filter((t) => (group.id ? isOnTask(t, group.id) : !t.assignee_id))
            .sort(
              (a, b) =>
                Number(a.status === "done") - Number(b.status === "done") ||
                (a.due_date || "9999").localeCompare(b.due_date || "9999") ||
                a.title.localeCompare(b.title),
            );
          return (
            <section
              className="panel person-week"
              key={group.id || "unassigned"}
            >
              <div className="person-week-header">
                <span className="avatar">
                  {group.id ? initials(group.name) : "?"}
                </span>
                <div>
                  <h2>{group.name}</h2>
                  <small>
                    {list.filter((t) => t.status === "done").length}/
                    {list.length} done
                  </small>
                </div>
                <button
                  className="text-button"
                  onClick={() => onCreate(group.id, week)}
                  aria-label={`Plan task for ${group.name}`}
                >
                  <Plus size={15} />
                  Add task
                </button>
              </div>
              {list.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  data={data}
                  onOpen={onOpen}
                  onClaim={onClaim}
                  onDone={onDone}
                />
              ))}
              {!list.length && (
                <div className="person-week-empty">
                  {group.id ? "No tasks this week" : "No unassigned tasks"}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
function Weekly({
  data,
  userId,
  onOpen,
  onClaim,
  onDone,
  onCreate,
}: {
  data: Snapshot;
  userId: string;
  onOpen: (i: Item) => void;
  onClaim: (i: Item) => void;
  onDone: (i: Item) => void;
  onCreate: (person: string, week: string) => void;
}) {
  const [week, setWeek] = useState(weekStart()),
    [person, setPerson] = useState(userId);
  const tasks = data.items.filter(
    (i) => isOnTask(i, person) && isInWeek(i, week),
  );
  const other = data.items.filter(
    (i) =>
      i.kind === "task" &&
      isOnTask(i, person) &&
      i.status !== "done" &&
      !tasks.some((t) => t.id === i.id),
  );
  const done = tasks.filter((t) => t.status === "done").length;
  return (
    <>
      <Heading eyebrow="" title="My week" description="">
        <button
          className="button primary"
          onClick={() => onCreate(person, week)}
        >
          <Plus size={17} />
          Add task
        </button>
      </Heading>
      <div className="toolbar">
        <div className="week-picker">
          <button
            aria-label="Previous week"
            onClick={() => setWeek(addDays(week, -7))}
          >
            <ChevronLeft size={18} />
          </button>
          <strong>
            {dateLabel(week)} – {dateLabel(addDays(week, 6))}
          </strong>
          <button
            aria-label="Next week"
            onClick={() => setWeek(addDays(week, 7))}
          >
            <ChevronRight size={18} />
          </button>
          <button className="text-button" onClick={() => setWeek(weekStart())}>
            This week
          </button>
        </div>
        {
          <label className="inline-label">
            Person
            <select value={person} onChange={(e) => setPerson(e.target.value)}>
              {data.members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        }
      </div>
      <div className="weekly-progress">
        <div>
          <strong>
            {done} of {tasks.length}
          </strong>
          <span>weekly deliverables done</span>
        </div>
        <div className="progress-track">
          <span
            style={{
              width: `${tasks.length ? (done / tasks.length) * 100 : 0}%`,
            }}
          />
        </div>
        <span>
          {tasks.length ? Math.round((done / tasks.length) * 100) : 0}%
        </span>
      </div>
      <section className="panel">
        <PanelTitle title="This week" subtitle="" />
        <div className="list">
          {tasks.map((i) => (
            <ItemRow
              key={i.id}
              item={i}
              data={data}
              onOpen={onOpen}
              onClaim={onClaim}
              onDone={onDone}
            />
          ))}
          {!tasks.length && <Empty title="No tasks this week" text="" />}
        </div>
      </section>
      {other.length > 0 && (
        <section className="panel spaced">
          <PanelTitle title="Other tasks" subtitle="" />
          {other.map((i) => (
            <ItemRow
              key={i.id}
              item={i}
              data={data}
              onOpen={onOpen}
              onClaim={onClaim}
              onDone={onDone}
            />
          ))}
        </section>
      )}
    </>
  );
}
function Board({
  initialScope,
  data,
  userId,
  content,
  onOpen,
  onClaim,
  onDone,
  onCreate,
  onPlan,
}: {
  initialScope: string;
  data: Snapshot;
  userId: string;
  content: boolean;
  onOpen: (item: Item) => void;
  onClaim: (item: Item) => void;
  onDone: (item: Item) => void;
  onCreate: (initial?: Partial<ItemInput>) => void;
  onPlan: (person: string | null, week: string) => void;
}) {
  const [tab, setTab] = useState(
    content || initialScope !== "mine" ? "unassigned" : "mine",
  );
  const [category, setCategory] = useState(content ? "Content" : "all");
  const [query, setQuery] = useState("");
  const tasks = data.items
    .filter(
      (i) =>
        i.kind === "task" &&
        (tab !== "mine" || isOnTask(i, userId)) &&
        (tab !== "unassigned" || !taskPeople(i).length) &&
        (category === "all" || i.category === category) &&
        i.title.toLowerCase().includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        (a.due_date || "9999").localeCompare(b.due_date || "9999") ||
        a.title.localeCompare(b.title),
    );
  const active = tasks.filter((t) => t.status !== "done"),
    done = tasks.filter((t) => t.status === "done");
  const renderTask = (task: Item) => {
    const names = taskPeople(task)
      .map((id) => data.members.find((m) => m.user_id === id)?.name)
      .filter(Boolean);
    return (
      <article className="simple-task" key={task.id}>
        <DoneButton item={task} onDone={onDone} />
        <button className="simple-task-main" onClick={() => onOpen(task)}>
          <strong>{task.title}</strong>
          <span>{names.length ? names.join(", ") : "Unassigned"}</span>
          {task.due_date && (
            <small
              className={
                task.due_date < localDate() && task.status !== "done"
                  ? "overdue"
                  : ""
              }
            >
              Due {dateLabel(task.due_date)}
            </small>
          )}
          {task.priority !== "normal" && (
            <small className={`priority ${task.priority}`}>
              {task.priority}
            </small>
          )}
        </button>
        <div className="simple-task-actions">
          <button className="text-button" onClick={() => onOpen(task)}>
            {names.length ? "Edit" : "Assign"}
          </button>
          {!names.length && task.status === "open" && (
            <button className="claim" onClick={() => onClaim(task)}>
              Take task
            </button>
          )}
        </div>
      </article>
    );
  };
  return (
    <>
      <Heading eyebrow="" title="Tasks" description="">
        {tab !== "week" && (
          <button
            className="button primary"
            onClick={() =>
              onCreate({
                assignee_id: tab === "mine" ? userId : null,
              })
            }
          >
            <Plus size={17} />
            Add task
          </button>
        )}
      </Heading>
      <div className="tabs task-tabs" aria-label="Task views">
        {[
          ["mine", "My tasks"],
          ["unassigned", "Unassigned tasks"],
          ["week", "Team week"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "week" ? (
        <TeamWeek
          embedded
          data={data}
          onOpen={onOpen}
          onClaim={onClaim}
          onDone={onDone}
          onCreate={onPlan}
        />
      ) : (
        <>
          {tab === "unassigned" && (
            <div className="task-filters">
              <details className="more-details task-filter-details">
                <summary>Filter</summary>
                <div className="details-body">
                  <label>
                    Search
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Find a task"
                    />
                  </label>
                  <label>
                    Category
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="all">All categories</option>
                      {[
                        ...new Set(
                          data.items
                            .filter((i) => i.kind === "task")
                            .map((i) => i.category),
                        ),
                      ].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </details>
            </div>
          )}
          <section className="panel simple-task-list" aria-label="Tasks to do">
            <div className="simple-list-heading">
              <h2>To do</h2>
              <span>{active.length}</span>
            </div>
            {active.map(renderTask)}
            {!active.length && (
              <Empty
                title={
                  tab === "mine"
                    ? "No tasks assigned to you"
                    : "No unassigned tasks"
                }
                text=""
              />
            )}
          </section>
          {done.length > 0 && (
            <details
              className="panel completed-tasks"
              open={initialScope === "done" ? true : undefined}
            >
              <summary>
                Done <span>{done.length}</span>
              </summary>
              {done.map(renderTask)}
            </details>
          )}
        </>
      )}
    </>
  );
}
function Events({
  data,
  store,
  onOpen,
  onCreate,
}: {
  data: Snapshot;
  store: ReturnType<typeof useWorkspace>;
  onOpen: (i: Item) => void;
  onCreate: (day?: string) => void;
}) {
  const [month, setMonth] = useState(
      new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    ),
    [selected, setSelected] = useState(""),
    [athlete, setAthlete] = useState("all"),
    [eventType, setEventType] = useState("all"),
    [calendarView, setCalendarView] = useState(() =>
      matchMedia("(max-width: 650px)").matches ? "schedule" : "month",
    ),
    [feed, setFeed] = useState<CalendarFeed | null>(null);
  const first = new Date(month),
    offset = (first.getDay() + 6) % 7;
  first.setDate(first.getDate() - offset);
  const days = Array.from({ length: 42 }, (_, i) =>
    addDays(localDate(first), i),
  );
  const start = new Date(days[0] + "T00:00:00").toISOString();
  const end = new Date(addDays(days[41], 1) + "T00:00:00").toISOString();
  const currentFeed =
    feed?.range_start === start && feed.range_end === end ? feed : null;
  const events = calendarEntries(data.items, currentFeed).filter(
    (e) =>
      (athlete === "all" || e.item?.athlete_id === athlete) &&
      (eventType === "all" || (e.item?.event_type || "event") === eventType),
  );
  const shown = events.filter((e) =>
    selected
      ? eventOnDay(e, selected)
      : eventStartDay(e) <
          localDate(new Date(month.getFullYear(), month.getMonth() + 1, 1)) &&
        eventEndDay(e) >= localDate(month),
  );
  return (
    <>
      <Heading
        eyebrow=""
        title={feed?.connection ? "Google Calendar" : "Calendar"}
        description=""
      >
        {
          <button
            className="button primary"
            onClick={() => onCreate(selected || undefined)}
          >
            <Plus size={17} />
            New event
          </button>
        }
      </Heading>
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
      <div className="toolbar calendar-filters">
        <div className="tabs" aria-label="Calendar view">
          {["schedule", "month"].map((v) => (
            <button
              key={v}
              aria-pressed={calendarView === v}
              className={calendarView === v ? "active" : ""}
              onClick={() => {
                setCalendarView(v);
                setSelected("");
              }}
            >
              {v === "schedule" ? "Schedule" : "Month"}
            </button>
          ))}
        </div>
        <label className="inline-label">
          Athlete
          <select value={athlete} onChange={(e) => setAthlete(e.target.value)}>
            <option value="all">All athletes</option>
            {data.sponsorships
              .filter((s) => s.record_type === "athlete")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.athlete_name}
                </option>
              ))}
          </select>
        </label>
        <div className="tabs">
          {["all", "fight", "event"].map((t) => (
            <button
              key={t}
              className={eventType === t ? "active" : ""}
              onClick={() => setEventType(t)}
            >
              {t === "all" ? "All" : t === "fight" ? "Fights" : "Events"}
            </button>
          ))}
        </div>
      </div>
      <div className={`calendar-layout calendar-view-${calendarView}`}>
        <section className="panel calendar">
          <div className="calendar-heading">
            <h2>
              {month.toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </h2>
            <div>
              <button
                aria-label="Previous month"
                onClick={() => {
                  setMonth(
                    new Date(month.getFullYear(), month.getMonth() - 1, 1),
                  );
                  setSelected("");
                }}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setMonth(
                    new Date(
                      new Date().getFullYear(),
                      new Date().getMonth(),
                      1,
                    ),
                  );
                  setSelected("");
                }}
              >
                Today
              </button>
              <button
                aria-label="Next month"
                onClick={() => {
                  setMonth(
                    new Date(month.getFullYear(), month.getMonth() + 1, 1),
                  );
                  setSelected("");
                }}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          {calendarView === "month" && (
            <>
              <div className="calendar-weekdays">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="calendar-grid">
                {days.map((d) => (
                  <button
                    key={d}
                    onClick={() => setSelected(selected === d ? "" : d)}
                    className={`calendar-day ${d.slice(0, 7) !== localDate(month).slice(0, 7) ? "outside" : ""} ${d === localDate() ? "today" : ""} ${d === selected ? "selected" : ""}`}
                    aria-label={`${dateLabel(d)} · ${events.filter((e) => eventOnDay(e, d)).length} events`}
                  >
                    <span>{Number(d.slice(8))}</span>
                    {events
                      .filter((e) => eventOnDay(e, d))
                      .map((e) => (
                        <small key={e.id} title={e.title}>
                          {e.title}
                        </small>
                      ))}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
        <section className="panel calendar-agenda">
          <PanelTitle
            title={selected ? dateLabel(selected) : "This month"}
            subtitle=""
          />
          {shown.map((e) => (
            <article key={e.id} className="calendar-agenda-event">
              <span
                className={`calendar-event-source ${e.pending ? "pending" : ""}`}
              >
                {e.pending
                  ? "Saving to Google…"
                  : e.google
                    ? "Google Calendar"
                    : "Motion OS"}
              </span>
              {e.item ? (
                <EventSummary event={e.item} data={data} onOpen={onOpen} />
              ) : (
                <details className="google-event-details">
                  <summary>
                    <span className="date-tile">
                      <small>
                        {dateLabel(eventStartDay(e), { month: "short" })}
                      </small>
                      <strong>
                        {dateLabel(eventStartDay(e), { day: "numeric" })}
                      </strong>
                    </span>
                    <span>
                      <strong>{e.title}</strong>
                      <small>
                        {eventTimeLabel(e)}
                        {e.location ? ` · ${e.location}` : ""}
                      </small>
                    </span>
                  </summary>
                  <p>{e.description || "No description"}</p>
                </details>
              )}
            </article>
          ))}
          {!shown.length && (
            <Empty
              title={
                currentFeed?.connection
                  ? "No Google Calendar events this month"
                  : "No events"
              }
              text="Use New event to add something to the calendar."
            />
          )}
          <button
            className="button calendar-add-bottom"
            onClick={() => onCreate(selected || undefined)}
          >
            <Plus size={17} />
            New event
          </button>
        </section>
      </div>
    </>
  );
}
function Team({
  store,
  install,
}: {
  store: ReturnType<typeof useWorkspace>;
  install: () => void;
}) {
  const data = store.data!,
    me = data.members.find((m) => m.user_id === store.userId);
  const [invite, setInvite] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function invitation(action: "copy" | "rotate" | "disable") {
    setBusy(true);
    try {
      if (store.preview)
        throw new Error("Invite links are available in your live workspace.");
      const r =
        action === "disable"
          ? await supabase!.rpc("disable_workspace_invite", {
              p_workspace: data.workspace.id,
            })
          : await supabase!.rpc("get_workspace_invite", {
              p_workspace: data.workspace.id,
              p_rotate: action === "rotate",
            });
      if (r.error) throw r.error;
      if (action === "disable") {
        setInvite("");
        setMessage(
          "Invite link turned off. Existing members keep their access.",
        );
      } else {
        const link = `${location.origin}/#join=${r.data}`;
        setInvite(link);
        try {
          await navigator.clipboard.writeText(link);
          setMessage(
            action === "rotate"
              ? "New link copied. The old link no longer admits anyone."
              : "Invite link copied. Share it with your team.",
          );
        } catch {
          setMessage(
            "Your invite link is ready. Copy it from the field below.",
          );
        }
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(user: string | null, address: string | null) {
    setBusy(true);
    try {
      if (store.preview)
        throw new Error("Account access is not changed in sample mode.");
      const r = await supabase!.rpc("remove_access", {
        p_workspace: data.workspace.id,
        p_user: user,
        p_email: address,
      });
      if (r.error) throw r.error;
      await store.refresh();
      setMessage("Access removed.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading eyebrow="" title="Team & access" description="" />
      <div className="team-layout">
        <section className="panel">
          <PanelTitle
            title={`${data.members.length} ${data.members.length === 1 ? "person" : "people"} in ${data.workspace.name}`}
            subtitle="Everyone can assign work and check it off. The owner manages access."
          />
          {data.members.map((m) => (
            <div className="member-row" key={m.user_id}>
              <span className="avatar">{initials(m.name)}</span>
              <div>
                <strong>
                  {m.name}
                  {m.user_id === store.userId ? " (you)" : ""}
                </strong>
                <small>
                  {
                    data.items.filter(
                      (t) =>
                        t.kind === "task" &&
                        isOnTask(t, m.user_id) &&
                        t.status !== "done",
                    ).length
                  }{" "}
                  active tasks
                </small>
              </div>
              <span className="role">
                {m.role === "admin" ? "Owner" : "Member"}
              </span>
              {me?.role === "admin" &&
                m.user_id !== data.workspace.owner_id && (
                  <button
                    className="text-button danger"
                    disabled={busy}
                    onClick={() => void remove(m.user_id, null)}
                  >
                    Remove access
                  </button>
                )}
            </div>
          ))}
          {data.grants.length > 0 && (
            <>
              <PanelTitle title="Waiting to join" />
              {data.grants.map((g) => (
                <div className="member-row" key={g.email}>
                  <div>
                    <strong>{g.email}</strong>
                    <small>{g.role}</small>
                  </div>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void remove(null, g.email)}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </>
          )}
        </section>
        <div>
          {me?.role === "admin" && (
            <section className="panel settings-panel">
              <h2>Invite members</h2>
              <p>
                Anyone with this link can sign in and join. Members can view,
                assign and complete shared work. Personal to-dos stay private.
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => invitation("copy")}
              >
                Create / copy invite link
              </button>
              {invite && (
                <label>
                  Team invite link
                  <input
                    readOnly
                    value={invite}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
              )}
              <button
                className="button"
                disabled={busy}
                onClick={() => invitation("rotate")}
              >
                Replace invite link
              </button>
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() => invitation("disable")}
              >
                Turn off invite link
              </button>
            </section>
          )}
          <section className="panel settings-panel spaced">
            <h2>Settings</h2>
            <p>
              Add Motion to your home screen for quick access. Export the
              records you can view whenever you need a copy.
            </p>
            <button className="button" onClick={install}>
              <ArrowDownToLine size={16} />
              Add to home screen
            </button>
            <button
              className="button"
              onClick={() => {
                const blob = new Blob(
                  [
                    JSON.stringify(
                      { exportedAt: new Date().toISOString(), ...data },
                      null,
                      2,
                    ),
                  ],
                  { type: "application/json" },
                );
                const url = URL.createObjectURL(blob),
                  a = document.createElement("a");
                a.href = url;
                a.download = `motion-workspace-${localDate()}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Export my accessible records
            </button>
            {store.workspaces.length > 1 && (
              <label>
                Switch workspace
                <select
                  value={data.workspace.id}
                  onChange={(e) => store.setWorkspaceId(e.target.value)}
                >
                  {store.workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!store.preview && (
              <button className="button" onClick={store.enterPreview}>
                View sample
              </button>
            )}
            {store.preview && (
              <button
                className="button"
                onClick={() => {
                  store.resetPreview();
                  setMessage("Sample workspace reset.");
                }}
              >
                Reset sample workspace
              </button>
            )}
            <button
              className="text-button"
              onClick={store.preview ? store.exitPreview : store.signOut}
            >
              <LogOut size={15} />
              {store.preview
                ? store.session
                  ? "Return to workspace"
                  : "Exit sample"
                : "Sign out"}
            </button>
          </section>
        </div>
      </div>
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
    </>
  );
}
function Install({ onClose }: { onClose: () => void }) {
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    modal.current?.showModal();
  }, []);
  return (
    <dialog
      ref={modal}
      className="install-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="install-modal"
        aria-labelledby="install-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="icon-button close"
          aria-label="Close install instructions"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <MotionIcon />
        <h2 id="install-title">One tap to get moving.</h2>
        <p>
          Open the app’s live address in your phone’s browser, then add Motion
          to your home screen.
        </p>
        <div>
          <strong>iPhone / iPad</strong>
          <p>
            In Safari, open the Share menu, choose Add to Home Screen, then Add.
          </p>
        </div>
        <div>
          <strong>Android</strong>
          <p>
            In Chrome, open the ⋮ menu and choose Install app or Add to Home
            screen.
          </p>
        </div>
        <div>
          <strong>Desktop</strong>
          <p>
            Use your browser’s install option, when available, or bookmark this
            address.
          </p>
        </div>
        <small>
          An internet connection is needed to load and save shared workspace
          data.
        </small>
        <button className="button primary full" onClick={onClose}>
          Got it <Check size={16} />
        </button>
      </div>
    </dialog>
  );
}

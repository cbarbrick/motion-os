import { useEffect, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  MessageSquare,
  Plus,
  Search,
  Trophy,
  Handshake,
  X,
  CalendarDays,
  UserRound,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import {
  blankSponsorship,
  sponsorshipInputOf,
  sponsorshipLabels,
  dateLabel,
  localDate,
  initials,
  type Item,
  type Sponsorship,
  type SponsorshipInput,
  type SponsorshipStatus,
  type ReviewStatus,
} from "./model";
import { eventStartDay, eventEndDay } from "./event-time";
import type { useWorkspace } from "./use-workspace";
type Store = ReturnType<typeof useWorkspace>;
type RecordType = SponsorshipInput["record_type"];
const profileLabels = {
  athlete: { singular: "Athlete", plural: "Athletes", add: "Add athlete" },
  affiliate: {
    singular: "Affiliate",
    plural: "Affiliates",
    add: "Add affiliate",
  },
  person: { singular: "Person", plural: "People", add: "Add person" },
};

export function Sponsorships({
  store,
  type = "athlete",
  onCreateEvent,
  onOpenEvent,
}: {
  store: Store;
  type?: RecordType;
  onCreateEvent: (athlete: string) => void;
  onOpenEvent: (event: Item) => void;
}) {
  const data = store.data!;
  const [selected, setSelected] = useState<string | null>(null),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState(type === "athlete" ? "list" : "review");
  const owner = data.workspace.owner_id === store.userId;
  const reviewer = data.members.find(
    (m) => m.user_id === data.sponsorshipReviewer,
  );
  const records = data.sponsorships.filter((s) => s.record_type === type);
  const rows = records
    .filter(
      (s) =>
        (filter === "all" || s.status === filter) &&
        `${s.athlete_name} ${s.sport} ${s.proposal}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const person = type === "person";
  const athlete = type === "athlete";
  const copy = profileLabels[type];
  async function chooseReviewer(id: string) {
    setBusy(true);
    setMessage("");
    try {
      await store.setSponsorshipReviewer(id || null);
      setMessage("Reviewer saved");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="heading">
        <h1>{copy.plural}</h1>
        <button className="button primary" onClick={() => setSelected("new")}>
          <Plus size={18} />
          {copy.add}
        </button>
      </div>
      {!athlete && (
        <section className="panel sponsorship-reviewer">
          <div>
            <h2>Reviewer{reviewer ? `: ${reviewer.name}` : " not selected"}</h2>
            <p>
              {reviewer
                ? "Approves affiliates and people."
                : "Select David after he joins."}
            </p>
          </div>
          {owner && (
            <label>
              Reviewer
              <select
                aria-label="Reviewer"
                disabled={busy}
                value={reviewer?.user_id || ""}
                onChange={(e) => void chooseReviewer(e.target.value)}
              >
                <option value="">Select reviewer</option>
                {data.members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {!athlete && (
        <div className="toolbar">
          <div className="tabs">
            <button
              className={mode === "review" ? "active" : ""}
              onClick={() => setMode("review")}
            >
              Review cards{" "}
              <span>
                {records.filter((s) => s.status === "pending").length}
              </span>
            </button>
            <button
              className={mode === "list" ? "active" : ""}
              onClick={() => setMode("list")}
            >
              All {copy.plural.toLowerCase()}
            </button>
          </div>
        </div>
      )}
      {!athlete && mode === "review" ? (
        <ReviewCards
          store={store}
          records={records}
          addLabel={copy.add}
          onOpen={(s) => setSelected(s.id)}
          onAdd={() => setSelected("new")}
        />
      ) : (
        <>
          <div className="toolbar sponsorship-toolbar">
            {!athlete && (
              <div className="tabs">
                {["all", "pending", "approved", "denied"].map((s) => (
                  <button
                    key={s}
                    className={filter === s ? "active" : ""}
                    onClick={() => setFilter(s)}
                  >
                    {s === "all"
                      ? "All"
                      : sponsorshipLabels[s as SponsorshipStatus]}{" "}
                    <span>
                      {
                        records.filter((p) => s === "all" || p.status === s)
                          .length
                      }
                    </span>
                  </button>
                ))}
              </div>
            )}
            <label className="athlete-search">
              <Search size={18} />
              <input
                aria-label={`Search ${copy.plural.toLowerCase()}`}
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <div className="sponsorship-grid">
            {rows.map((s) => {
              const events = athleteEvents(data.items, s.id);
              return (
                <article className="panel sponsorship-card" key={s.id}>
                  <button
                    className="profile-card-main"
                    onClick={() => setSelected(s.id)}
                  >
                    <div className="sponsorship-card-top">
                      <span className="athlete-icon">
                        {athlete ? (
                          <Trophy size={24} />
                        ) : person ? (
                          <UserRound size={24} />
                        ) : (
                          <Handshake size={24} />
                        )}
                      </span>
                      {!athlete && (
                        <span className={`sponsor-status ${s.status}`}>
                          {sponsorshipLabels[s.status]}
                        </span>
                      )}
                    </div>
                    <h2>{s.athlete_name}</h2>
                    <span className="category">
                      {s.sport ||
                        (athlete
                          ? "Sport not added"
                          : person
                            ? "Role not added"
                            : "Category not added")}
                    </span>
                    {!athlete && (
                      <strong className="profile-rate">
                        {s.rate || "Rate not added"}
                      </strong>
                    )}
                    {s.proposal && <p>{s.proposal}</p>}
                    {!athlete && s.requested_support && (
                      <dl>
                        <dt>Requested support</dt>
                        <dd>{s.requested_support}</dd>
                      </dl>
                    )}
                    <span className="text-button">
                      View profile <ArrowRight size={16} />
                    </span>
                  </button>
                  {athlete && (
                    <div className="athlete-event-list">
                      <div className="section-line">
                        <h3>Upcoming</h3>
                        <button
                          className="text-button"
                          onClick={() => onCreateEvent(s.id)}
                        >
                          <Plus size={16} />
                          Add event
                        </button>
                      </div>
                      {events.length ? (
                        events.slice(0, 3).map((e) => (
                          <button
                            className="athlete-event"
                            key={e.id}
                            onClick={() => onOpenEvent(e)}
                          >
                            <CalendarDays size={18} />
                            <span>
                              <strong>{e.title}</strong>
                              <small>
                                {dateLabel(eventStartDay(e))} ·{" "}
                                {e.event_type === "fight" ? "Fight" : "Event"}
                              </small>
                            </span>
                          </button>
                        ))
                      ) : (
                        <p className="muted">No scheduled events</p>
                      )}
                      {events.length > 3 && (
                        <button
                          className="text-button"
                          onClick={() => setSelected(s.id)}
                        >
                          View all {events.length} events
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {!rows.length && (
            <div className="panel sponsorship-empty">
              <h2>
                {records.length
                  ? "No matches"
                  : `No ${copy.plural.toLowerCase()} added`}
              </h2>
              <button
                className="button primary"
                onClick={() => setSelected("new")}
              >
                <Plus size={18} />
                {copy.add}
              </button>
            </div>
          )}
        </>
      )}
      {selected && (
        <SponsorshipDetails
          key={selected}
          type={type}
          proposal={
            selected === "new"
              ? null
              : data.sponsorships.find((s) => s.id === selected) || null
          }
          store={store}
          onClose={() => setSelected(null)}
          onCreated={(s) => setSelected(s.id)}
          onCreateEvent={onCreateEvent}
          onOpenEvent={onOpenEvent}
        />
      )}
    </>
  );
}
function athleteEvents(items: Item[], id: string) {
  return items
    .filter(
      (i) =>
        i.kind === "event" &&
        i.athlete_id === id &&
        i.status !== "complete" &&
        i.starts_at &&
        eventEndDay(i) >= localDate(),
    )
    .sort((a, b) => (a.starts_at || "").localeCompare(b.starts_at || ""));
}
function ReviewCards({
  store,
  records,
  addLabel,
  onOpen,
  onAdd,
}: {
  store: Store;
  records: Sponsorship[];
  addLabel: string;
  onOpen: (s: Sponsorship) => void;
  onAdd: () => void;
}) {
  const [skipped, setSkipped] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [last, setLast] = useState<Sponsorship | null>(null);
  const locked = useRef(false);
  const pending = records
    .filter((s) => s.status === "pending")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const current = pending.find((s) => !skipped.includes(s.id));
  const canReview = store.data!.sponsorshipReviewer === store.userId;
  useEffect(() => {
    setNote("");
    setError("");
  }, [current?.id]);
  async function decide(status: "approved" | "denied") {
    if (!current || !canReview || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await store.reviewSponsorship(current, status, note);
      setLast(saved);
      setNote("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function undo() {
    if (!last || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await store.reviewSponsorship(last, "pending", "Decision undone");
      setSkipped((ids) => ids.filter((id) => id !== last.id));
      setLast(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="review-layout">
      <div className="review-queue-info">
        <h2>{pending.length} pending</h2>

        {!canReview && <p>Only the selected reviewer can decide.</p>}
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {last && (
        <div className="review-result" role="status">
          <span>
            {last.athlete_name}: {sponsorshipLabels[last.status]}
          </span>
          <button className="text-button" disabled={busy} onClick={undo}>
            <RotateCcw size={16} />
            Undo
          </button>
        </div>
      )}
      {current ? (
        <>
          <article className="review-card">
            <div className="review-card-cover">
              <span className="review-initials">
                {initials(current.athlete_name)}
              </span>
              <span className="review-type">
                {current.sport ||
                  (current.record_type === "affiliate"
                    ? "Category not added"
                    : "Role not added")}
              </span>
            </div>
            <div className="review-card-body">
              <h2>{current.athlete_name}</h2>
              <p className="muted">
                Submitted by{" "}
                {store.data!.members.find(
                  (m) => m.user_id === current.created_by,
                )?.name || "Previous member"}
              </p>
              <p className="review-rate">{current.rate || "Rate not added"}</p>
              <p className="review-description">
                {current.proposal || "No description"}
              </p>
              {current.deliverables && (
                <p>
                  <span className="field-caption">Scope</span>
                  {current.deliverables}
                </p>
              )}
              {current.timing && (
                <p>
                  <span className="field-caption">Availability</span>
                  {current.timing}
                </p>
              )}
              <button className="text-button" onClick={() => onOpen(current)}>
                Profile & comments <ArrowRight size={17} />
              </button>
            </div>
          </article>
          {canReview && (
            <label className="decision-note">
              Decision note
              <textarea
                value={note}
                rows={2}
                maxLength={4000}
                disabled={busy}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional"
              />
            </label>
          )}
          <div className="review-buttons">
            <button
              className="review-deny"
              disabled={!canReview || busy}
              onClick={() => void decide("denied")}
            >
              <X size={24} />
              Deny
            </button>
            <button
              className="review-skip"
              disabled={busy}
              onClick={() => {
                setSkipped([...skipped, current.id]);
              }}
            >
              Skip
            </button>
            <button
              className="review-approve"
              disabled={!canReview || busy}
              onClick={() => void decide("approved")}
            >
              <Check size={24} />
              Approve
            </button>
          </div>
        </>
      ) : (
        <div className="panel sponsorship-empty">
          <Check size={36} />
          <h2>
            {pending.length
              ? "All remaining profiles skipped"
              : "No pending profiles"}
          </h2>
          {pending.length > 0 ? (
            <button className="button" onClick={() => setSkipped([])}>
              Review skipped profiles
            </button>
          ) : (
            <button className="button primary" onClick={onAdd}>
              <Plus size={18} />
              {addLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SponsorshipDetails({
  proposal,
  store,
  onClose,
  onCreated,
  type,
  onCreateEvent,
  onOpenEvent,
}: {
  type: RecordType;
  onCreateEvent: (athlete: string) => void;
  onOpenEvent: (event: Item) => void;
  proposal: Sponsorship | null;
  store: Store;
  onClose: () => void;
  onCreated: (s: Sponsorship) => void;
}) {
  const person = type === "person";
  const athlete = type === "athlete";
  const copy = profileLabels[type];
  const key = `motion-sponsor-draft:${store.preview ? "sample" : "live"}:${store.userId}:${store.data!.workspace.id}:${proposal?.id || `new-${type}`}`;
  const draftBase = useRef<number | null>(null);
  const [form, setForm] = useState<SponsorshipInput>(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(key) || "null");
      if (
        draft &&
        typeof draft.form?.athlete_name === "string" &&
        Number.isInteger(draft.version)
      ) {
        draftBase.current = draft.version;
        return { ...blankSponsorship(type), ...draft.form };
      }
    } catch {}
    return proposal ? sponsorshipInputOf(proposal) : blankSponsorship(type);
  });
  const [record, setRecord] = useState(proposal),
    [comment, setComment] = useState(() => {
      try {
        return localStorage.getItem(key + ":comment") || "";
      } catch {
        return "";
      }
    }),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [draftWarning, setDraftWarning] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    current = useRef(
      proposal
        ? { ...proposal, version: draftBase.current ?? proposal.version }
        : null,
    ),
    latest = useRef(form),
    lastSaved = useRef(
      proposal ? JSON.stringify(sponsorshipInputOf(proposal)) : "",
    ),
    running = useRef(false),
    mounted = useRef(true),
    saveRef = useRef(store.saveSponsorship);
  latest.current = form;
  saveRef.current = store.saveSponsorship;
  const reviewer = store.data!.members.find(
    (m) => m.user_id === store.data!.sponsorshipReviewer,
  );
  const canReview = !athlete && !!reviewer && reviewer.user_id === store.userId;
  const history = store
    .data!.sponsorshipComments.filter((c) => c.sponsorship_id === record?.id)
    .sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
  const dirty = JSON.stringify(form) !== lastSaved.current;
  useEffect(() => {
    mounted.current = true;
    dialog.current?.showModal();
    return () => {
      mounted.current = false;
    };
  }, []);
  function remember(next: SponsorshipInput) {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ form: next, version: current.current?.version || 0 }),
      );
      setDraftWarning("");
    } catch {
      setDraftWarning(
        "This browser cannot keep a local draft. Keep this window open until the save succeeds.",
      );
    }
  }
  function change(field: keyof SponsorshipInput, value: string) {
    const next = { ...latest.current, [field]: value };
    latest.current = next;
    setForm(next);
    remember(next);
    setError("");
    setMessage(
      current.current ? "Unsaved changes" : "Draft kept on this device",
    );
  }
  function valid(input: SponsorshipInput) {
    return (
      !!input.athlete_name.trim() &&
      (!input.profile_url || /^https:\/\//.test(input.profile_url))
    );
  }
  async function flush(): Promise<Sponsorship | null> {
    if (running.current) return null;
    if (!valid(latest.current)) {
      setError("Add a name. Profile links must start with https://.");
      return null;
    }
    running.current = true;
    setBusy(true);
    setError("");
    try {
      do {
        const input = { ...latest.current };
        const json = JSON.stringify(input);
        if (current.current && json === lastSaved.current) break;
        setMessage("Saving...");
        const saved = await saveRef.current(current.current, input);
        current.current = saved;
        lastSaved.current = json;
        if (!mounted.current) return saved;
        setRecord(saved);
        setMessage(
          store.preview ? "Saved in this browser" : "Saved to workspace",
        );
        if (JSON.stringify(latest.current) === json) {
          try {
            localStorage.removeItem(key);
          } catch {}
        } else remember(latest.current);
        if (!proposal) {
          onCreated(saved);
          return saved;
        }
      } while (JSON.stringify(latest.current) !== lastSaved.current);
      return current.current;
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        setMessage("Not saved");
      }
      return null;
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!proposal || !valid(form) || JSON.stringify(form) === lastSaved.current)
      return;
    const t = setTimeout(() => void flush(), 800);
    return () => clearTimeout(t);
  }, [form]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (
        running.current ||
        (current.current &&
          JSON.stringify(latest.current) !== lastSaved.current)
      )
        e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  async function close() {
    if (running.current) return;
    if (
      proposal &&
      JSON.stringify(latest.current) !== lastSaved.current &&
      !(await flush())
    )
      return;
    onClose();
  }
  function changeComment(value: string) {
    setComment(value);
    try {
      localStorage.setItem(key + ":comment", value);
    } catch {
      setDraftWarning("The comment draft could not be kept on this device.");
    }
  }
  async function submitComment() {
    if (!current.current || !comment.trim()) return;
    setBusy(true);
    setError("");
    try {
      await store.addSponsorshipComment(current.current, comment);
      changeComment("");
      setMessage("Comment posted.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function decide(status: ReviewStatus) {
    if (!current.current || running.current || dirty) return;
    setBusy(true);
    setError("");
    try {
      const saved = await store.reviewSponsorship(
        current.current,
        status,
        comment,
      );
      current.current = saved;
      setRecord(saved);
      changeComment("");
      setMessage(
        status === "pending"
          ? "Reopened for review."
          : `${sponsorshipLabels[status]}. Decision saved.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reloadLatest() {
    try {
      await store.refresh();
    } catch {}
    // Close without resaving a stale version. The local draft remains recoverable.
    onClose();
  }
  return (
    <dialog
      ref={dialog}
      className="editor sponsorship-editor"
      aria-labelledby="sponsor-title"
      onCancel={(e) => {
        e.preventDefault();
        void close();
      }}
    >
      <div className="editor-header">
        <div>
          <h2 id="sponsor-title">{record?.athlete_name || copy.add}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close profile"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <div className="editor-body">
        {record && !athlete && (
          <div className="sponsor-detail-status">
            <span className={`sponsor-status ${record.status}`}>
              {sponsorshipLabels[record.status]}
            </span>
            {record.decided_at && (
              <small>
                Decision {dateLabel(record.decided_at)} ·{" "}
                {store.data!.members.find(
                  (m) => m.user_id === record.decided_by,
                )?.name || "Previous reviewer"}
              </small>
            )}
          </div>
        )}
        {record && !athlete && record.status !== "pending" && (
          <p className="notice">Editing details requires a new review.</p>
        )}
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label>
              {athlete ? "Athlete name" : "Name"}
              <input
                value={form.athlete_name}
                maxLength={180}
                onChange={(e) => change("athlete_name", e.target.value)}
                placeholder="Full name"
                autoFocus
              />
            </label>
            <label>
              {athlete ? "Sport" : person ? "Role" : "Category"}
              <input
                value={form.sport}
                maxLength={100}
                onChange={(e) => change("sport", e.target.value)}
                placeholder={
                  athlete ? "MMA" : person ? "Videographer" : "Fitness creator"
                }
              />
            </label>
          </div>
          {!athlete && (
            <label>
              {person ? "Rate" : "Rate / commission"}
              <input
                value={form.rate}
                maxLength={300}
                placeholder={person ? "$750 / day" : "10% commission"}
                onChange={(e) => change("rate", e.target.value)}
              />
            </label>
          )}
          <label>
            Description
            <textarea
              rows={3}
              value={form.proposal}
              maxLength={10000}
              onChange={(e) => change("proposal", e.target.value)}
              placeholder="Background and proposed work"
            />
          </label>
          <details className="more-details">
            <summary>More details</summary>
            <div className="details-body">
              <label>
                Profile link
                <input
                  type="url"
                  value={form.profile_url}
                  maxLength={2000}
                  onChange={(e) => change("profile_url", e.target.value)}
                  placeholder="https://..."
                />
              </label>
              {/^https:\/\//.test(form.profile_url) && (
                <a
                  className="text-button"
                  href={form.profile_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open profile <ExternalLink size={14} />
                </a>
              )}
              <label>
                Contact
                <input
                  value={form.contact}
                  maxLength={300}
                  onChange={(e) => change("contact", e.target.value)}
                  placeholder="Email, handle or agent"
                />
              </label>
              <label>
                {person ? "Experience" : "Audience"}
                <textarea
                  rows={2}
                  value={form.audience}
                  maxLength={1000}
                  onChange={(e) => change("audience", e.target.value)}
                  placeholder={person ? "Previous work" : "Audience details"}
                />
              </label>

              <label>
                {person ? "Additional costs" : "Budget"}
                <textarea
                  rows={2}
                  value={form.requested_support}
                  maxLength={4000}
                  onChange={(e) => change("requested_support", e.target.value)}
                  placeholder="Cash, product, event support, travel or other terms"
                />
              </label>
              <label>
                {person ? "Scope of work" : "Deliverables"}
                <textarea
                  rows={3}
                  value={form.deliverables}
                  maxLength={4000}
                  onChange={(e) => change("deliverables", e.target.value)}
                  placeholder="Posts, videos, appearances, usage rights and quantities"
                />
              </label>
              <label>
                {person ? "Availability" : "Partnership dates"}
                <input
                  value={form.timing}
                  maxLength={1000}
                  onChange={(e) => change("timing", e.target.value)}
                  placeholder="Campaign window, event date or proposed start"
                />
              </label>
            </div>
          </details>
        </fieldset>
        {record && athlete && (
          <section className="athlete-schedule">
            <div className="section-line">
              <h3>Fights & events</h3>
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  const saved = await flush();
                  if (saved) {
                    onClose();
                    onCreateEvent(saved.id);
                  }
                }}
              >
                <Plus size={17} />
                Add event
              </button>
            </div>
            {store
              .data!.items.filter(
                (i) => i.kind === "event" && i.athlete_id === record.id,
              )
              .sort((a, b) =>
                (a.starts_at || "").localeCompare(b.starts_at || ""),
              )
              .map((e) => (
                <button
                  key={e.id}
                  className="athlete-event"
                  disabled={busy}
                  onClick={async () => {
                    const saved = await flush();
                    if (saved) {
                      onClose();
                      onOpenEvent(e);
                    }
                  }}
                >
                  <CalendarDays size={20} />
                  <span>
                    <strong>{e.title}</strong>
                    <small>
                      {dateLabel(eventStartDay(e))} ·{" "}
                      {e.event_type === "fight" ? "Fight" : "Event"}
                      {e.status === "complete" ? " · Complete" : ""}
                    </small>
                    {e.content_needs && (
                      <span className="event-content-preview">
                        {e.content_needs}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            {!store.data!.items.some(
              (i) => i.kind === "event" && i.athlete_id === record.id,
            ) && <p>No events added</p>}
          </section>
        )}
        {record && (
          <section className="sponsor-discussion">
            <h3>{athlete ? "Comments" : "Comments & decisions"}</h3>
            {!athlete && (
              <p>
                {reviewer
                  ? canReview
                    ? "You are the reviewer."
                    : `Reviewer: ${reviewer.name}`
                  : "Select a reviewer to enable decisions."}
              </p>
            )}
            <div className="sponsor-history">
              {history.map((c) => (
                <article key={c.id}>
                  <div>
                    <strong>{c.author_name}</strong>
                    <small>{new Date(c.created_at).toLocaleString()}</small>
                  </div>
                  {c.action !== "comment" && (
                    <span className={`sponsor-status ${c.action}`}>
                      {c.action === "updated"
                        ? "Proposal updated"
                        : c.action === "pending"
                          ? "Reopened for review"
                          : sponsorshipLabels[c.action]}
                    </span>
                  )}
                  {c.body && <p>{c.body}</p>}
                </article>
              ))}
              {!history.length && <p className="muted">No comments</p>}
            </div>
            <label>
              {athlete ? "Comment" : "Comment / decision note"}
              <textarea
                rows={3}
                value={comment}
                maxLength={4000}
                disabled={busy}
                onChange={(e) => changeComment(e.target.value)}
                placeholder="Write a comment"
              />
            </label>
            <div className="sponsor-actions">
              <button
                className="button"
                disabled={busy || !comment.trim()}
                onClick={submitComment}
              >
                <MessageSquare size={16} />
                Post comment
              </button>
              {canReview && (
                <>
                  <button
                    className="button approve"
                    disabled={busy || dirty}
                    onClick={() => decide("approved")}
                  >
                    <Check size={16} />
                    Approve
                  </button>
                  <button
                    className="button deny"
                    disabled={busy || dirty}
                    onClick={() => decide("denied")}
                  >
                    <X size={16} />
                    Deny
                  </button>
                  {record.status !== "pending" && (
                    <button
                      className="text-button"
                      disabled={busy || dirty}
                      onClick={() => decide("pending")}
                    >
                      Reopen review
                    </button>
                  )}
                </>
              )}
            </div>
            {canReview && dirty && (
              <small>Save proposal changes before deciding.</small>
            )}
          </section>
        )}
        {draftWarning && <p className="notice">{draftWarning}</p>}
        {error && (
          <div className="notice error" role="alert">
            <p>{error}</p>
            {error.includes("changed") && (
              <>
                <p>
                  Your draft is still on this device. Download it before
                  discarding it and loading the latest proposal.
                </p>
                <button
                  className="button"
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(latest.current, null, 2)], {
                        type: "application/json",
                      }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "sponsorship-draft.json";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  Download draft
                </button>
                <button
                  className="button"
                  onClick={() => {
                    try {
                      localStorage.removeItem(key);
                    } catch {}
                    void reloadLatest();
                  }}
                >
                  Discard draft & reload
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="editor-footer">
        <span role="status">{message || (proposal ? "Autosave on" : "")}</span>
        <button
          className="button primary"
          disabled={busy || (!proposal && !valid(form))}
          onClick={proposal ? close : () => void flush()}
        >
          {busy ? "Saving..." : proposal ? "Close" : copy.add}
        </button>
      </div>
    </dialog>
  );
}

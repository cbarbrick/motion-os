import { useEffect, useRef, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import {
  blankInput,
  addDays,
  taskPeople,
  weekStart,
  localDate,
  inputOf,
  statuses,
  statusLabel,
  type Item,
  type Kind,
  type ItemInput,
  type Snapshot,
} from "./model";
import { PeoplePicker } from "./people-picker";
import { ItemPhotos, uploadItemPhoto, type PendingPhoto } from "./item-photos";
import { eventStartDay, eventEndDay, localDateTime } from "./event-time";
import {
  beginSave,
  readPendingSave,
  rejectedSave,
  type PendingSave,
} from "./pending-save";
const draftPrefix = "motion-draft-v1:";
export function Editor({
  item,
  kind,
  data,
  userId,
  preview,
  initial,
  onSave,
  onDelete,
  onClose,
  onOpen,
  onNewTask,
  onInviteTeam,
}: {
  item: Item | null;
  kind: Kind;
  data: Snapshot;
  userId: string;
  preview: boolean;
  initial?: Partial<ItemInput>;
  onSave: (
    kind: Kind,
    item: Item | null,
    input: ItemInput,
    request?: string,
  ) => Promise<Item>;
  onDelete: (item: Item) => Promise<void>;
  onClose: () => void;
  onOpen: (item: Item) => void;
  onNewTask: (eventId: string, category: string) => void;
  onInviteTeam: () => void;
}) {
  const key = `${draftPrefix}${preview ? "sample" : "live"}:${userId}:${data.workspace.id}:${item?.id || kind}${!item && initial?.athlete_id ? ":" + initial.athlete_id : ""}`;
  const draftVersion = useRef<number | null>(null);
  const draftRecord = useRef<Item | null>(null);
  const pendingSave = useRef<PendingSave<ItemInput> | null>(null);
  const [form, setForm] = useState<ItemInput>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const d = JSON.parse(raw);
        if (
          Number.isInteger(d.baseVersion) &&
          typeof d.form?.title === "string" &&
          typeof d.form?.description === "string"
        ) {
          draftVersion.current = d.baseVersion;
          if (
            d.record?.workspace_id === data.workspace.id &&
            d.record?.kind === kind &&
            (!item || d.record.id === item.id) &&
            Number.isInteger(d.record.version)
          ) {
            draftRecord.current = d.record;
          }
          pendingSave.current = readPendingSave<ItemInput>(d.pending);
          return withEventEnd({ ...blankInput(kind), ...d.form });
        }
      }
    } catch {}
    return withEventEnd({
      ...(item ? inputOf(item) : blankInput(kind)),
      ...initial,
    });
  });
  const [record, setRecord] = useState(draftRecord.current || item);
  const [state, setState] = useState(""),
    [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false),
    [storageFailure, setStorageFailure] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleting = useRef(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false),
    [photoRevision, setPhotoRevision] = useState(0);
  const photosRef = useRef<PendingPhoto[]>([]);
  function changePhotos(photos: PendingPhoto[]) {
    photosRef.current = photos;
    setPendingPhotos(photos);
  }
  const latest = useRef(form),
    current = useRef(
      record
        ? { ...record, version: draftVersion.current ?? record.version }
        : null,
    ),
    lastSaved = useRef(
      record ? JSON.stringify(withEventEnd(inputOf(record))) : "",
    ),
    saving = useRef(false),
    mounted = useRef(true),
    dialog = useRef<HTMLDialogElement>(null),
    saveRef = useRef(onSave);
  saveRef.current = onSave;
  latest.current = form;
  const editable = kind !== "todo" || !record || record.created_by === userId;
  function remember(value: ItemInput) {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          baseVersion: current.current?.version || 0,
          record: current.current,
          pending: pendingSave.current,
          form: value,
        }),
      );
      setStorageFailure(false);
    } catch {
      setStorageFailure(true);
    }
  }
  function change<K extends keyof ItemInput>(field: K, value: ItemInput[K]) {
    changeFields({ [field]: value });
  }
  function changeFields(values: Partial<ItemInput>) {
    const next = { ...latest.current, ...values };
    latest.current = next;
    setForm(next);
    remember(next);
    setFailure("");
    setState("Unsaved changes · draft kept on this device");
  }
  function valid(value: ItemInput) {
    return (
      !!value.title.trim() &&
      (kind !== "event" ||
        (!!value.starts_at &&
          !!value.ends_at &&
          new Date(value.ends_at) > new Date(value.starts_at))) &&
      (!value.delivery_url || /^https:\/\//.test(value.delivery_url))
    );
  }
  async function flush() {
    if (
      saving.current ||
      deleting.current ||
      photoBusy ||
      !editable ||
      !valid(latest.current)
    )
      return;
    saving.current = true;
    setBusy(true);
    setFailure("");
    try {
      // Keep text changes made during an upload in the same serialized save.
      do {
        do {
          if (!valid(latest.current)) {
            setState(
              "Complete the required fields to save · draft kept on this device",
            );
            return;
          }
          if (
            !pendingSave.current &&
            current.current &&
            JSON.stringify(latest.current) === lastSaved.current
          )
            break;
          const pending = beginSave(pendingSave.current, latest.current);
          pendingSave.current = pending;
          remember(latest.current);
          const snapshot = pending.input,
            json = JSON.stringify(snapshot);
          setState(preview ? "Saving to this browser..." : "Saving...");
          const saved = await saveRef.current(
            kind,
            current.current,
            snapshot,
            pending.request,
          );
          current.current = saved;
          lastSaved.current = json;
          pendingSave.current = null;
          // Persist the acknowledged identity even if the dialog was closed.
          remember(latest.current);
          if (!mounted.current) return;
          setRecord(saved);
          setState(
            preview
              ? "Saved in this browser"
              : kind === "event"
                ? "Saved in Motion OS. Google sync status is on Calendar."
                : "Saved to workspace",
          );
        } while (JSON.stringify(latest.current) !== lastSaved.current);
        while (current.current && photosRef.current.length) {
          setState("Uploading photos…");
          const photo = photosRef.current[0];
          await uploadItemPhoto(current.current.id, photo, preview);
          changePhotos(photosRef.current.filter((p) => p.id !== photo.id));
          URL.revokeObjectURL(photo.url);
          setPhotoRevision((n) => n + 1);
        }
      } while (JSON.stringify(latest.current) !== lastSaved.current);
      if (current.current)
        setState(
          preview
            ? "Saved in this browser"
            : kind === "event"
              ? "Saved in Motion OS. Google sync status is on Calendar."
              : "Saved to workspace",
        );
      try {
        localStorage.removeItem(key);
      } catch {
        setStorageFailure(true);
      }
    } catch (e) {
      if (rejectedSave(e)) {
        pendingSave.current = null;
        remember(latest.current);
      }
      if (mounted.current) {
        setFailure((e as Error).message);
        setState(
          current.current && photosRef.current.length
            ? "Item saved. Some photos still need uploading; retry Save."
            : "Not saved. Draft kept.",
        );
      }
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    dialog.current?.showModal();
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (
      (!pendingSave.current &&
        JSON.stringify(form) === lastSaved.current &&
        !pendingPhotos.length) ||
      !valid(form) ||
      !editable ||
      photoBusy ||
      confirmDelete
    )
      return;
    const timer = setTimeout(() => void flush(), 500);
    return () => clearTimeout(timer);
  }, [form, confirmDelete, photoBusy, pendingPhotos.length]); // autosave serialized by flush
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const save = () => void flushRef.current();
    window.addEventListener("online", save);
    document.addEventListener("visibilitychange", save);
    return () => {
      window.removeEventListener("online", save);
      document.removeEventListener("visibilitychange", save);
    };
  }, []);
  useEffect(() => {
    if (!failure || busy || !pendingSave.current || !navigator.onLine) return;
    const retry = setTimeout(() => void flushRef.current(), 5000);
    return () => clearTimeout(retry);
  }, [failure, busy]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (
        saving.current ||
        photosRef.current.length > 0 ||
        !!pendingSave.current ||
        (latest.current.title.trim() &&
          JSON.stringify(latest.current) !== lastSaved.current)
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, []);
  const linked =
    kind === "event"
      ? data.items.filter((i) => i.kind === "task" && i.event_id === record?.id)
      : [];
  async function close(): Promise<boolean> {
    if (saving.current || deleting.current || photoBusy) return false;
    if (
      editable &&
      (current.current || valid(latest.current)) &&
      (pendingSave.current ||
        JSON.stringify(latest.current) !== lastSaved.current ||
        photosRef.current.length > 0)
    ) {
      if (!valid(latest.current)) {
        setFailure("Add a title and check the date and link before saving.");
        return false;
      }
      await flush();
      if (
        pendingSave.current ||
        JSON.stringify(latest.current) !== lastSaved.current ||
        photosRef.current.length
      )
        return false;
    }
    onClose();
    return true;
  }
  function cancelDelete() {
    deleting.current = false;
    setConfirmDelete(false);
    deleteButton.current?.focus();
  }
  async function remove() {
    if (!current.current || saving.current || photoBusy) return;
    saving.current = true;
    setBusy(true);
    setFailure("");
    try {
      await onDelete(current.current);
      try {
        localStorage.removeItem(key);
      } catch {}
      photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
      onClose();
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="editor"
      aria-labelledby="item-editor-title"
      onCancel={(e) => {
        e.preventDefault();
        if (confirmDelete && !busy) cancelDelete();
        else close();
      }}
    >
      <div className="editor-header">
        <div>
          <h2 id="item-editor-title">
            {record
              ? `Edit ${kind === "todo" ? "to-do" : kind}`
              : kind === "task"
                ? "New task"
                : kind === "event"
                  ? "New event"
                  : kind === "idea"
                    ? "New idea"
                    : "New to-do"}
          </h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close details"
          disabled={busy || photoBusy || confirmDelete}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <div className="editor-body" inert={confirmDelete}>
        {!editable && (
          <div className="notice">
            You can view this item. Only its creator can make changes.
          </div>
        )}
        <fieldset disabled={!editable}>
          <label>
            Title
            <input
              value={form.title}
              onChange={(e) => change("title", e.target.value)}
              maxLength={180}
              placeholder={
                kind === "event" ? "Add title" : "What needs to get done?"
              }
              autoFocus
            />
          </label>
          {kind === "event" && (
            <>
              <div className="form-grid">
                <label>
                  Type
                  <select
                    value={form.event_type}
                    onChange={(e) =>
                      change("event_type", e.target.value as "fight" | "event")
                    }
                  >
                    <option value="event">Event</option>
                    <option value="fight">Fight</option>
                  </select>
                </label>
                <label>
                  Athlete
                  <select
                    value={form.athlete_id || ""}
                    onChange={(e) =>
                      change("athlete_id", e.target.value || null)
                    }
                  >
                    <option value="">None</option>
                    {data.sponsorships
                      .filter((s) => s.record_type === "athlete")
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.athlete_name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={form.all_day}
                  onChange={(e) => {
                    const day = eventStartDay(form) || localDate(),
                      end = eventEndDay(form) || day;
                    changeFields(
                      e.target.checked
                        ? {
                            all_day: true,
                            starts_at: `${day}T00:00:00.000Z`,
                            ends_at: `${addDays(end, 1)}T00:00:00.000Z`,
                          }
                        : {
                            all_day: false,
                            starts_at: new Date(`${day}T09:00`).toISOString(),
                            ends_at: new Date(`${end}T10:00`).toISOString(),
                          },
                    );
                  }}
                />
                All day
              </label>
              <div className="form-grid event-dates">
                <label>
                  Start
                  <input
                    type={form.all_day ? "date" : "datetime-local"}
                    value={
                      form.starts_at
                        ? form.all_day
                          ? eventStartDay(form)
                          : localDateTime(form.starts_at)
                        : ""
                    }
                    onChange={(e) => {
                      const start = e.target.value
                        ? form.all_day
                          ? `${e.target.value}T00:00:00.000Z`
                          : new Date(e.target.value).toISOString()
                        : null;
                      const duration =
                        form.starts_at && form.ends_at
                          ? Math.max(
                              60000,
                              new Date(form.ends_at).getTime() -
                                new Date(form.starts_at).getTime(),
                            )
                          : 3600000;
                      changeFields({
                        starts_at: start,
                        ends_at: start
                          ? new Date(
                              new Date(start).getTime() + duration,
                            ).toISOString()
                          : null,
                      });
                    }}
                  />
                </label>
                <label>
                  End
                  <input
                    type={form.all_day ? "date" : "datetime-local"}
                    value={
                      form.ends_at
                        ? form.all_day
                          ? eventEndDay(form)
                          : localDateTime(form.ends_at)
                        : ""
                    }
                    onChange={(e) =>
                      change(
                        "ends_at",
                        e.target.value
                          ? form.all_day
                            ? `${addDays(e.target.value, 1)}T00:00:00.000Z`
                            : new Date(e.target.value).toISOString()
                          : null,
                      )
                    }
                  />
                </label>
              </div>
              {form.starts_at &&
                form.ends_at &&
                new Date(form.ends_at) <= new Date(form.starts_at) && (
                  <p className="field-error" role="alert">
                    End must be after start.
                  </p>
                )}
              {!form.all_day && (
                <p className="field-hint">
                  {Intl.DateTimeFormat()
                    .resolvedOptions()
                    .timeZone.replaceAll("_", " ")}
                </p>
              )}
              <PeoplePicker
                label="Guests"
                members={data.members}
                selected={form.event_guest_ids}
                userId={userId}
                onChange={(ids) => change("event_guest_ids", ids)}
              />
              <label>
                Location
                <input
                  value={form.location}
                  onChange={(e) => change("location", e.target.value)}
                  maxLength={300}
                  placeholder="Add location"
                />
              </label>
            </>
          )}
          {kind === "task" && (
            <PeoplePicker
              label="Assign to"
              members={data.members}
              selected={taskPeople(form)}
              userId={userId}
              onChange={(ids) =>
                changeFields({
                  assignee_id: ids[0] || null,
                  collaborator_ids: ids.slice(1),
                  status:
                    !ids.length && form.status === "doing"
                      ? "open"
                      : form.status,
                })
              }
            />
          )}
          {(kind === "task" || kind === "todo") && (
            <label>
              Due date
              <input
                type="date"
                value={form.due_date || ""}
                onChange={(e) => change("due_date", e.target.value || null)}
              />
            </label>
          )}
          <label>
            {kind === "event" ? "Description" : "Notes"}
            <textarea
              rows={3}
              maxLength={10000}
              value={form.description}
              onChange={(e) => change("description", e.target.value)}
              placeholder="Optional"
            />
          </label>
          {record && (kind === "task" || kind === "todo") && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={form.status === "done"}
                onChange={(e) =>
                  change(
                    "status",
                    e.target.checked
                      ? "done"
                      : form.assignee_id && kind === "task"
                        ? "doing"
                        : "open",
                  )
                }
              />
              Done
            </label>
          )}
          {kind !== "todo" && (
            <details className="more-details">
              <summary>More details</summary>
              <div className="details-body">
                <label>
                  Status
                  <select
                    value={form.status}
                    onChange={(e) => change("status", e.target.value)}
                  >
                    {statuses[kind].map((status) => (
                      <option
                        key={status}
                        value={status}
                        disabled={status === "doing" && !form.assignee_id}
                      >
                        {statusLabel[status]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Category
                  <select
                    value={form.category}
                    onChange={(e) => change("category", e.target.value)}
                  >
                    {[
                      "Operations",
                      "Content",
                      "Community",
                      "Marketing",
                      "Partnerships",
                      "Product",
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                {kind === "task" && (
                  <>
                    <div className="form-grid">
                      <label>
                        Week of
                        <input
                          type="date"
                          value={form.week_of || ""}
                          onChange={(e) =>
                            change(
                              "week_of",
                              e.target.value
                                ? weekStart(new Date(`${e.target.value}T12:00`))
                                : null,
                            )
                          }
                        />
                      </label>
                      <label>
                        Priority
                        <select
                          value={form.priority}
                          onChange={(e) =>
                            change(
                              "priority",
                              e.target.value as ItemInput["priority"],
                            )
                          }
                        >
                          <option value="normal">Normal</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      Linked event
                      <select
                        value={form.event_id || ""}
                        onChange={(e) =>
                          change("event_id", e.target.value || null)
                        }
                      >
                        <option value="">None</option>
                        {data.items
                          .filter((i) => i.kind === "event")
                          .map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.title}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Deliverables
                      <textarea
                        rows={2}
                        maxLength={4000}
                        value={form.definition_done}
                        onChange={(e) =>
                          change("definition_done", e.target.value)
                        }
                      />
                    </label>
                    <label>
                      Work link
                      <input
                        type="url"
                        maxLength={2000}
                        value={form.delivery_url}
                        placeholder="https://..."
                        onChange={(e) => change("delivery_url", e.target.value)}
                      />
                    </label>
                    <label>
                      Completion notes
                      <textarea
                        rows={2}
                        maxLength={4000}
                        value={form.delivery_notes}
                        onChange={(e) =>
                          change("delivery_notes", e.target.value)
                        }
                      />
                    </label>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={async () => {
                        if (await close()) onInviteTeam();
                      }}
                    >
                      Invite someone new
                    </button>
                  </>
                )}
                {kind === "event" && (
                  <>
                    <label>
                      Event lead
                      <select
                        value={form.assignee_id || ""}
                        onChange={(e) =>
                          change("assignee_id", e.target.value || null)
                        }
                      >
                        <option value="">None</option>
                        {data.members.map((m) => (
                          <option key={m.user_id} value={m.user_id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Content needed
                      <textarea
                        value={form.content_needs}
                        maxLength={10000}
                        rows={3}
                        onChange={(e) =>
                          change("content_needs", e.target.value)
                        }
                      />
                    </label>
                  </>
                )}
              </div>
            </details>
          )}
        </fieldset>
        {(kind === "task" || kind === "todo") && (
          <ItemPhotos
            itemId={current.current?.id || null}
            preview={preview}
            privateTodo={kind === "todo"}
            pending={pendingPhotos}
            onPending={changePhotos}
            disabled={busy || !editable}
            onBusy={setPhotoBusy}
            revision={photoRevision}
          />
        )}
        {kind === "event" && record && (
          <section className="linked-tasks">
            <h3>Event tasks</h3>
            <div className="event-add-actions">
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  if (await close()) onNewTask(record.id, "Operations");
                }}
              >
                Add task
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  if (await close()) onNewTask(record.id, "Content");
                }}
              >
                Add content task
              </button>
            </div>
            {linked.map((t) => (
              <button
                key={t.id}
                disabled={busy}
                onClick={async () => {
                  if (await close()) onOpen(t);
                }}
              >
                <span className={`status-dot ${t.status}`} />
                {t.title}
              </button>
            ))}
          </section>
        )}
        {failure && (
          <div className="notice error" role="alert">
            {failure}
            <button
              className="text-button"
              onClick={() => void flush()}
              disabled={busy}
            >
              Retry save
            </button>
            <p>Your draft has not replaced the version in the workspace.</p>
            {record && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  const remote = data.items.find((i) => i.id === record.id);
                  if (!remote) return;
                  try {
                    localStorage.setItem(
                      key + ":conflict-backup",
                      JSON.stringify(latest.current),
                    );
                  } catch {}
                  const next = withEventEnd(inputOf(remote));
                  current.current = remote;
                  pendingSave.current = null;
                  setRecord(remote);
                  latest.current = next;
                  lastSaved.current = JSON.stringify(next);
                  setForm(next);
                  setFailure("");
                  setState(
                    "Latest saved version loaded. Previous draft kept on this device.",
                  );
                  try {
                    localStorage.removeItem(key);
                  } catch {}
                }}
              >
                Load latest saved version
              </button>
            )}
            <button
              className="text-button"
              onClick={() => {
                const blob = new Blob(
                  [JSON.stringify(latest.current, null, 2)],
                  { type: "application/json" },
                );
                const url = URL.createObjectURL(blob),
                  a = document.createElement("a");
                a.href = url;
                a.download = "motion-draft.json";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Download my draft
            </button>
            <button className="text-button" onClick={onClose}>
              Close and keep my draft on this device
            </button>
          </div>
        )}
        {storageFailure && (
          <div className="notice error">
            Device storage is unavailable. Keep this window open until saving
            succeeds.
          </div>
        )}
      </div>
      <div className="editor-footer">
        {confirmDelete ? (
          <div
            className="delete-confirmation"
            role="alertdialog"
            aria-labelledby="delete-item-title"
            aria-describedby="delete-item-description"
          >
            <h3 id="delete-item-title">Delete this {kind}?</h3>
            <p id="delete-item-description">
              “{current.current?.title}” will be permanently removed.
              {kind === "event" && " Linked tasks will stay in the workspace."}
            </p>
            {failure && (
              <p className="error" role="alert">
                {failure}
              </p>
            )}
            <div className="editor-actions">
              <button
                className="button"
                disabled={busy}
                autoFocus
                onClick={cancelDelete}
              >
                Keep {kind}
              </button>
              <button
                className="button delete-button"
                disabled={busy}
                onClick={remove}
              >
                {busy ? "Deleting…" : `Delete ${kind}`}
              </button>
            </div>
          </div>
        ) : (
          <>
            <span role="status">
              {state || "Autosave on · saved after required fields are filled"}
            </span>
            <div className="editor-actions">
              {record && (kind === "event" || kind === "task") && (
                <button
                  ref={deleteButton}
                  className="button delete-button"
                  disabled={busy || photoBusy}
                  onClick={() => {
                    deleting.current = true;
                    setFailure("");
                    setConfirmDelete(true);
                  }}
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              )}
              {!record || pendingPhotos.length > 0 ? (
                <button
                  className="button primary"
                  disabled={busy || photoBusy || !valid(form)}
                  onClick={async () => {
                    await flush();
                    if (
                      current.current &&
                      photosRef.current.length === 0 &&
                      lastSaved.current === JSON.stringify(latest.current)
                    )
                      onClose();
                  }}
                >
                  Save
                  <Check size={16} />
                </button>
              ) : (
                <button
                  className="button"
                  disabled={busy || photoBusy}
                  onClick={close}
                >
                  Close
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
function withEventEnd(input: ItemInput): ItemInput {
  if (input.starts_at && !input.ends_at)
    return {
      ...input,
      ends_at: new Date(
        new Date(input.starts_at).getTime() +
          (input.all_day ? 86400000 : 3600000),
      ).toISOString(),
    };
  return input;
}

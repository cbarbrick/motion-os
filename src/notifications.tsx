import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, ChevronRight, X } from "lucide-react";
import {
  dateLabel,
  notificationText,
  type Item,
  type TaskNotification,
} from "./model";
import type { useWorkspace } from "./use-workspace";
import { PushSettings } from "./push-settings";

export function Notifications({
  store,
  onOpen,
}: {
  store: ReturnType<typeof useWorkspace>;
  onOpen: (item: Item) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [incoming, setIncoming] = useState<TaskNotification | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const notices = (store.data?.notifications || [])
    .filter((n) => n.recipient_id === store.userId)
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
    );
  const unread = notices.filter((n) => !n.read_at).length;
  const visible = unreadOnly ? notices.filter((n) => !n.read_at) : notices;
  useEffect(() => {
    const openInbox = () => {
      if (location.hash === "#notifications") setOpened(true);
    };
    openInbox();
    window.addEventListener("hashchange", openInbox);
    return () => window.removeEventListener("hashchange", openInbox);
  }, []);
  useEffect(() => {
    const next = notices.find(
      (n) => !n.read_at && seen.current && !seen.current.has(n.id),
    );
    seen.current = new Set(notices.map((n) => n.id));
    if (next) setIncoming(next);
  }, [store.data?.notifications]);
  useEffect(() => {
    if (!incoming) return;
    const timer = setTimeout(() => setIncoming(null), 8000);
    return () => clearTimeout(timer);
  }, [incoming]);
  useEffect(() => {
    if (opened) dialog.current?.showModal();
    else dialog.current?.close();
  }, [opened]);
  async function mark(id: string | null, item?: Item) {
    setBusy(true);
    setFailure("");
    try {
      await store.readNotifications(id);
      if (item) {
        setIncoming(null);
        setOpened(false);
        onOpen(item);
      }
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {incoming && (
        <div className="toast notification-toast" role="status">
          <span>
            {notificationText(incoming)}
            <br />
            {incoming.task_title}
          </span>
          <button
            onClick={() => {
              setIncoming(null);
              setOpened(true);
            }}
          >
            View
          </button>
          <button
            aria-label="Dismiss notification"
            onClick={() => setIncoming(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <button
        className="icon-button notification-bell"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        onClick={() => {
          setFailure("");
          setOpened(true);
        }}
      >
        <Bell size={21} />
        {unread > 0 && (
          <span className="notification-count">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      <dialog
        className="notification-dialog"
        ref={dialog}
        aria-labelledby="notification-heading"
        onCancel={(e) => {
          e.preventDefault();
          setOpened(false);
        }}
      >
        <div className="editor-header">
          <div>
            <h2 id="notification-heading">Notifications</h2>
            <p>{unread} unread</p>
          </div>
          <button
            className="icon-button"
            aria-label="Close notifications"
            onClick={() => setOpened(false)}
          >
            <X size={20} />
          </button>
        </div>
        {opened && (
          <PushSettings preview={store.preview} userId={store.userId} />
        )}
        <div className="notification-toolbar">
          <div className="tabs">
            <button
              className={!unreadOnly ? "active" : ""}
              onClick={() => setUnreadOnly(false)}
            >
              All
            </button>
            <button
              className={unreadOnly ? "active" : ""}
              onClick={() => setUnreadOnly(true)}
            >
              Unread
            </button>
          </div>
          <button
            className="text-button"
            disabled={!unread || busy}
            onClick={() => void mark(null)}
          >
            <CheckCheck size={16} />
            Mark all read
          </button>
        </div>
        {failure && (
          <p className="notice" role="alert">
            {failure}
          </p>
        )}
        <div className="notification-list" aria-busy={busy}>
          {visible.map((n) => {
            const item = store.data?.items.find(
              (i) =>
                i.id === n.item_id && (i.kind === "task" || i.kind === "event"),
            );
            return (
              <article
                key={n.id}
                className={`notification-item ${n.read_at ? "" : "unread"}`}
              >
                <button
                  disabled={busy}
                  className="notification-open"
                  onClick={() => void mark(n.id, item)}
                >
                  <span className="notification-dot" />
                  <span>
                    <strong>{notificationText(n)}</strong>
                    <span className="notification-task">
                      {item?.title || n.task_title}
                    </span>
                    <small>
                      {dateLabel(n.created_at, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {!item ? " · Item unavailable" : ""}
                    </small>
                  </span>
                  {item && <ChevronRight size={18} />}
                </button>
              </article>
            );
          })}
          {!visible.length && (
            <div className="notification-empty">
              <Bell size={28} />
              <h3>
                {unreadOnly
                  ? "No unread notifications"
                  : "No notifications yet"}
              </h3>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}

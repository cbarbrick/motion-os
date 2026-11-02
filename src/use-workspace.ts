import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./client";
import { discardHomeLogin, readPending } from "./home-login";
import { invitationFromHash } from "./navigation";
import {
  demoUser,
  makeDemo,
  inputOf,
  sponsorshipInputOf,
  taskPeople,
  type TaskNotification,
  type Snapshot,
  type Item,
  type Kind,
  type ItemInput,
  type Workspace,
  type Member,
  type Sponsorship,
  type SponsorshipInput,
  type SponsorshipComment,
  type ReviewStatus,
} from "./model";
const previewKey = "motion-team-os-sample-v2";
const inviteKey = "motion-workspace-invite";
function captureInvite() {
  const token = invitationFromHash(location.hash);
  if (token && /^[0-9a-f-]{36}$/i.test(token)) {
    try {
      localStorage.setItem(
        inviteKey,
        JSON.stringify({ token, at: Date.now() }),
      );
      sessionStorage.removeItem("motion-sample-mode");
    } catch {}
    history.replaceState(null, "", location.pathname + location.search);
    return token;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(inviteKey) || "null");
    if (saved && Date.now() - saved.at < 7 * 86400000)
      return saved.token as string;
    localStorage.removeItem(inviteKey);
  } catch {}
  return "";
}
function inPreview() {
  try {
    return sessionStorage.getItem("motion-sample-mode") === "true";
  } catch {
    return false;
  }
}
function readPreview(): Snapshot {
  try {
    const raw = localStorage.getItem(previewKey);
    if (raw) {
      const v = JSON.parse(raw);
      if (
        v.workspace &&
        Array.isArray(v.items) &&
        Array.isArray(v.members) &&
        Array.isArray(v.activity) &&
        Array.isArray(v.grants)
      )
        return {
          ...v,
          sponsorships: (v.sponsorships || []).map((s: Sponsorship) => ({
            ...s,
            record_type: s.record_type || "athlete",
            status:
              !s.record_type || s.record_type === "athlete"
                ? "active"
                : s.status,
            decided_by:
              !s.record_type || s.record_type === "athlete"
                ? null
                : s.decided_by,
            decided_at:
              !s.record_type || s.record_type === "athlete"
                ? null
                : s.decided_at,
            rate: s.rate || "",
          })),
          items: v.items.map((i: Item) => ({
            ...i,
            athlete_id: i.athlete_id || null,
            event_type: i.event_type || "event",
            content_needs: i.content_needs || "",
            collaborator_ids: i.collaborator_ids || [],
            ends_at: i.ends_at || null,
            all_day: i.all_day || false,
            event_guest_ids: i.event_guest_ids || [],
          })),
          sponsorshipComments: v.sponsorshipComments || [],
          sponsorshipReviewer: v.sponsorshipReviewer || null,
          notifications: v.notifications || [],
        };
    }
  } catch {}
  return makeDemo();
}
async function readItems(workspace: string) {
  const rows: Item[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await supabase!
      .from("items")
      .select("*")
      .eq("workspace_id", workspace)
      .order("id")
      .range(offset, offset + 999);
    if (result.error) throw result.error;
    rows.push(...(result.data as Item[]));
    if (result.data.length < 1000) return { data: rows, error: null };
  }
}
async function readSponsorshipRows<T>(
  table: "sponsorships" | "sponsorship_comments" | "notifications",
  workspace: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await supabase!
      .from(table)
      .select("*")
      .eq("workspace_id", workspace)
      .order("id")
      .range(offset, offset + 999);
    if (r.error) throw r.error;
    rows.push(...(r.data as T[]));
    if (r.data.length < 1000) return rows;
  }
}
export function useWorkspace() {
  const [inviteToken, setInviteToken] = useState(captureInvite);
  const [recovering, setRecovering] = useState(false);
  function clearInvite() {
    try {
      localStorage.removeItem(inviteKey);
    } catch {}
    setInviteToken("");
  }
  useEffect(() => {
    const capture = () => {
      if (!invitationFromHash(location.hash)) return;
      const token = captureInvite();
      if (token) {
        setInviteToken(token);
        setPreview(false);
      }
    };
    window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, []);
  const [session, setSession] = useState<Session | null>(null),
    [authReady, setAuthReady] = useState(!supabase),
    [preview, setPreview] = useState(inPreview);
  const [data, setData] = useState<Snapshot | null>(() =>
      inPreview() ? readPreview() : null,
    ),
    [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [workspaceId, setWorkspaceId] = useState("");
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  const identity = useRef("");
  const requestGeneration = useRef(0);
  const userId = preview ? demoUser : session?.user.id || "";
  identity.current = userId;
  useEffect(() => {
    if (!supabase) return;
    let stopped = false,
      checking = false,
      revision = 0;
    async function restore() {
      if (stopped || checking || document.visibilityState === "hidden") return;
      checking = true;
      const startedAt = revision;
      try {
        const { data, error } = await supabase!.auth.getSession();
        if (stopped || startedAt !== revision) return;
        if (error) setError(error.message);
        else setSession(data.session);
      } catch {
        if (!stopped)
          setError("Could not restore sign-in. Check your connection.");
      } finally {
        checking = false;
        if (!stopped) setAuthReady(true);
      }
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (stopped) return;
      revision++;
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setSession(next);
      setAuthReady(true);
      if (next) {
        const pending = readPending();
        if (pending) void discardHomeLogin(pending);
      }
    });
    void restore();
    const resume = () => void restore();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    return () => {
      stopped = true;
      sub.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
    };
  }, []);
  useEffect(() => {
    const yes = () => setOnline(true),
      no = () => setOnline(false);
    window.addEventListener("online", yes);
    window.addEventListener("offline", no);
    return () => {
      window.removeEventListener("online", yes);
      window.removeEventListener("offline", no);
    };
  }, []);
  const refresh = useCallback(async () => {
    if (preview || !session || !supabase) return;
    const owner = session.user.id,
      gen = ++requestGeneration.current;
    try {
      const w = await supabase
        .from("workspaces")
        .select("*")
        .order("created_at");
      if (w.error) throw w.error;
      const list = w.data as Workspace[];
      if (identity.current !== owner || gen !== requestGeneration.current)
        return;
      setWorkspaces(list);
      const selected = list.find((w) => w.id === workspaceId) || list[0];
      if (!selected) {
        setData(null);
        return;
      }
      const [
        m,
        i,
        a,
        g,
        sponsorships,
        sponsorshipComments,
        settings,
        notifications,
      ] = await Promise.all([
        supabase.from("members").select("*").eq("workspace_id", selected.id),
        readItems(selected.id),
        supabase
          .from("activity")
          .select("*")
          .eq("workspace_id", selected.id)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("access_grants")
          .select("email,role")
          .eq("workspace_id", selected.id),
        readSponsorshipRows<Sponsorship>("sponsorships", selected.id),
        readSponsorshipRows<SponsorshipComment>(
          "sponsorship_comments",
          selected.id,
        ),
        supabase
          .from("sponsorship_settings")
          .select("reviewer_id")
          .eq("workspace_id", selected.id)
          .maybeSingle(),
        readSponsorshipRows<TaskNotification>("notifications", selected.id),
      ]);
      for (const res of [m, i, a, g, settings]) if (res.error) throw res.error;
      if (identity.current !== owner || gen !== requestGeneration.current)
        return;
      setData({
        workspace: selected,
        members: m.data as Member[],
        items: i.data as Item[],
        activity: a.data || [],
        grants: g.data || [],
        sponsorships,
        sponsorshipComments,
        sponsorshipReviewer: settings.data?.reviewer_id || null,
        notifications,
      });
      setError("");
    } catch (e) {
      if (identity.current === owner) setError((e as Error).message);
    }
  }, [preview, session, workspaceId]);
  useEffect(() => {
    if (preview) return;
    setData(null);
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [preview, session?.user.id, workspaceId]); // eslint-disable-line
  useEffect(() => {
    if (preview || !session) return;
    const timer = setInterval(refresh, 20000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [refresh, preview, session]);
  useEffect(() => {
    if (preview || !session || !supabase) return;
    const channel = supabase
      .channel(`task-notifications:${session.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${session.user.id}`,
        },
        () => void refresh(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refresh();
      });
    return () => {
      void supabase!.removeChannel(channel);
    };
  }, [preview, session?.user.id, refresh]);
  function setPreviewData(next: Snapshot) {
    localStorage.setItem(previewKey, JSON.stringify(next));
    setData(next);
  }
  function enterPreview() {
    const next = readPreview();
    try {
      sessionStorage.setItem("motion-sample-mode", "true");
    } catch {}
    setData(next);
    setPreview(true);
  }
  async function save(
    kind: Kind,
    item: Item | null,
    input: ItemInput,
  ): Promise<Item> {
    if (!data) throw new Error("Workspace is loading");
    if (preview) {
      const now = new Date().toISOString();
      const updated: Item = {
        ...(item || {
          id: crypto.randomUUID(),
          workspace_id: data.workspace.id,
          kind,
          created_by: userId,
          created_at: now,
          version: 0,
        }),
        ...input,
        updated_at: now,
        version: (item?.version || 0) + 1,
      };
      const next = {
        ...data,
        items: [updated, ...data.items.filter((i) => i.id !== updated.id)],
        notifications: [
          ...(kind === "task"
            ? taskPeople(updated)
                .filter(
                  (id) =>
                    id !== userId && !(item && taskPeople(item).includes(id)),
                )
                .map((recipient_id): TaskNotification => ({
                  id: crypto.randomUUID(),
                  workspace_id: data.workspace.id,
                  recipient_id,
                  actor_id: userId,
                  actor_name:
                    data.members.find((m) => m.user_id === userId)?.name ||
                    "Teammate",
                  item_id: updated.id,
                  item_version: updated.version,
                  task_title: updated.title,
                  kind: "task_added",
                  created_at: now,
                  read_at: null,
                }))
            : []),
          ...data.notifications,
        ],
      };
      setPreviewData(next);
      return updated;
    }
    if (!online)
      throw new Error(
        "You are offline. Your draft is kept on this device; retry when connected.",
      );
    const r = await supabase!.rpc("save_item", {
      p_workspace: data.workspace.id,
      p_kind: kind,
      p_id: item?.id || null,
      p_version: item?.version || 0,
      p_data: input,
    });
    if (r.error) throw r.error;
    ++requestGeneration.current;
    const updated = (Array.isArray(r.data) ? r.data[0] : r.data) as Item;
    if (!updated?.id || typeof updated.version !== "number")
      throw new Error(
        "The server returned an unexpected save response. Refresh to check the saved record before retrying.",
      );
    setData((prev) =>
      prev
        ? {
            ...prev,
            items: [updated, ...prev.items.filter((i) => i.id !== updated.id)],
          }
        : prev,
    );
    return updated;
  }
  async function readNotifications(id: string | null = null) {
    if (!data) return;
    const workspace = data.workspace.id,
      recipient = userId;
    if (!preview) {
      const result = await supabase!.rpc("read_notifications", {
        p_workspace: workspace,
        p_id: id,
      });
      if (result.error) throw result.error;
    }
    ++requestGeneration.current;
    setData((prev) => {
      if (
        !prev ||
        prev.workspace.id !== workspace ||
        identity.current !== recipient
      )
        return prev;
      const next = {
        ...prev,
        notifications: prev.notifications.map((n) =>
          n.recipient_id === recipient && (!id || n.id === id) && !n.read_at
            ? { ...n, read_at: new Date().toISOString() }
            : n,
        ),
      };
      if (preview) localStorage.setItem(previewKey, JSON.stringify(next));
      return next;
    });
  }
  function updateSponsorshipData(change: (prev: Snapshot) => Snapshot) {
    ++requestGeneration.current;
    setData((prev) => {
      if (!prev) return prev;
      const next = change(prev);
      if (preview) localStorage.setItem(previewKey, JSON.stringify(next));
      return next;
    });
  }
  async function saveSponsorship(
    item: Sponsorship | null,
    input: SponsorshipInput,
  ): Promise<Sponsorship> {
    if (!data) throw new Error("Workspace is loading");
    let saved: Sponsorship;
    let updateNote: SponsorshipComment | null = null;
    if (preview) {
      if (
        item &&
        JSON.stringify(sponsorshipInputOf(item)) === JSON.stringify(input)
      )
        return item;
      const now = new Date().toISOString();
      if (item && item.record_type !== "athlete" && item.status !== "pending") {
        updateNote = {
          id: crypto.randomUUID(),
          workspace_id: data.workspace.id,
          sponsorship_id: item.id,
          author_id: userId,
          author_name:
            data.members.find((m) => m.user_id === userId)?.name || "You",
          body: "Proposal changed. A new decision is needed.",
          action: "updated",
          created_at: now,
        };
      }
      saved = {
        ...(item || {
          id: crypto.randomUUID(),
          workspace_id: data.workspace.id,
          created_by: userId,
          created_at: now,
        }),
        ...input,
        status: input.record_type === "athlete" ? "active" : "pending",
        decided_by: null,
        decided_at: null,
        version: (item?.version || 0) + 1,
        updated_at: now,
      };
    } else {
      const r = await supabase!.rpc("save_sponsorship", {
        p_workspace: data.workspace.id,
        p_id: item?.id || null,
        p_version: item?.version || 0,
        p_data: input,
      });
      if (r.error) throw r.error;
      saved = r.data as Sponsorship;
    }
    updateSponsorshipData((prev) => ({
      ...prev,
      sponsorships: [
        saved,
        ...prev.sponsorships.filter((s) => s.id !== saved.id),
      ],
      sponsorshipComments: updateNote
        ? [...prev.sponsorshipComments, updateNote]
        : prev.sponsorshipComments,
    }));
    if (
      !preview &&
      item &&
      item.record_type !== "athlete" &&
      item.status !== "pending"
    )
      void refresh();
    return saved;
  }
  async function setSponsorshipReviewer(id: string | null) {
    if (!data) return;
    if (!preview) {
      const r = await supabase!.rpc("set_sponsorship_reviewer", {
        p_workspace: data.workspace.id,
        p_reviewer: id,
      });
      if (r.error) throw r.error;
    }
    updateSponsorshipData((prev) => ({ ...prev, sponsorshipReviewer: id }));
  }
  async function addSponsorshipComment(item: Sponsorship, body: string) {
    let comment: SponsorshipComment;
    if (preview)
      comment = {
        id: crypto.randomUUID(),
        workspace_id: item.workspace_id,
        sponsorship_id: item.id,
        author_id: userId,
        author_name:
          data!.members.find((m) => m.user_id === userId)?.name || "You",
        body,
        action: "comment",
        created_at: new Date().toISOString(),
      };
    else {
      const r = await supabase!.rpc("add_sponsorship_comment", {
        p_id: item.id,
        p_body: body,
      });
      if (r.error) throw r.error;
      comment = r.data;
    }
    updateSponsorshipData((prev) => ({
      ...prev,
      sponsorshipComments: [...prev.sponsorshipComments, comment],
    }));
  }
  async function reviewSponsorship(
    item: Sponsorship,
    status: ReviewStatus,
    body: string,
  ): Promise<Sponsorship> {
    if (item.record_type === "athlete")
      throw new Error("Athletes do not require review");
    let saved: Sponsorship;
    if (preview) {
      if (data?.sponsorshipReviewer !== userId)
        throw new Error("Only the selected reviewer can decide");
      saved = {
        ...item,
        status,
        decided_by: status === "pending" ? null : userId,
        decided_at: status === "pending" ? null : new Date().toISOString(),
        version: item.version + 1,
        updated_at: new Date().toISOString(),
      };
      const comment: SponsorshipComment = {
        id: crypto.randomUUID(),
        workspace_id: item.workspace_id,
        sponsorship_id: item.id,
        author_id: userId,
        author_name:
          data!.members.find((m) => m.user_id === userId)?.name || "You",
        body,
        action: status,
        created_at: new Date().toISOString(),
      };
      updateSponsorshipData((prev) => ({
        ...prev,
        sponsorshipComments: [...prev.sponsorshipComments, comment],
      }));
    } else {
      const r = await supabase!.rpc("review_sponsorship", {
        p_id: item.id,
        p_version: item.version,
        p_status: status,
        p_comment: body,
      });
      if (r.error) throw r.error;
      saved = r.data;
    }
    updateSponsorshipData((prev) => ({
      ...prev,
      sponsorships: [
        saved,
        ...prev.sponsorships.filter((s) => s.id !== saved.id),
      ],
    }));
    if (!preview) await refresh();
    return saved;
  }
  async function claim(item: Item) {
    if (preview) {
      if (item.assignee_id) throw new Error("Already claimed");
      return save("task", item, {
        ...inputOf(item),
        assignee_id: userId,
        status: "doing",
      });
    }
    const r = await supabase!.rpc("claim_task", { p_id: item.id });
    if (r.error) throw r.error;
    await refresh();
    return r.data as Item;
  }
  function exitPreview() {
    try {
      sessionStorage.removeItem("motion-sample-mode");
    } catch {}
    setPreview(false);
    setData(null);
  }
  async function signOut() {
    if (preview) {
      exitPreview();
      return;
    }
    const pending = readPending();
    if (pending) void discardHomeLogin(pending);
    const result = await supabase!.auth.signOut({ scope: "local" });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setSession(null);
    setData(null);
    setWorkspaces([]);
    setWorkspaceId("");
  }
  return {
    session,
    inviteToken,
    clearInvite,
    recovering,
    finishRecovery: () => setRecovering(false),
    authReady,
    preview,
    data,
    userId,
    error,
    setError,
    loading,
    online,
    workspaces,
    workspaceId,
    setWorkspaceId,
    refresh,
    enterPreview,
    exitPreview,
    resetPreview: () => {
      if (preview) setPreviewData(makeDemo());
    },
    save,
    claim,
    readNotifications,
    saveSponsorship,
    setSponsorshipReviewer,
    addSponsorshipComment,
    reviewSponsorship,
    signOut,
  };
}

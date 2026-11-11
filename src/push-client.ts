import { supabase } from "./client";
export type DevicePushState = {
  mode: "on" | "off" | "blocked" | "install" | "unsupported";
  id?: string;
};
export function pushSupport(): DevicePushState["mode"] {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone;
  if (ios && !standalone) return "install";
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  )
    return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return "off";
}
export async function devicePushState(): Promise<DevicePushState> {
  const mode = pushSupport();
  if (mode !== "off") return { mode };
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub || Notification.permission !== "granted") return { mode: "off" };
  const r = await supabase!.rpc("get_push_subscription", {
    p_endpoint: sub.endpoint,
  });
  if (r.error) throw r.error;
  return r.data ? { mode: "on", id: r.data } : { mode: "off" };
}
async function bounded<T>(
  promise: Promise<T>,
  message: string,
  milliseconds = 20000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
export async function enableDevicePush(
  publicKey: string,
  progress: (message: string) => void = () => {},
) {
  const mode = pushSupport();
  if (mode !== "off")
    throw new Error(
      mode === "blocked"
        ? "Allow notifications in your browser or phone settings."
        : "Open Motion OS as an installed app in a supported browser.",
    );
  // Request permission directly from the button tap, before any network work.
  progress("Choose Allow if your browser asks for notification permission.");
  const permission = await bounded(
    Notification.requestPermission(),
    "The permission request did not finish. Check the permission icon beside the address bar, then try again.",
    30000,
  );
  if (permission !== "granted")
    throw new Error(
      "Notifications were not allowed. You can enable them in browser or phone settings.",
    );
  progress("Connecting notifications on this device…");
  await bounded(
    navigator.serviceWorker.register("/sw.js"),
    "This browser could not prepare notifications. Reload Motion OS and try again.",
  );
  const reg = await bounded(
    navigator.serviceWorker.ready,
    "This browser could not prepare notifications. Reload Motion OS and try again.",
  );
  let sub = await reg.pushManager.getSubscription();
  if (!sub)
    sub = await bounded(
      reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      }),
      "This browser could not connect to its notification service. Try Safari from your iPhone home screen, or Chrome, Edge or Firefox.",
    );
  const json = sub.toJSON();
  const r = await supabase!.rpc("save_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
  });
  if (r.error) throw r.error;
  return { mode: "on" as const, id: r.data as string };
}
export async function clearBrowserPush() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await bounded(
    navigator.serviceWorker.getRegistration("/"),
    "Device cleanup timed out.",
    5000,
  );
  const sub = reg?.pushManager
    ? await bounded(
        reg.pushManager.getSubscription(),
        "Device cleanup timed out.",
        5000,
      )
    : null;
  const notices = await reg?.getNotifications();
  notices?.forEach((n) => n.close());
  if (sub) await bounded(sub.unsubscribe(), "Device cleanup timed out.", 5000);
}
export async function disableDevicePush() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await bounded(
    navigator.serviceWorker.getRegistration("/"),
    "Device cleanup timed out.",
    5000,
  );
  const sub = reg?.pushManager
    ? await bounded(
        reg.pushManager.getSubscription(),
        "Device cleanup timed out.",
        5000,
      )
    : null;
  const outcomes = await Promise.allSettled([
    clearBrowserPush(),
    bounded(
      (async () => {
        if (sub && supabase) {
          const r = await supabase.rpc("remove_push_subscription", {
            p_endpoint: sub.endpoint,
          });
          if (r.error) throw r.error;
        }
      })(),
      "Could not update notification settings. Check your connection and try again.",
      5000,
    ),
  ]);
  const failed = outcomes.find((r) => r.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}
export async function pushRequest(body: Record<string, string>) {
  const session = await supabase!.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error("Sign in first.");
  const response = await fetch("/api/push-notifications", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error || "Notifications are temporarily unavailable.",
    );
  return result;
}
export function dispatchPush(workspace: string) {
  // The durable scheduled worker retries if the tab closes or this request fails.
  void pushRequest({ action: "dispatch", workspace }).catch(() => {});
}

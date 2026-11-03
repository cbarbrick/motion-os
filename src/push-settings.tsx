import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import {
  devicePushState,
  enableDevicePush,
  disableDevicePush,
  pushRequest,
  type DevicePushState,
} from "./push-client";
export function PushSettings({
  preview,
  userId,
}: {
  preview: boolean;
  userId: string;
}) {
  const [device, setDevice] = useState<DevicePushState | null>(null),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (preview) return;
    let active = true;
    setError("");
    setDevice(null);
    void Promise.all([
      devicePushState(),
      fetch("/.netlify/functions/push-notifications").then(async (r) => {
        const data = await r.json();
        if (!r.ok)
          throw new Error(data.error || "Phone notifications are unavailable.");
        return data.publicKey as string;
      }),
    ])
      .then(([state, publicKey]) => {
        if (active) {
          setDevice(state);
          setKey(publicKey);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [preview, userId, reload]);
  async function change(action: "on" | "off" | "test") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (action === "on") {
        setDevice(await enableDevicePush(key, setMessage));
        setMessage("Enabled on this device. Use Send test to check delivery.");
      } else if (action === "off") {
        await disableDevicePush();
        setDevice({ mode: "off" });
        setMessage(
          "Notifications are off on this device. Your in-app alerts remain on.",
        );
      } else {
        await pushRequest({ action: "test", subscription: device!.id! });
        setMessage(
          "Test accepted by the push service. Check this device’s notifications; Focus and notification settings can silence alerts.",
        );
      }
    } catch (e) {
      setMessage("");
      setError((e as Error).message);
      try {
        setDevice(await devicePushState());
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="push-settings" aria-label="Device notifications">
      <div className="section-line">
        <h3>
          <BellRing size={17} /> Device notifications
        </h3>
        {device?.mode === "on" && <span className="badge">On</span>}
      </div>
      {preview ? (
        <p>Phone alerts are available in your signed-in workspace.</p>
      ) : (
        <>
          <p>
            Get calendar, deliverable and available-task alerts even when Motion
            OS is closed. Enable this separately on each phone or computer.
          </p>
          {device?.mode === "install" ? (
            <p className="notice">
              On iPhone or iPad: open Motion OS in Safari, choose Share → Add to
              Home Screen, then open that icon and return here. Requires
              iOS/iPadOS 16.4 or later.
            </p>
          ) : device?.mode === "unsupported" ? (
            <p className="notice">
              This browser does not support push notifications. Open Motion OS
              in Safari on an iPhone home screen, or a current Chrome, Edge or
              Firefox browser.
            </p>
          ) : device?.mode === "blocked" ? (
            <p className="notice">
              Notifications are blocked. Allow them in this site’s browser
              settings or in your phone’s notification settings, then check
              again.
            </p>
          ) : device ? (
            <div className="push-actions">
              {device.mode === "on" ? (
                <>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void change("test")}
                  >
                    Send test notification
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void change("off")}
                  >
                    Turn off on this device
                  </button>
                </>
              ) : (
                <button
                  className="button primary"
                  disabled={busy || !key}
                  onClick={() => void change("on")}
                >
                  Enable notifications
                </button>
              )}
            </div>
          ) : (
            !error && <p role="status">Checking this device…</p>
          )}
          {(error || device?.mode === "blocked") && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setReload((n) => n + 1)}
            >
              Check again
            </button>
          )}
          {message && <p role="status">{message}</p>}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { MotionIcon, MotionWordmark } from "./brand";
import { supabase } from "./client";
import {
  discardHomeLogin,
  forgetReturn,
  homeLoginLaunch,
  homeLoginReturn,
  loginRequest,
  prepareHomeLogin,
  pairingCode,
  readPending,
  rememberReturn,
  savePending,
} from "./home-login";

export function HomeScreenSignIn() {
  const [pending, setPending] = useState(readPending),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false);
  async function prepare() {
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      setPending(await prepareHomeLogin(supabase));
    } catch {
      setMessage(
        "Could not prepare sign-in. Check your connection and try again.",
      );
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!pending) void prepare();
  }, []);
  useEffect(() => {
    if (!pending?.started || failed || !supabase) return;
    let stopped = false,
      running = false;
    async function check() {
      if (stopped || running || document.visibilityState === "hidden") return;
      running = true;
      try {
        if (pending!.expiresAt <= Date.now())
          throw Object.assign(new Error("Sign-in expired. Try again."), {
            terminal: true,
          });
        const result = await loginRequest("app-login", {
          action: "status",
          id: pending!.id,
          secret: pending!.readSecret,
        });
        if (stopped) return;
        if (result.state === "ready") {
          if (result.failed)
            throw Object.assign(new Error("Sign-in canceled. Try again."), {
              terminal: true,
            });
          setMessage("Saving your sign-in...");
          const { error } = await supabase!.auth.exchangeCodeForSession(
            result.code,
            pending!.flowId ? { flowId: pending!.flowId } : undefined,
          );
          if (error)
            throw Object.assign(
              new Error("Sign-in could not finish. Try again."),
              { terminal: true },
            );
          await discardHomeLogin(pending!);
        } else
          setMessage(
            "Close the Google window and return here after signing in.",
          );
      } catch (error) {
        if (stopped) return;
        const e = error as Error & { terminal?: boolean; status?: number };
        if (e.terminal || e.status === 410 || e.status === 403) {
          setFailed(true);
          setMessage(e.message);
          void discardHomeLogin(pending!);
        } else
          setMessage("Waiting for a connection. Your sign-in is still open.");
      } finally {
        running = false;
      }
    }
    void check();
    const timer = setInterval(() => void check(), 4000);
    const resume = () => void check();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
    };
  }, [pending?.id, pending?.started, failed]);
  return (
    <div className="home-screen-sign-in">
      {pending && !failed ? (
        <a
          className="button primary full"
          href={pending.launchHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            try {
              const next = { ...pending, started: true };
              savePending(next);
              setPending(next);
            } catch {
              event.preventDefault();
              setFailed(true);
              setMessage("Allow website storage to stay signed in.");
            }
          }}
        >
          {pending.started ? "Open Google sign-in" : "Continue with Google"}
          <ArrowRight size={17} />
        </a>
      ) : (
        <button
          className="button primary full"
          disabled={busy}
          onClick={() => void prepare()}
        >
          {busy ? "Preparing sign-in..." : "Try again"}
        </button>
      )}
      <p className="home-sign-in-note">Stay signed in on this device.</p>
      {pending && !failed && (
        <p className="login-pairing-code">
          Sign-in code <strong>{pairingCode(pending.id)}</strong>
        </p>
      )}
      {message && (
        <p className={`notice ${failed ? "error" : ""}`} role="status">
          {message}
        </p>
      )}
      {pending?.started && !failed && (
        <button
          className="text-button"
          onClick={async () => {
            setFailed(true);
            await discardHomeLogin(pending);
            setPending(null);
            void prepare();
          }}
        >
          Restart sign-in
        </button>
      )}
    </div>
  );
}

export function HomeLoginWindow() {
  const [state, setState] = useState<"confirm" | "loading" | "done" | "error">(
      "loading",
    ),
    [message, setMessage] = useState("Opening Google..."),
    [canRetry, setCanRetry] = useState(true);
  async function complete() {
    if (!homeLoginReturn) return;
    setState("loading");
    setMessage("Returning your sign-in...");
    try {
      await loginRequest("app-login", {
        action: "complete",
        id: homeLoginReturn.id,
        secret: homeLoginReturn.secret,
        code: homeLoginReturn.code,
        flowId: homeLoginReturn.flowId,
        failed: homeLoginReturn.failed,
      });
      forgetReturn();
      setCanRetry(false);
      setState(homeLoginReturn.failed ? "error" : "done");
      setMessage(
        homeLoginReturn.failed
          ? "Sign-in canceled. Open Motion OS to try again."
          : "Close this window and open Motion OS from your home screen.",
      );
    } catch (error) {
      setState("error");
      const status = (error as { status?: number }).status;
      if (status === 410 || status === 403) {
        forgetReturn();
        setCanRetry(false);
        setMessage("Sign-in expired. Open Motion OS to try again.");
      } else
        setMessage(
          "Could not return your sign-in. Check your connection and try again.",
        );
    }
  }
  useEffect(() => {
    // Remove the write-only handoff secret and callback code from the visible URL.
    history.replaceState(null, "", "/");
    if (homeLoginReturn) {
      void complete();
      return;
    }
    if (homeLoginLaunch && !homeLoginLaunch.invalid) {
      setState("confirm");
      setMessage(
        "Match this code with the code in your Motion home-screen app.",
      );
    } else {
      setState("error");
      setMessage("Sign-in expired. Open Motion OS to try again.");
    }
  }, []);
  return (
    <div className="login-return">
      <div className="wordmark">
        <MotionWordmark />
      </div>
      <section className="panel">
        <MotionIcon />
        {state === "done" && <Check size={36} />}
        <h1>
          {state === "confirm"
            ? "Confirm sign-in"
            : state === "done"
              ? "Sign-in ready"
              : state === "error"
                ? "Sign-in not finished"
                : "Signing in"}
        </h1>
        <p role="status">{message}</p>
        {state === "confirm" && homeLoginLaunch && !homeLoginLaunch.invalid && (
          <>
            <strong className="login-pairing-code">
              {pairingCode(homeLoginLaunch.id)}
            </strong>
            <button
              className="button primary"
              onClick={() => {
                try {
                  if (
                    !homeLoginLaunch ||
                    homeLoginLaunch.invalid ||
                    homeLoginLaunch.expiresAt <= Date.now()
                  )
                    throw new Error();
                  rememberReturn({
                    id: homeLoginLaunch.id,
                    secret: homeLoginLaunch.secret,
                    expiresAt: homeLoginLaunch.expiresAt,
                  });
                  location.replace(homeLoginLaunch.authorizeUrl);
                } catch {
                  setState("error");
                  setMessage(
                    "Restart sign-in from your Motion home-screen app.",
                  );
                }
              }}
            >
              Code matches. Continue
            </button>
          </>
        )}
        {state === "done" && (
          <button className="button primary" onClick={() => window.close()}>
            Return to Motion OS
          </button>
        )}
        {state === "error" && homeLoginReturn && canRetry && (
          <button className="button primary" onClick={() => void complete()}>
            Try again
          </button>
        )}
      </section>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { supabase, googleEnabled, emailEnabled } from "./client";
import { HomeScreenSignIn } from "./home-login-view";
import { isHomeScreen } from "./home-login";
import { MotionIcon, MotionWordmark } from "./brand";
import type { useWorkspace } from "./use-workspace";
export function Welcome({ store }: { store: ReturnType<typeof useWorkspace> }) {
  const [homeScreen] = useState(isHomeScreen);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [signup, setSignup] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    try {
      const result = signup
        ? await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { full_name: name },
              emailRedirectTo: location.origin,
            },
          })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (signup && !result.data.session)
        setMessage("Check your email to confirm your account, then sign in.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function magic() {
    if (!supabase || !email) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin, shouldCreateUser: false },
    });
    setMessage(error?.message || "Check your email for your sign-in link.");
    setBusy(false);
  }
  async function reset() {
    if (!supabase || !email) return;
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin,
    });
    setMessage(
      error?.message ||
        "If this email has an account, a password reset link is on its way.",
    );
    setBusy(false);
  }
  async function googleSignIn() {
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: location.origin,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch (e) {
      setMessage((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="welcome">
      <div className="welcome-story">
        <div className="wordmark">
          <MotionWordmark />
        </div>
        <h1>Motion OS</h1>
        <p>Tasks. Calendar. Athletes. People.</p>
      </div>
      <div className="welcome-form">
        <div className="wordmark mobile-wordmark">
          <MotionWordmark />
        </div>
        <MotionIcon />
        <h2>
          {supabase ? (signup ? "Join the team" : "Sign in") : "Motion OS"}
        </h2>
        <p>
          {supabase
            ? store.inviteToken
              ? "Sign in to join your team."
              : "Use your Google account."
            : "Open the sample workspace."}
        </p>
        {supabase &&
          googleEnabled &&
          (homeScreen ? (
            <HomeScreenSignIn />
          ) : (
            <button
              type="button"
              className="button primary full"
              disabled={busy}
              onClick={googleSignIn}
            >
              {busy ? "Connecting..." : "Continue with Google"}
              <ArrowRight size={17} />
            </button>
          ))}
        {supabase ? (
          emailEnabled ? (
            <form onSubmit={submit}>
              {signup && (
                <label>
                  Your name
                  <input
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </label>
              )}
              <label>
                Email
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </label>
              <label>
                Password
                <input
                  required
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={signup ? "new-password" : "current-password"}
                />
              </label>
              <button className="button primary full" disabled={busy}>
                {busy
                  ? "Please wait..."
                  : signup
                    ? "Create account"
                    : "Sign in"}
                <ArrowRight size={17} />
              </button>
              {!signup && (
                <button
                  type="button"
                  className="button subtle full"
                  disabled={busy || !email}
                  onClick={magic}
                >
                  <Mail size={16} />
                  Email me a sign-in link
                </button>
              )}
              {!signup && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy || !email}
                  onClick={reset}
                >
                  Forgot password?
                </button>
              )}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setSignup(!signup);
                  setMessage("");
                }}
              >
                {signup
                  ? "Already have an account? Sign in"
                  : "New here? Create your account"}
              </button>
            </form>
          ) : !googleEnabled ? (
            <p className="setup-note">
              Team sign-in is being connected. You can explore the sample
              workspace below.
            </p>
          ) : null
        ) : (
          <div className="setup-note">
            Sample mode saves in this browser only. Real team accounts and cloud
            saving will be clearly marked once connected.
          </div>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {store.error && <p className="notice error">{store.error}</p>}
        <button className="button full" onClick={store.enterPreview}>
          View sample <ArrowRight size={17} />
        </button>
        <small>
          No real company records are included in the sample.{" "}
          <a href="/privacy.html">Privacy</a>
        </small>
      </div>
    </div>
  );
}
export function WorkspaceSetup({
  store,
}: {
  store: ReturnType<typeof useWorkspace>;
}) {
  const [name, setName] = useState(
      store.session?.user.user_metadata.full_name || "",
    ),
    [company, setCompany] = useState("Motion"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function go(create: boolean) {
    if (!supabase || !name.trim()) return;
    setBusy(true);
    try {
      const r = create
        ? await supabase.rpc("create_workspace", {
            p_name: company,
            p_display_name: name,
          })
        : await supabase.rpc("accept_access", { p_name: name });
      if (r.error) throw r.error;
      await store.refresh();
      setMessage(
        create
          ? "Workspace created."
          : "Access checked. If your workspace is still missing, open the invite link from your workspace owner.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="setup">
      <div className="panel">
        <MotionIcon />
        <h1>Make room for your team.</h1>
        <p>
          Signed in as {store.session?.user.email}. Open your team’s invite link
          to join their workspace, or create your own below.
        </p>
        <label>
          Your name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </label>
        <button
          className="button primary"
          disabled={busy || !name.trim()}
          onClick={() => go(false)}
        >
          Join my team
        </button>
        <hr />
        <label>
          New workspace name
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            maxLength={100}
          />
        </label>
        <button
          className="button"
          disabled={busy || !name.trim() || !company.trim()}
          onClick={() => go(true)}
        >
          Create a workspace
        </button>
        {(message || store.error) && (
          <p role="status" className="notice">
            {message || store.error}
          </p>
        )}
        <button className="text-button" onClick={store.signOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

export function JoinInvitation({
  store,
}: {
  store: ReturnType<typeof useWorkspace>;
}) {
  const [name, setName] = useState(
      store.session?.user.user_metadata.full_name || "",
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const r = await supabase!.rpc("join_workspace", {
        p_token: store.inviteToken,
        p_name: name,
      });
      if (r.error) throw r.error;
      store.setWorkspaceId(r.data);
      store.clearInvite();
      await store.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="setup">
      <div className="panel">
        <MotionIcon />
        <h1>You’re invited.</h1>
        <p>
          Join with {store.session?.user.email}. Everyone in the workspace can
          assign tasks and check off finished work.
        </p>
        <form onSubmit={join}>
          <label>
            Your name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </label>
          <button className="button primary" disabled={busy || !name.trim()}>
            {busy ? "Joining..." : "Join workspace"}
          </button>
        </form>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <button
          className="text-button"
          disabled={busy}
          onClick={store.clearInvite}
        >
          Cancel invitation
        </button>
        <button className="text-button" disabled={busy} onClick={store.signOut}>
          Use a different account
        </button>
      </div>
    </div>
  );
}
export function ResetPassword({
  store,
}: {
  store: ReturnType<typeof useWorkspace>;
}) {
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setMessage("Passwords must match.");
      return;
    }
    setBusy(true);
    const { error } = await supabase!.auth.updateUser({ password });
    if (error) setMessage(error.message);
    else store.finishRecovery();
    setBusy(false);
  }
  return (
    <div className="setup">
      <div className="panel">
        <MotionIcon />
        <h1>Choose a new password.</h1>
        <form onSubmit={save}>
          <label>
            New password
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving..." : "Save password"}
          </button>
        </form>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

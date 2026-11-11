import type { SupabaseClient } from "@supabase/supabase-js";
export const pendingKey = "motion-home-login-v1";
const returnKey = "motion-home-login-return-v1";
export interface PendingLogin {
  id: string;
  readSecret: string;
  expiresAt: number;
  launchHref: string;
  started: boolean;
  flowId: string | null;
}
export interface LoginReturn {
  id: string;
  secret: string;
  expiresAt: number;
  code: string | null;
  flowId: string | null;
  failed: boolean;
}
const idPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const secretPattern = /^[a-f0-9]{64}$/;
export function pairingCode(id: string) {
  return (parseInt(id.slice(0, 8), 16) % 1_000_000).toString().padStart(6, "0");
}
export function isHomeScreen() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
export function readPending(): PendingLogin | null {
  try {
    const value = JSON.parse(localStorage.getItem(pendingKey) || "null");
    if (
      value &&
      idPattern.test(value.id) &&
      secretPattern.test(value.readSecret) &&
      value.expiresAt > Date.now() &&
      typeof value.launchHref === "string"
    )
      return value;
    localStorage.removeItem(pendingKey);
  } catch {}
  return null;
}
export function savePending(value: PendingLogin) {
  localStorage.setItem(pendingKey, JSON.stringify(value));
  if (localStorage.getItem(pendingKey) !== JSON.stringify(value))
    throw new Error("Allow website storage to stay signed in.");
}
export async function loginRequest(endpoint: string, body: object) {
  const response = await fetch(`/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const error = new Error(
      response.status === 410
        ? "Sign-in expired. Try again."
        : response.status === 429
          ? "Please wait a minute and try again."
          : "Could not connect. Try again.",
    );
    Object.assign(error, { status: response.status });
    throw error;
  }
  return response.json();
}
function secret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
let preparation: Promise<PendingLogin> | null = null;
export function prepareHomeLogin(
  client: SupabaseClient,
): Promise<PendingLogin> {
  if (preparation) return preparation;
  preparation = (async () => {
    const existing = readPending();
    if (existing) return existing;
    // Test durable storage before starting Google. The SDK keeps its verifier here too.
    localStorage.setItem("motion-storage-check", "1");
    localStorage.removeItem("motion-storage-check");
    const readSecret = secret(),
      writeSecret = secret();
    const ticket = await loginRequest("app-login-start", {
      readHash: await digest(readSecret),
      writeHash: await digest(writeSecret),
    });
    try {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: location.origin, skipBrowserRedirect: true },
      });
      if (error || !data.url)
        throw error || new Error("Could not open Google sign-in.");
      const launch = new URL(location.origin);
      launch.hash = new URLSearchParams({
        app_login: JSON.stringify({
          id: ticket.id,
          secret: writeSecret,
          expiresAt: ticket.expiresAt,
          authorizeUrl: data.url,
        }),
      }).toString();
      const pending = {
        id: ticket.id,
        readSecret,
        expiresAt: ticket.expiresAt,
        launchHref: launch.href,
        started: false,
        flowId: data.flowId ?? null,
      };
      savePending(pending);
      return pending;
    } catch (error) {
      void loginRequest("app-login", {
        action: "finish",
        id: ticket.id,
        secret: readSecret,
      }).catch(() => {});
      throw error;
    }
  })().finally(() => {
    preparation = null;
  });
  return preparation;
}
export async function discardHomeLogin(pending: PendingLogin) {
  if (readPending()?.id === pending.id) localStorage.removeItem(pendingKey);
  await loginRequest("app-login", {
    action: "finish",
    id: pending.id,
    secret: pending.readSecret,
  }).catch(() => {});
}
export function readLaunch() {
  const value = new URLSearchParams(location.hash.slice(1)).get("app_login");
  if (!value) return null;
  try {
    const launch = JSON.parse(value),
      url = new URL(launch.authorizeUrl),
      expected = new URL(import.meta.env.VITE_SUPABASE_URL);
    const redirect = new URL(url.searchParams.get("redirect_to") || "");
    if (
      !idPattern.test(launch.id) ||
      !secretPattern.test(launch.secret) ||
      !Number.isFinite(launch.expiresAt) ||
      launch.expiresAt <= Date.now() ||
      launch.expiresAt > Date.now() + 11 * 60_000 ||
      url.origin !== expected.origin ||
      url.pathname !== "/auth/v1/authorize" ||
      url.searchParams.get("provider") !== "google" ||
      url.searchParams.get("code_challenge_method") !== "s256" ||
      redirect.origin !== location.origin ||
      redirect.pathname !== "/" ||
      redirect.hash
    )
      return { invalid: true as const };
    return {
      invalid: false as const,
      id: launch.id as string,
      secret: launch.secret as string,
      expiresAt: launch.expiresAt as number,
      authorizeUrl: url.href,
    };
  } catch {
    return { invalid: true as const };
  }
}
export function rememberReturn(value: {
  id: string;
  secret: string;
  expiresAt: number;
}) {
  sessionStorage.setItem(returnKey, JSON.stringify(value));
}
export function readLoginReturn(): LoginReturn | null {
  try {
    const query = new URLSearchParams(location.search),
      value = JSON.parse(sessionStorage.getItem(returnKey) || "null");
    if (
      !value ||
      !idPattern.test(value.id) ||
      !secretPattern.test(value.secret) ||
      !Number.isFinite(value.expiresAt)
    )
      return null;
    const code = query.get("code"),
      failureHash = new URLSearchParams(location.hash.slice(1)),
      failed =
        query.has("error") ||
        query.has("error_code") ||
        failureHash.has("error") ||
        failureHash.has("error_code");
    if (!code && !failed) return null;
    return { ...value, code, flowId: query.get("sb_flow_id"), failed };
  } catch {
    return null;
  }
}
export function forgetReturn() {
  sessionStorage.removeItem(returnKey);
}
// Capture before the Supabase client is constructed. The external window must
// relay this code, not exchange it using Safari's unrelated storage.
export const homeLoginReturn = readLoginReturn();
export const homeLoginLaunch = readLaunch();

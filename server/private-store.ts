import { createClient } from "@supabase/supabase-js";

export function serverDatabase() {
  const url = process.env.CALENDAR_SUPABASE_URL;
  const secret = process.env.CALENDAR_SUPABASE_SECRET;
  if (process.env.VERCEL_ENV !== "production" || !url || !secret)
    throw new Error("Server storage is available in production only");
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function privateStore(
  namespace: "motion-google-calendar" | "motion-app-login",
) {
  const db = serverDatabase();
  async function call(key: string, action: string, value: unknown = null) {
    const expires =
      value &&
      typeof value === "object" &&
      "expiresAt" in value &&
      typeof value.expiresAt === "number"
        ? new Date(value.expiresAt).toISOString()
        : null;
    const result = await db.rpc("server_store", {
      p_namespace: namespace,
      p_key: key,
      p_action: action,
      p_value: value,
      p_expires: expires,
    });
    if (result.error) throw new Error("Private storage unavailable");
    return result.data;
  }
  return {
    get: (key: string, _options: { type: "text" | "json" }) => call(key, "get"),
    set: (key: string, value: string) => call(key, "set", value),
    setJSON: (key: string, value: unknown, options: { onlyIfNew: true }) =>
      call(key, options.onlyIfNew ? "create" : "set", value),
    delete: async (key: string) => {
      await call(key, "delete");
    },
  };
}

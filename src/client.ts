import { homeLoginReturn } from "./home-login";
import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          flowType: "pkce",
          detectSessionInUrl: !homeLoginReturn,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;
export const googleEnabled =
  import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true";
export const emailEnabled = import.meta.env.VITE_EMAIL_AUTH_ENABLED === "true";

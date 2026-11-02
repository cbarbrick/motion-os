import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
export function homeLoginStore(context: Context) {
  return getStore({
    name:
      context.deploy.context === "production"
        ? "motion-app-login"
        : `motion-app-login-${context.deploy.id}`,
    consistency: "strong",
  });
}

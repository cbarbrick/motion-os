import type { Config, Context } from "@netlify/functions";
import { startLogin, reply } from "../lib/home-login";
import { homeLoginStore } from "../lib/home-login-store";
export default async (request: Request, context: Context) => {
  try {
    return await startLogin(request, homeLoginStore(context));
  } catch {
    return reply({ error: "Sign-in is unavailable. Try again." }, 503);
  }
};
export const config: Config = {
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowSize: 60,
    windowLimit: 25,
  },
};

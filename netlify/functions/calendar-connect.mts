import type { Context, Config } from "@netlify/functions";
import {
  runtime,
  authorize,
  connect,
  json,
  failure,
} from "../lib/calendar-runtime";
export default async (request: Request, context: Context) => {
  try {
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    if (Number(request.headers.get("content-length") || 0) > 10000)
      return json({ error: "Request too large." }, 413);
    const body = await request.json(),
      rt = runtime(context);
    const { user } = await authorize(request, rt, body.workspace, true);
    return json(await connect(rt, body.workspace, user, body.refreshToken));
  } catch (e) {
    return failure(e);
  }
};
export const config: Config = {
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowSize: 60,
    windowLimit: 10,
  },
};

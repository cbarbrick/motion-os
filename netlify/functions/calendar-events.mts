import type { Context, Config } from "@netlify/functions";
import {
  runtime,
  authorize,
  readCalendar,
  json,
  failure,
} from "../lib/calendar-runtime";
export default async (request: Request, context: Context) => {
  try {
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    const body = await request.json(),
      rt = runtime(context);
    await authorize(request, rt, body.workspace);
    return json(await readCalendar(rt, body.workspace, body.start, body.end));
  } catch (e) {
    return failure(e);
  }
};
export const config: Config = {
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowSize: 60,
    windowLimit: 60,
  },
};

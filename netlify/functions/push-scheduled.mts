import type { Context, Config } from "@netlify/functions";
import { pushRuntime, drainPush } from "../lib/push-runtime";
export default async (_request: Request, context: Context) => {
  await drainPush(pushRuntime(context), null);
};
// Every minute in UTC; retries work even when every workspace member is offline.
export const config: Config = { schedule: "* * * * *" };

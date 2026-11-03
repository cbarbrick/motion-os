import type { Context, Config } from "@netlify/functions";
import { runtime, drain } from "../lib/calendar-runtime";
export default async (_request: Request, context: Context) => {
  await drain(runtime(context), null, 10);
};
// Every minute, UTC. No dependency on a member leaving the OS open.
export const config: Config = { schedule: "* * * * *" };

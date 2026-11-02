import type { Config, Context } from "@netlify/functions";
import { homeLoginStore } from "../lib/home-login-store";
export default async (_request: Request, context: Context) => {
  const store = homeLoginStore(context),
    now = Date.now();
  for await (const page of store.list({ paginate: true })) {
    await Promise.all(
      page.blobs.map(async ({ key }) => {
        const value = await store.get(key, { type: "json" });
        if (
          value &&
          typeof value.expiresAt === "number" &&
          value.expiresAt <= now
        )
          await store.delete(key);
      }),
    );
  }
};
// Expired abandoned codes are unusable immediately; purge their cache hourly.
export const config: Config = { schedule: "17 * * * *" };

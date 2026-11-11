import { createHash, timingSafeEqual } from "node:crypto";
import { ipAddress } from "@vercel/functions";
import { serverDatabase } from "./private-store.js";

export function endpoint(
  name: string,
  limit: number,
  handler: (request: Request) => Promise<Response>,
) {
  return {
    async fetch(request: Request) {
      try {
        const key = createHash("sha256")
          .update(`${name}:${ipAddress(request) || "unknown"}`)
          .digest("hex");
        const result = await serverDatabase().rpc("server_rate_limit", {
          p_key: key,
          p_limit: limit,
        });
        if (result.error) throw new Error("Rate limit unavailable");
        if (!result.data)
          return Response.json(
            { error: "Please wait a minute and try again." },
            {
              status: 429,
              headers: { "retry-after": "60", "cache-control": "no-store" },
            },
          );
        return await handler(request);
      } catch {
        // Never log request bodies, OAuth codes, subscriptions or credentials.
        console.error(`Motion endpoint unavailable: ${name}`);
        return Response.json(
          {
            error: "This service is temporarily unavailable. Please try again.",
          },
          {
            status: 503,
            headers: { "cache-control": "no-store" },
          },
        );
      }
    },
  };
}

export function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  return (
    !!secret &&
    request.method === "GET" &&
    supplied.length === expected.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  );
}

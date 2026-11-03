import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import type { Context } from "@netlify/functions";
import { deliverPushJobs, type PushJob, type PushTarget } from "./push";
export class PushError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function pushRuntime(context: Context) {
  if (context.deploy.context !== "production")
    throw new PushError(
      "Phone notifications are available on the live Motion OS site.",
      403,
    );
  const url = Netlify.env.get("CALENDAR_SUPABASE_URL"),
    secret = Netlify.env.get("CALENDAR_SUPABASE_SECRET");
  const publicKey = Netlify.env.get("PUSH_VAPID_PUBLIC_KEY"),
    privateKey = Netlify.env.get("PUSH_VAPID_PRIVATE_KEY");
  if (!url || !secret || !publicKey || !privateKey)
    throw new PushError(
      "Phone notifications are not ready. Try again shortly.",
      503,
    );
  const db = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const send = (target: PushTarget, payload: string, topic: string) =>
    webpush.sendNotification(target, payload, {
      vapidDetails: {
        subject: "mailto:char@motionbrand.com",
        publicKey,
        privateKey,
      },
      TTL: 3600,
      urgency: "normal",
      topic,
      timeout: 8000,
    });
  return { db, publicKey, send };
}
export function pushJson(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
export async function pushAuthorize(
  request: Request,
  rt: ReturnType<typeof pushRuntime>,
) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new PushError("Open this action from Motion OS.", 403);
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new PushError("Sign in first.", 401);
  const result = await rt.db.auth.getUser(token);
  if (result.error || !result.data.user)
    throw new PushError("Sign in again.", 401);
  return result.data.user.id;
}
export async function drainPush(
  rt: ReturnType<typeof pushRuntime>,
  workspace: string | null,
) {
  const result = await rt.db.rpc("claim_push_deliveries", {
    p_workspace: workspace,
  });
  if (result.error) throw new Error("Push queue unavailable");
  return deliverPushJobs(
    result.data as PushJob[],
    rt.send,
    async (job, status) => {
      const r = await rt.db.rpc("finish_push_delivery", {
        p_id: job.id,
        p_lease: job.lease,
        p_status: status,
      });
      if (r.error) throw new Error("Push result could not be saved");
    },
  );
}

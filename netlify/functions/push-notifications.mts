import type { Context, Config } from "@netlify/functions";
import {
  pushRuntime,
  pushJson,
  pushAuthorize,
  drainPush,
  PushError,
} from "../lib/push-runtime";
import { pushPayload, validPushTarget } from "../lib/push";
export default async (request: Request, context: Context) => {
  try {
    if (!["GET", "POST"].includes(request.method))
      return pushJson({ error: "Use GET or POST." }, 405);
    const rt = pushRuntime(context);
    if (request.method === "GET") return pushJson({ publicKey: rt.publicKey });
    const user = await pushAuthorize(request, rt);
    const raw = await request.text();
    if (raw.length > 4096) throw new PushError("Request is too large.", 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new PushError("Invalid request.");
    }
    if (body?.action === "test") {
      if (!/^[0-9a-f-]{36}$/i.test(body.subscription || ""))
        throw new PushError("Enable notifications first.");
      const result = await rt.db.rpc("prepare_push_test", {
        p_id: body.subscription,
        p_user: user,
      });
      if (result.error || !result.data)
        throw new PushError(
          "Enable notifications on this device, or wait 30 seconds before another test.",
        );
      if (!validPushTarget(result.data))
        throw new PushError("This push service is not supported.");
      try {
        await rt.send(
          result.data,
          pushPayload("test", crypto.randomUUID()),
          "motion-test",
        );
      } catch {
        throw new PushError(
          "The push service did not accept the test. Turn notifications off and on, then try again.",
          502,
        );
      }
      return pushJson({ accepted: true });
    }
    if (
      body?.action !== "dispatch" ||
      !/^[0-9a-f-]{36}$/i.test(body.workspace || "")
    )
      throw new PushError("Choose a workspace.");
    const member = await rt.db
      .from("members")
      .select("user_id")
      .eq("workspace_id", body.workspace)
      .eq("user_id", user)
      .maybeSingle();
    if (member.error || !member.data)
      throw new PushError("Workspace access required.", 403);
    return pushJson(await drainPush(rt, body.workspace));
  } catch (e) {
    return pushJson(
      {
        error:
          e instanceof PushError
            ? e.message
            : "Phone notification delivery is temporarily unavailable.",
      },
      e instanceof PushError ? e.status : 503,
    );
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

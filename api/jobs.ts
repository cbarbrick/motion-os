import { cronAuthorized } from "../server/http.js";
import { serverDatabase } from "../server/private-store.js";
import { drain, runtime } from "../server/calendar-runtime.js";
import { drainPush, pushRuntime } from "../server/push-runtime.js";

export default {
  async fetch(request: Request) {
    if (!cronAuthorized(request))
      return new Response("Unauthorized", { status: 401 });
    const results = await Promise.allSettled([
      drain(runtime(), null, 10),
      drainPush(pushRuntime(), null),
      serverDatabase()
        .rpc("cleanup_server_store")
        .then((r) => {
          if (r.error) throw new Error("Cleanup failed");
        }),
    ]);
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) console.error(`Motion background jobs failed: ${failed}`);
    return Response.json(
      { ok: failed === 0 },
      {
        status: failed ? 503 : 200,
        headers: { "cache-control": "no-store" },
      },
    );
  },
};

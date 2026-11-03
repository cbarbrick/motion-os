export type PushTarget = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
export type PushJob = {
  id: string;
  lease: string;
  kind: string;
  notification: string;
  subscription: PushTarget;
};
export function validPushTarget(target: PushTarget) {
  try {
    const u = new URL(target.endpoint);
    const allowed =
      [
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ].includes(u.hostname) ||
      /^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname);
    return (
      allowed &&
      u.protocol === "https:" &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.hash &&
      target.endpoint.length <= 2048 &&
      /^[A-Za-z0-9_-]{87}$/.test(target.keys.p256dh) &&
      /^[A-Za-z0-9_-]{22}$/.test(target.keys.auth)
    );
  } catch {
    return false;
  }
}
export function pushPayload(kind: string, id: string) {
  const bodies: Record<string, string> = {
    event_added: "A calendar event was added.",
    deliverable_added: "A new deliverable was added.",
    task_available: "A new task is available for anyone to take.",
    task_added: "You were added to a task.",
    test: "Notifications are connected on this device.",
  };
  // Keep record titles, names, photos and links off lock screens.
  return JSON.stringify({
    title: "Motion OS",
    body: `${bodies[kind] || "There is new team activity."} Open Motion OS to view.`,
    tag: `motion-${id}`,
    url: "/#notifications",
  });
}
export function pushResult(error: unknown): "expired" | "retry" | "failed" {
  const code = (error as { statusCode?: number })?.statusCode;
  if (code === 404 || code === 410) return "expired";
  if (!code || code === 408 || code === 429 || code >= 500) return "retry";
  return "failed";
}
export async function deliverPushJobs(
  jobs: PushJob[],
  send: (
    target: PushTarget,
    payload: string,
    topic: string,
  ) => Promise<unknown>,
  finish: (job: PushJob, status: string) => Promise<unknown>,
) {
  let accepted = 0;
  await Promise.all(
    jobs.map(async (job) => {
      let status: string = "failed";
      if (validPushTarget(job.subscription)) {
        try {
          await send(
            job.subscription,
            pushPayload(job.kind, job.notification),
            job.id.replaceAll("-", "").slice(0, 32),
          );
          status = "sent";
          accepted++;
        } catch (e) {
          status = pushResult(e);
        }
      }
      await finish(job, status);
    }),
  );
  return { accepted };
}

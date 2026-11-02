import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

// This cache only carries single-use PKCE codes. Session tokens and the PKCE
// verifier never leave the installed app through these endpoints.
export interface Ticket {
  readHash: string;
  writeHash: string;
  expiresAt: number;
}
export interface Result {
  code: string | null;
  flowId: string | null;
  failed: boolean;
  expiresAt: number;
}
export interface Store {
  get(key: string, options: { type: "json" }): Promise<any>;
  setJSON(
    key: string,
    value: unknown,
    options: { onlyIfNew: true },
  ): Promise<{ modified: boolean }>;
  delete(key: string): Promise<void>;
}
const hex = /^[a-f0-9]{64}$/;
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export function reply(body: object, status = 200) {
  return Response.json(body, { status, headers });
}
function authorized(secret: unknown, hash: string) {
  return (
    typeof secret === "string" &&
    hex.test(secret) &&
    timingSafeEqual(
      Buffer.from(createHash("sha256").update(secret).digest("hex"), "hex"),
      Buffer.from(hash, "hex"),
    )
  );
}
async function bodyOf(request: Request) {
  if (request.method !== "POST") throw new Error("method");
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new Error("origin");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("body");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("body");
  let length = 0,
    text = "";
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 8192) {
      await reader.cancel();
      throw new Error("body");
    }
    text += decoder.decode(value, { stream: true });
  }
  const body = JSON.parse(text + decoder.decode());
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("body");
  return body;
}
export async function startLogin(
  request: Request,
  store: Store,
  now = Date.now(),
) {
  let body;
  try {
    body = await bodyOf(request);
  } catch {
    return reply({ error: "Invalid request" }, 400);
  }
  if (
    !hex.test(body.readHash) ||
    !hex.test(body.writeHash) ||
    body.readHash === body.writeHash
  )
    return reply({ error: "Invalid request" }, 400);
  const id = randomUUID(),
    expiresAt = now + 10 * 60_000;
  const { modified } = await store.setJSON(
    `ticket/${id}`,
    { readHash: body.readHash, writeHash: body.writeHash, expiresAt },
    { onlyIfNew: true },
  );
  if (!modified) return reply({ error: "Please try again" }, 409);
  return reply({ id, expiresAt }, 201);
}
export async function relayLogin(
  request: Request,
  store: Store,
  now = Date.now(),
) {
  let body;
  try {
    body = await bodyOf(request);
  } catch {
    return reply({ error: "Invalid request" }, 400);
  }
  if (
    typeof body.id !== "string" ||
    !uuid.test(body.id) ||
    !["status", "complete", "finish"].includes(body.action)
  )
    return reply({ error: "Invalid request" }, 400);
  const ticket: Ticket | null = await store.get(`ticket/${body.id}`, {
    type: "json",
  });
  if (!ticket || ticket.expiresAt <= now)
    return reply({ error: "Sign-in expired. Try again." }, 410);
  if (
    !authorized(
      body.secret,
      body.action === "complete" ? ticket.writeHash : ticket.readHash,
    )
  )
    return reply({ error: "Sign-in unavailable" }, 403);
  if (body.action === "finish") {
    // Remove the ticket first so a concurrent callback cannot reopen a session.
    await store.delete(`ticket/${body.id}`);
    await store.delete(`result/${body.id}`);
    return reply({ done: true });
  }
  if (body.action === "status") {
    const result = await store.get(`result/${body.id}`, { type: "json" });
    return reply(result ? { state: "ready", ...result } : { state: "pending" });
  }
  if (
    body.failed !== true &&
    (typeof body.code !== "string" ||
      !/^[a-zA-Z0-9._~-]{16,2048}$/.test(body.code))
  )
    return reply({ error: "Invalid code" }, 400);
  if (
    body.flowId != null &&
    (typeof body.flowId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,256}$/.test(body.flowId))
  )
    return reply({ error: "Invalid flow" }, 400);
  const result: Result = {
    code: body.failed === true ? null : body.code,
    flowId: body.flowId ?? null,
    failed: body.failed === true,
    expiresAt: ticket.expiresAt,
  };
  const written = await store.setJSON(`result/${body.id}`, result, {
    onlyIfNew: true,
  });
  if (!written.modified) {
    const previous: Result | null = await store.get(`result/${body.id}`, {
      type: "json",
    });
    if (
      !previous ||
      previous.code !== result.code ||
      previous.flowId !== result.flowId ||
      previous.failed !== result.failed
    )
      return reply({ error: "Sign-in already returned" }, 409);
  }
  return reply({ done: true });
}

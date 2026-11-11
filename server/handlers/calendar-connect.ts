import {
  runtime,
  authorize,
  connect,
  json,
  failure,
} from "../calendar-runtime.js";
export default async (request: Request) => {
  try {
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    if (Number(request.headers.get("content-length") || 0) > 10000)
      return json({ error: "Request too large." }, 413);
    const body = await request.json(),
      rt = runtime();
    const { user } = await authorize(request, rt, body.workspace, true);
    return json(await connect(rt, body.workspace, user, body.refreshToken));
  } catch (e) {
    return failure(e);
  }
};

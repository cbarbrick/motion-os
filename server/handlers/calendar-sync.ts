import { runtime, authorize, drain, json, failure } from "../calendar-runtime.js";
export default async (request: Request) => {
  try {
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    const body = await request.json(),
      rt = runtime();
    await authorize(request, rt, body.workspace);
    return json(await drain(rt, body.workspace, 3));
  } catch (e) {
    return failure(e);
  }
};

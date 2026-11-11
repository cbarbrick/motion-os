import {
  runtime,
  authorize,
  readCalendar,
  json,
  failure,
} from "../calendar-runtime.js";
export default async (request: Request) => {
  try {
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    const body = await request.json(),
      rt = runtime();
    await authorize(request, rt, body.workspace);
    return json(await readCalendar(rt, body.workspace, body.start, body.end));
  } catch (e) {
    return failure(e);
  }
};

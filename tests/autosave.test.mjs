import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
const db = new PGlite();
const owner = "00000000-0000-4000-8000-000000000001",
  member = "00000000-0000-4000-8000-000000000002",
  outsider = "00000000-0000-4000-8000-000000000003";
await db.exec(
  `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;insert into auth.users values('${owner}','owner@example.test',now()),('${member}','member@example.test',now()),('${outsider}','outsider@example.test',now());create publication supabase_realtime;`,
);
const migrations = new URL("../supabase/migrations/", import.meta.url);
for (const name of (await readdir(migrations))
  .filter((f) => f.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(new URL(name, migrations), "utf8"));
async function as(user, query, params = [], role = "authenticated") {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    await tx.exec(`set local role ${role}`);
    return tx.query(query, params);
  });
}
const w = (
  await as(owner, "select public.create_workspace('Motion','Owner') as id")
).rows[0].id;
const token = (
  await as(owner, "select public.get_workspace_invite($1) as token", [w])
).rows[0].token;
await as(member, "select public.join_workspace($1,'Member')", [token]);
const save = async (user, request, entity, kind, id, version, input) =>
  (
    await as(
      user,
      "select public.save_record($1,$2,$3,$4,$5,$6,$7) as result",
      [w, request, entity, kind, id, version, input],
    )
  ).rows[0].result;
const source = await readFile(
  new URL("../src/pending-save.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { beginSave, readPendingSave, rejectedSave } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
test("a lost create response survives draft reload and edits without duplicating or dropping either version", async () => {
  const firstInput = {
    title: "Draft event",
    starts_at: "2026-11-12T15:00:00Z",
  };
  const pending = beginSave(null, firstInput);
  const first = await save(
    owner,
    pending.request,
    "item",
    "event",
    null,
    0,
    pending.input,
  );
  // The server committed, but the client did not receive that response.
  const restored = readPendingSave(JSON.parse(JSON.stringify(pending)));
  const latest = {
    ...firstInput,
    title: "Finished event",
    description: "Notes entered while saving",
  };
  const retry = beginSave(restored, latest);
  assert.deepEqual(retry.input, firstInput);
  const recovered = await save(
    owner,
    retry.request,
    "item",
    "event",
    null,
    0,
    retry.input,
  );
  assert.deepEqual(recovered, first);
  const next = beginSave(null, latest);
  const final = await save(
    owner,
    next.request,
    "item",
    "event",
    recovered.id,
    recovered.version,
    next.input,
  );
  assert.equal(final.id, first.id);
  assert.equal(final.title, latest.title);
  assert.equal(final.description, latest.description);
  assert.equal(
    (
      await as(
        member,
        "select count(*)::int as count from public.items where id=$1",
        [first.id],
      )
    ).rows[0].count,
    1,
  );
  const replay = await save(
    owner,
    next.request,
    "item",
    "event",
    recovered.id,
    recovered.version,
    next.input,
  );
  assert.equal(replay.version, final.version);
  assert.equal(
    (
      await as(member, "select version from public.items where id=$1", [
        first.id,
      ])
    ).rows[0].version,
    2,
  );
});
test("receipts preserve workspace access, private todos, payload identity and optimistic conflicts", async () => {
  const request = randomUUID(),
    input = { title: "Private notes" };
  const item = await save(owner, request, "item", "todo", null, 0, input);
  await assert.rejects(
    save(outsider, request, "item", "todo", null, 0, input),
    /Workspace access/,
  );
  await assert.rejects(
    save(owner, request, "item", "todo", null, 0, { title: "Changed request" }),
    /Save request changed/,
  );
  await assert.rejects(
    save(member, randomUUID(), "item", "todo", item.id, item.version, input),
    /Private to-do/,
  );
  assert.equal(
    (await as(member, "select * from public.items where id=$1", [item.id])).rows
      .length,
    0,
  );
  for (const role of ["anon", "authenticated"])
    await assert.rejects(
      as(owner, "select * from motion_private.save_receipts", [], role),
      /permission denied/,
    );
  await assert.rejects(
    as(
      owner,
      "select public.save_record($1,$2,$3,$4,null,0,$5)",
      [w, randomUUID(), "item", "task", { title: "Anonymous" }],
      "anon",
    ),
    /permission denied/,
  );
  const task = await save(owner, randomUUID(), "item", "task", null, 0, {
    title: "Shared",
  });
  const updated = await save(
    member,
    randomUUID(),
    "item",
    "task",
    task.id,
    task.version,
    { title: "Member edit" },
  );
  await assert.rejects(
    save(owner, randomUUID(), "item", "task", task.id, task.version, {
      title: "Stale edit",
    }),
    /changed/,
  );
  assert.equal(
    (await as(owner, "select title from public.items where id=$1", [task.id]))
      .rows[0].title,
    updated.title,
  );
});
test("a rejected validation can be corrected and a deleted record cannot be revived by replay", async () => {
  const request = randomUUID();
  await assert.rejects(
    save(owner, request, "item", "task", null, 0, { title: "" }),
  );
  const task = await save(owner, request, "item", "task", null, 0, {
    title: "Corrected",
  });
  await as(member, "select public.delete_item($1,$2,$3)", [
    w,
    task.id,
    task.version,
  ]);
  await assert.rejects(
    save(owner, request, "item", "task", null, 0, { title: "Corrected" }),
    /no longer available/,
  );
  assert.equal(rejectedSave({ code: "23514" }), true);
  assert.equal(rejectedSave({ code: "P0001" }), true);
  assert.equal(rejectedSave(new TypeError("Failed to fetch")), false);
  assert.equal(rejectedSave({ code: "", message: "Gateway timeout" }), false);
});
test("athlete creation and update retries also commit once", async () => {
  const request = randomUUID(),
    input = { athlete_name: "Sample athlete", record_type: "athlete" };
  const athlete = await save(
    owner,
    request,
    "sponsorship",
    null,
    null,
    0,
    input,
  );
  assert.deepEqual(
    await save(owner, request, "sponsorship", null, null, 0, input),
    athlete,
  );
  const next = randomUUID(),
    update = { ...input, proposal: "Added details" };
  const updated = await save(
    member,
    next,
    "sponsorship",
    null,
    athlete.id,
    athlete.version,
    update,
  );
  assert.equal(
    (
      await save(
        member,
        next,
        "sponsorship",
        null,
        athlete.id,
        athlete.version,
        update,
      )
    ).version,
    updated.version,
  );
  assert.equal(
    (
      await as(
        owner,
        "select count(*)::int as count from public.sponsorships where id=$1",
        [athlete.id],
      )
    ).rows[0].count,
    1,
  );
});
test("realtime publishes shared data while existing row policies remain enabled", async () => {
  const rows = (
    await db.query(
      "select tablename from pg_publication_tables where pubname='supabase_realtime'",
    )
  ).rows.map((r) => r.tablename);
  for (const table of [
    "notifications",
    "items",
    "sponsorships",
    "sponsorship_comments",
    "sponsorship_settings",
    "activity",
    "members",
  ]) {
    assert.ok(rows.includes(table), table);
    assert.equal(
      (
        await db.query(
          "select relrowsecurity from pg_class where oid=$1::regclass",
          ["public." + table],
        )
      ).rows[0].relrowsecurity,
      true,
    );
  }
  assert.ok(!rows.includes("save_receipts"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("all approval categories preserve reviewer authorization, history, isolation and roster separation", async () => {
  const db = new PGlite();
  const owner = "00000000-0000-4000-8000-000000000001";
  const member = "00000000-0000-4000-8000-000000000002";
  const outsider = "00000000-0000-4000-8000-000000000003";
  async function as(user, query, params = []) {
    return db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
        user,
      ]);
      await tx.exec("set local role authenticated");
      return tx.query(query, params);
    });
  }
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      insert into auth.users values('${owner}','owner@example.test',now()),('${member}','member@example.test',now()),('${outsider}','outsider@example.test',now());`);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    const names = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
    const target = names.find((n) => n.endsWith("_davids_approval_queue.sql"));
    for (const name of names.slice(0, names.indexOf(target)))
      await db.exec(await readFile(new URL(name, dir), "utf8"));
    const w = (
      await as(
        owner,
        "select public.create_workspace('Approval test','Owner') as id",
      )
    ).rows[0].id;
    const invite = (
      await as(owner, "select public.get_workspace_invite($1) as token", [w])
    ).rows[0].token;
    await as(member, "select public.join_workspace($1,'Teammate')", [invite]);
    const roster = (
      await as(member, "select * from public.save_sponsorship($1,null,0,$2)", [
        w,
        { athlete_name: "Existing roster athlete" },
      ])
    ).rows[0];
    const previous = (
      await as(member, "select * from public.save_sponsorship($1,null,0,$2)", [
        w,
        { record_type: "affiliate", athlete_name: "Existing affiliate" },
      ])
    ).rows[0];
    await db.exec(await readFile(new URL(target, dir), "utf8"));
    assert.deepEqual(
      (
        await as(owner, "select * from public.sponsorships where id=$1", [
          roster.id,
        ])
      ).rows[0],
      roster,
    );
    assert.deepEqual(
      (
        await as(owner, "select * from public.sponsorships where id=$1", [
          previous.id,
        ])
      ).rows[0],
      previous,
    );
    for (const record_type of [
      "athlete_proposal",
      "project",
      "person",
      "affiliate",
      "other",
    ]) {
      await as(owner, "select public.set_sponsorship_reviewer($1,null)", [w]);
      let item = (
        await as(
          member,
          "select * from public.save_sponsorship($1,null,0,$2)",
          [
            w,
            {
              record_type,
              athlete_name: `Request: ${record_type}`,
              proposal: "Decision requested",
              rate: "$500",
              profile_url: "https://example.com/brief",
            },
          ],
        )
      ).rows[0];
      assert.equal(item.status, "pending");
      assert.equal(item.created_by, member);
      await assert.rejects(
        as(owner, "select public.review_sponsorship($1,1,'approved','')", [
          item.id,
        ]),
        /selected sponsorship reviewer/,
      );
      await assert.rejects(
        as(outsider, "select public.save_sponsorship($1,null,0,$2)", [
          w,
          { record_type, athlete_name: "Unauthorized" },
        ]),
        /Workspace access/,
      );
      assert.equal(
        (
          await as(outsider, "select * from public.sponsorships where id=$1", [
            item.id,
          ])
        ).rows.length,
        0,
      );
      await assert.rejects(
        as(
          member,
          "update public.sponsorships set status='approved' where id=$1",
          [item.id],
        ),
        /permission denied/,
      );
      await as(owner, "select public.set_sponsorship_reviewer($1,$2)", [
        w,
        owner,
      ]);
      await assert.rejects(
        as(member, "select public.review_sponsorship($1,1,'approved','')", [
          item.id,
        ]),
        /selected sponsorship reviewer/,
      );
      item = (
        await as(
          owner,
          "select * from public.review_sponsorship($1,$2,'approved','Approved scope')",
          [item.id, item.version],
        )
      ).rows[0];
      assert.equal(item.decided_by, owner);
      assert.equal(item.status, "approved");
      await assert.rejects(
        as(member, "select public.save_sponsorship($1,$2,1,$3)", [
          w,
          item.id,
          { proposal: "Stale" },
        ]),
        /changed/,
      );
      item = (
        await as(member, "select * from public.save_sponsorship($1,$2,$3,$4)", [
          w,
          item.id,
          item.version,
          { rate: "$750" },
        ])
      ).rows[0];
      assert.equal(item.status, "pending");
      assert.equal(item.decided_by, null);
      item = (
        await as(
          owner,
          "select * from public.review_sponsorship($1,$2,'denied','Cost too high')",
          [item.id, item.version],
        )
      ).rows[0];
      item = (
        await as(
          owner,
          "select * from public.review_sponsorship($1,$2,'pending','Reopened')",
          [item.id, item.version],
        )
      ).rows[0];
      assert.equal(item.status, "pending");
      assert.equal(item.decided_at, null);
      const history = (
        await as(
          member,
          "select action from public.sponsorship_comments where sponsorship_id=$1",
          [item.id],
        )
      ).rows;
      assert.deepEqual(
        new Set(history.map((c) => c.action)),
        new Set(["approved", "updated", "denied", "pending"]),
      );
      await assert.rejects(
        as(member, "select public.save_item($1,'event',null,0,$2)", [
          w,
          {
            title: "Invalid roster link",
            athlete_id: item.id,
            starts_at: "2026-12-01T12:00:00Z",
          },
        ]),
        /Choose an athlete/,
      );
      await assert.rejects(
        as(member, "select public.save_sponsorship($1,$2,$3,$4)", [
          w,
          item.id,
          item.version,
          { record_type: "athlete" },
        ]),
        /Record type cannot change/,
      );
    }
    assert.equal(
      (
        await as(
          member,
          "select * from public.sponsorships where record_type='athlete'",
          [],
        )
      ).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});

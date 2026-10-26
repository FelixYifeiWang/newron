import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import {
  sanitizeSetupReport,
  sanitizeUserReport,
  storeSetupReport,
  storeUserReport,
} from "../lib/setup-diagnostics.mjs";
test("diagnostics redact credentials, private links, paths and emails and bound evidence", () => {
  const report = sanitizeSetupReport({
    reporter: "agent",
    stage: "download",
    evidence:
      "https://newron.app/setup.md#" +
      "a".repeat(64) +
      " sk-proj-abcdefghijk person@example.com /Users/alice/project/.env Bearer abcdefghijklmnop",
    rootCause: "unknown",
    confidence: "unknown",
    suggestedFix: "x".repeat(12000),
    environment: "macOS",
  });
  const text = JSON.stringify(report);
  for (const secret of [
    "a".repeat(64),
    "abcdefghijk",
    "person@example.com",
    "/Users/alice",
    "abcdefghijklmnop",
  ])
    assert.ok(!text.includes(secret));
  assert.ok(report.suggestedFix.length <= 2000);
  assert.throws(() => sanitizeSetupReport({ reporter: "other" }));
});
test("reports require a live setup code, remain bounded and never consume pairing", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const f of readdirSync("drizzle")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      db.exec(readFileSync("drizzle/" + f, "utf8"));
    const adapter = {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              run: async () => ({
                meta: { changes: Number(db.prepare(sql).run(...args).changes) },
              }),
            };
          },
        };
      },
    };
    db.prepare(
      "INSERT INTO pairing_codes(code_hash,owner_id,expires_at) VALUES(?,?,?)",
    ).run("hash", "owner", 1000);
    const report = sanitizeSetupReport({
      reporter: "agent",
      stage: "download",
      evidence: "ENOTFOUND",
      rootCause: "unknown",
      confidence: "unknown",
    });
    assert.equal(
      await storeSetupReport(adapter, "missing", report, 500),
      false,
    );
    assert.equal(await storeSetupReport(adapter, "hash", report, 1000), false);
    assert.equal(await storeSetupReport(adapter, "hash", report, 500), true);
    assert.equal(await storeSetupReport(adapter, "hash", report, 501), true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM setup_reports").get().n, 1);
    assert.equal(
      db.prepare("SELECT claim_id FROM pairing_codes").get().claim_id,
      null,
    );
    assert.equal(
      db.prepare("SELECT owner_id FROM setup_reports").get().owner_id,
      "owner",
    );
  } finally {
    db.close();
  }
});

const memoryDb = () => {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync("drizzle/" + f, "utf8"));
  const adapter = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            run: async () => ({
              meta: { changes: Number(db.prepare(sql).run(...args).changes) },
            }),
          };
        },
      };
    },
  };
  return { db, adapter };
};

test("a user's problem report keeps what happened and redacts secrets, paths and emails", () => {
  const report = sanitizeUserReport({
    stage: "nox",
    note: "Clicking Nox does nothing. Reach me at person@example.com",
    error:
      "ENOENT /Users/alice/Library/x Bearer abcdefghijklmnop " +
      "e".repeat(9000),
    nox: {
      release: "abc",
      lastError: "sk-proj-abcdefghijk at /Users/alice/code",
    },
    environment: "Mozilla/5.0 (Macintosh)",
  });
  const text = JSON.stringify(report);
  for (const secret of [
    "person@example.com",
    "/Users/alice",
    "abcdefghijklmnop",
    "abcdefghijk",
  ])
    assert.ok(!text.includes(secret), secret);
  assert.equal(report.reporter, "user");
  assert.equal(report.stage, "nox");
  assert.match(report.note, /Clicking Nox does nothing/);
  assert.ok(report.error.length <= 4000);
  assert.equal(
    sanitizeUserReport({ note: "It broke", stage: "else" }).stage,
    "other",
  );
  assert.throws(() => sanitizeUserReport({ note: " " }), /what happened/);
});

test("user reports are stored privately with the owner, at most ten a day, and kept 30 days", async () => {
  const { db, adapter } = memoryDb();
  try {
    const report = sanitizeUserReport({ note: "Nox won't connect" });
    const day = 24 * 60 * 60 * 1000;
    for (let i = 0; i < 10; i++)
      assert.equal(
        await storeUserReport(adapter, "owner", `r${i}`, report, 1000 + i),
        true,
      );
    assert.equal(
      await storeUserReport(adapter, "owner", "r10", report, 2000),
      false,
    );
    assert.equal(
      await storeUserReport(adapter, "other", "o1", report, 2000),
      true,
    );
    const row = db
      .prepare(
        "SELECT owner_id, reporter FROM setup_reports WHERE code_hash='user:o1'",
      )
      .get();
    assert.deepEqual({ ...row }, { owner_id: "other", reporter: "user" });
    // A day later the owner can report again; a month later old reports are gone.
    assert.equal(
      await storeUserReport(adapter, "owner", "r11", report, 1000 + day + 10),
      true,
    );
    await storeUserReport(adapter, "third", "t1", report, 1000 + 31 * day);
    assert.deepEqual(
      db
        .prepare("SELECT code_hash FROM setup_reports ORDER BY code_hash")
        .all()
        .map((r) => r.code_hash),
      ["user:r11", "user:t1"],
    );
  } finally {
    db.close();
  }
});

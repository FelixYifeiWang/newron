import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVisibilityDiagnostics } from "../desktop/visibility-diagnostics.mjs";
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "nox-diagnostics-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "visibility-diagnostics.json");
}
test("a real check error survives normal switching and a process restart", async (t) => {
  const file = await fixture(t),
    log = await createVisibilityDiagnostics(file);
  log.record({
    event: "check",
    reason: "session-check-failed",
    error: "navigation unavailable",
    totalMs: 12000,
  });
  for (let i = 0; i < 250; i++)
    log.record({
      event: "check",
      reason: i % 2 ? "session-resolved" : "unsupported-app",
      visible: !!(i % 2),
    });
  await log.flush();
  const next = await createVisibilityDiagnostics(file);
  next.record({ event: "startup", pid: 22 });
  await next.flush();
  const data = JSON.parse(await readFile(file, "utf8"));
  assert.equal(data.problems[0].error, "navigation unavailable");
  assert.ok(data.recent.length <= 128);
  assert.ok(data.problems.length <= 32);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});
test("only bounded diagnostic fields are saved and secrets are redacted", async (t) => {
  const file = await fixture(t),
    log = await createVisibilityDiagnostics(file);
  log.record({
    event: "check",
    reason: "window-check-failed",
    error:
      "sk-proj-abcdefghijk " +
      "a".repeat(64) +
      " Bearer secret123 /Users/alice/project https://x.test/?token=hello alice@example.com",
    transcript: "PRIVATE",
    target: { bundleId: "codex", pid: 5, title: "PRIVATE", token: "PRIVATE" },
    state: { opacity: 0, actualVisible: false, token: "PRIVATE" },
  });
  for (let i = 0; i < 60; i++)
    log.record({ event: "renderer-gone", error: "x".repeat(10000) });
  await log.flush();
  const raw = await readFile(file, "utf8");
  assert.ok(!raw.includes("PRIVATE"));
  assert.ok(!raw.includes("abcdefghijk"));
  assert.ok(!raw.includes("secret123"));
  assert.ok(!raw.includes("alice"));
  assert.ok(!raw.includes("token=hello"));
  assert.ok(Buffer.byteLength(raw) < 150000);
});
test("a damaged previous log reports the problem and cannot break startup", async (t) => {
  const file = await fixture(t);
  await writeFile(file, "broken");
  let reported = false;
  const log = await createVisibilityDiagnostics(file, {
    onError: () => (reported = true),
  });
  log.record({ event: "startup" });
  await log.flush();
  assert.equal(reported, true);
  assert.equal(
    JSON.parse(await readFile(file, "utf8")).recent[0].event,
    "startup",
  );
});

test("upgrade retains old errors and renderer failures survive later healthy events", async (t) => {
  const file = await fixture(t);
  await writeFile(
    file,
    JSON.stringify([
      {
        at: "2026-10-25T00:00:00Z",
        reason: "session-check-failed",
        error: "old failure",
      },
    ]),
  );
  const log = await createVisibilityDiagnostics(file);
  log.record({ event: "renderer-gone", reason: "crashed", exitCode: 9 });
  for (let i = 0; i < 150; i++)
    log.record({ event: "check", reason: "session-resolved" });
  await log.flush();
  const data = JSON.parse(await readFile(file, "utf8"));
  assert.equal(data.problems[0].error, "old failure");
  assert.equal(data.problems[1].reason, "crashed");
});

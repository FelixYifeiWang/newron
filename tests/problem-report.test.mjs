import test from "node:test";
import assert from "node:assert/strict";
import { noxReport, reportLink } from "../desktop/problem-report.mjs";
import { readNoxDetails } from "../lib/problem-report.mjs";

const facts = {
  release: "24e5c745",
  version: "0.1.0",
  os: "macOS 15.5",
  arch: "arm64",
  paired: false,
  setupPending: false,
  status: "waiting",
  lastError: "Could not inspect the window.",
  hint: "Move Nox onto a Codex chat or the Claude app's Code tab.",
  subscriptions: [
    {
      title: "My secret project",
      file: "/Users/alice/.claude/projects/x.jsonl",
      provider: "Claude Code",
      mode: "follow",
      paused: false,
      done: false,
      error: "",
    },
  ],
  problems: [
    { at: "2026-10-25T10:00:00Z", event: "check-stalled", stage: "inspect" },
  ],
};

test("Nox attaches only explicit facts: no session titles, transcript paths or keys", () => {
  const report = noxReport(facts);
  const text = JSON.stringify(report);
  assert.ok(!text.includes("My secret project"));
  assert.ok(!text.includes("x.jsonl"));
  assert.equal(report.paired, false);
  assert.equal(report.sessions[0].provider, "Claude Code");
  assert.equal(report.problems.length, 1);
});

test("the report link carries Nox's details in the fragment, never the query, and stays short", () => {
  const many = noxReport({
    ...facts,
    problems: Array.from({ length: 32 }, (_, i) => ({
      at: "2026-10-25T10:00:00Z",
      event: "check-stalled",
      error: "x".repeat(400) + i,
    })),
  });
  const link = reportLink("https://newron.app", many);
  const url = new URL(link);
  assert.equal(url.origin + url.pathname, "https://newron.app/report");
  assert.equal(url.search, "");
  assert.ok(link.length <= 8000, `${link.length}`);
  const back = readNoxDetails(url.hash);
  assert.equal(back.release, "24e5c745");
  assert.ok(back.problems.length < 32, "drops the oldest problems to fit");
  assert.equal(
    back.problems.at(-1).error.endsWith("31"),
    true,
    "keeps the newest",
  );
  assert.equal(readNoxDetails("#nox=%%%"), null);
  assert.equal(readNoxDetails(""), null);
});

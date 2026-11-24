import test from "node:test";
import assert from "node:assert/strict";
import { resolveTarget } from "../desktop/target.mjs";
const sessions = [
  {
    sessionId: "11111111-1111-4111-8111-111111111111",
    title: "Define AI idea collaboration space",
    file: "/safe/a.jsonl",
    provider: "Codex",
  },
  {
    sessionId: "22222222-2222-4222-8222-222222222222",
    title: "Review portfolio",
    file: "/safe/b.jsonl",
    provider: "Codex",
  },
];
const target = (text, extra = {}) => ({
  bundleId: "com.openai.codex",
  labels: [text],
  ...extra,
});
test("drop on an exact title resolves without a picker", () => {
  assert.equal(
    resolveTarget(target(sessions[0].title), sessions).sessionId,
    sessions[0].sessionId,
  );
});
test("a session URL resolves an otherwise ambiguous label", () => {
  assert.equal(
    resolveTarget(
      target("Conversation", {
        urls: ["codex://threads/" + sessions[1].sessionId],
      }),
      sessions,
    ).sessionId,
    sessions[1].sessionId,
  );
});
test("a duplicate title is rejected instead of guessing the newest session", () => {
  assert.throws(
    () =>
      resolveTarget(target(sessions[0].title), [
        ...sessions,
        { ...sessions[1], title: sessions[0].title },
      ]),
    /ambiguous/i,
  );
});
test("unrelated text does not match a session", () => {
  assert.throws(() => resolveTarget(target("Recents"), sessions), /title/i);
});
test("other applications cannot trigger a subscription using coincidentally matching text", () => {
  assert.throws(
    () =>
      resolveTarget(
        target(sessions[0].title, { bundleId: "com.apple.Safari" }),
        sessions,
      ),
    /Codex/i,
  );
});
test("truncated labels do not auto-connect a guessed session", () => {
  assert.throws(
    () => resolveTarget(target("Define AI idea collaborat…"), sessions),
    /title/i,
  );
});
test("conflicting identifiers fail closed", () => {
  assert.throws(
    () =>
      resolveTarget(
        target("Conversation", {
          urls: sessions.map((s) => "codex://threads/" + s.sessionId),
        }),
        sessions,
      ),
    /ambiguous/i,
  );
});
test("a targeted sidebar row takes precedence over the open window title", () => {
  assert.equal(
    resolveTarget(
      target(sessions[1].title, { windowLabels: [sessions[0].title] }),
      sessions,
    ).sessionId,
    sessions[1].sessionId,
  );
});
test("an unresolved row never falls back to a different open conversation", () => {
  assert.throws(
    () =>
      resolveTarget(
        target("Missing conversation", { windowLabels: [sessions[0].title] }),
        sessions,
      ),
    /title/i,
  );
});

import { createDragController } from "../desktop/drag.mjs";
import { confineTranscript } from "../desktop/target.mjs";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("a symlink cannot turn a session target into an arbitrary file read", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "commonplace-path-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "sessions"));
  await writeFile(join(dir, "private.jsonl"), "private");
  await symlink(
    join(dir, "private.jsonl"),
    join(dir, "sessions", "escape.jsonl"),
  );
  await assert.rejects(
    confineTranscript(join(dir, "sessions", "escape.jsonl"), dir),
    /outside/,
  );
});
function dragFixture() {
  let point = { x: 10, y: 10 };
  const events = [];
  let bounds = { x: 0, y: 0, width: 100, height: 100 };
  const window = {
    getBounds: () => ({ ...bounds }),
    setPosition: (x, y) => {
      bounds = { ...bounds, x, y };
    },
    setBounds: (value) => {
      bounds = { ...value };
      events.push("restore");
    },
    hide: () => events.push("hide"),
    showInactive: () => events.push("show"),
  };
  return {
    events,
    move: () => {
      point = { x: 200, y: 200 };
    },
    args: {
      window,
      cursor: () => point,
      every: () => 1,
      stop: () => {},
      inspect: async () => {
        events.push("inspect");
        return target(sessions[0].title);
      },
      resolve: async (input) => resolveTarget(input, sessions),
      subscribe: async () => events.push("subscribe"),
      report: (state) => events.push(state.state),
    },
  };
}
test("a drag over Codex only moves and never inspects or subscribes", async () => {
  const f = dragFixture(),
    d = createDragController(f.args);
  d.start();
  f.move();
  const result = await d.end();
  assert.deepEqual(result, { click: false, moved: true });
  assert.deepEqual(f.events, []);
  assert.equal(f.args.window.getBounds().x, 190);
});
test("clicking the buddy does not subscribe", async () => {
  const f = dragFixture(),
    d = createDragController(f.args);
  d.start();
  assert.deepEqual(await d.end(), { click: true });
  assert.deepEqual(f.events, []);
});
test("a fast drag applies its final cursor delta without a timer tick", async () => {
  const f = dragFixture(),
    d = createDragController(f.args);
  d.start();
  f.move();
  await d.end();
  assert.equal(f.args.window.getBounds().y, 190);
});
test("pointer-down origin is retained across IPC delay", async () => {
  const f = dragFixture(),
    d = createDragController(f.args);
  f.move();
  d.start({ offset: { x: 100, y: 100 } });
  await d.end();
  assert.equal(f.args.window.getBounds().x, 100);
});
test("cancel restores the original position", () => {
  const f = dragFixture(),
    d = createDragController(f.args);
  d.start();
  f.move();
  d.cancel({ restore: true });
  assert.equal(d.isDragging(), false);
});

import { resolveFollowedTranscript } from "../desktop/target.mjs";
test("a followed Codex session follows its stable ID to a rotated transcript", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "newron-rotation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "sessions"));
  const id = sessions[0].sessionId;
  const original = join(
    root,
    "sessions",
    `rollout-2026-10-17T12-00-00-${id}.jsonl`,
  );
  const current = join(
    root,
    "sessions",
    `rollout-2026-10-18T12-00-00-${id}_new.jsonl`,
  );
  await writeFile(original, "");
  await writeFile(current, "");
  const subscription = { provider: "Codex", file: original };
  const result = await resolveFollowedTranscript(subscription, {
    codexHome: root,
    metadata: async () => [
      { ...sessions[0], file: current },
      { ...sessions[1], title: sessions[0].title },
    ],
  });
  assert.deepEqual(result, {
    file: await realpath(current),
    sessionId: id,
    files: [await realpath(current)],
  });
  assert.equal(subscription.file, original);
});
test("a missing subscribed ID never follows a matching title", async () => {
  await assert.rejects(
    resolveFollowedTranscript(
      {
        provider: "Codex",
        sessionId: sessions[0].sessionId,
        file: "/old.jsonl",
      },
      {
        metadata: async () => [{ ...sessions[1], title: sessions[0].title }],
      },
    ),
    /session.*unavailable/i,
  );
});
test("non-Codex sources retain their existing transcript", async () => {
  assert.deepEqual(
    await resolveFollowedTranscript({
      provider: "Claude Code",
      file: "/claude.jsonl",
    }),
    { file: "/claude.jsonl" },
  );
});

test("a missing indexed Codex file recovers only verified same-ID archived history", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nox-missing-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "archived_sessions"));
  const id = sessions[0].sessionId;
  const archive = join(
    root,
    "archived_sessions",
    `rollout-2026-01-01-${id}.jsonl`,
  );
  await writeFile(
    archive,
    JSON.stringify({ type: "session_meta", payload: { id } }) + "\n",
  );
  const result = await resolveFollowedTranscript(
    { provider: "Codex", sessionId: id },
    {
      codexHome: root,
      metadata: async () => [
        { ...sessions[0], file: join(root, "sessions", "missing.jsonl") },
      ],
    },
  );
  assert.equal(result.file, await realpath(archive));
  assert.deepEqual(result.files, [await realpath(archive)]);
});
test("an indexed session without surviving history has a concise retryable error", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nox-no-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "sessions"));
  const id = sessions[0].sessionId;
  for (const [suffix, payload] of [
    ["wrong", { id: sessions[1].sessionId }],
    ["helper", { id, source: { subagent: {} } }],
  ])
    await writeFile(
      join(root, "sessions", `rollout-2026-01-01-${id}_${suffix}.jsonl`),
      JSON.stringify({ type: "session_meta", payload }) + "\n",
    );
  await assert.rejects(
    resolveFollowedTranscript(
      { provider: "Codex", sessionId: id },
      {
        codexHome: root,
        metadata: async () => [
          { ...sessions[0], file: join(root, "sessions", "missing.jsonl") },
        ],
      },
    ),
    {
      code: "LOCAL_TRANSCRIPT_UNAVAILABLE",
      message:
        "Local history is missing. Open this session in Codex, then try again.",
    },
  );
});

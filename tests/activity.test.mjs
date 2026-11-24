import test from "node:test";
import assert from "node:assert/strict";
import {
  activeConversation,
  readOpenConversation,
} from "../desktop/activity.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const at = Date.parse("2026-10-17T12:00:00.000Z");
const event = (id, fields = "", time = at) =>
  `${new Date(time).toISOString()} info [electron-message-handler] thread_stream_view_activity_changed active=true conversationId=${id} rendererWindowAppearance=primary rendererWindowId=1 rendererWindowVisible=true ${fields}`;
test("navigation selects the newly opened conversation", () => {
  assert.equal(
    activeConversation(
      [event(a), event(a, "active=false"), event(b)].join("\n"),
    ),
    b,
  );
});
test("a closed conversation is never chosen from past activity", () => {
  assert.throws(
    () => activeConversation(event(a) + "\n" + event(a, "active=false")),
    /Open the conversation/,
  );
});
test("events from a previous app process lifetime are ignored", () => {
  assert.throws(
    () => activeConversation(event(a), at + 1),
    /Open the conversation/,
  );
});
test("a background view cannot replace the primary conversation", () => {
  assert.equal(
    activeConversation(
      event(a) + "\n" + event(b, "rendererWindowAppearance=popout"),
    ),
    a,
  );
});
test("multiple active conversations fail instead of choosing the newest", () => {
  assert.throws(
    () => activeConversation(event(a) + "\n" + event(b, "rendererWindowId=2")),
    /More than one/,
  );
});
test("out-of-order close for another conversation does not clear the open view", () => {
  assert.equal(
    activeConversation(event(b) + "\n" + event(a, "active=false")),
    b,
  );
});
const target = {
  bundleId: "com.openai.codex",
  pid: 123,
  launchedAt: at,
  windowCount: 1,
  bounds: { x: 0, y: 0, width: 1000, height: 800 },
  point: { x: 600, y: 300 },
};
test("a drop in the sidebar cannot subscribe to a different open conversation", async () => {
  await assert.rejects(
    readOpenConversation({ ...target, point: { x: 100, y: 300 } }),
    /Open that session first/,
  );
});
test("multiple windows are not resolved by recent activity", async () => {
  await assert.rejects(
    readOpenConversation({ ...target, windowCount: 2 }),
    /one Codex window/,
  );
});
test("only the current process navigation logs determine the session", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "commonplace-activity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "codex-desktop-test-123-t0-i1.log"), event(a));
  await writeFile(join(root, "codex-desktop-test-456-t0-i1.log"), event(b));
  assert.equal(await readOpenConversation(target, root), a);
});
test("an unsupported app never falls back to Codex", async () => {
  await assert.rejects(
    readOpenConversation({ ...target, bundleId: "com.apple.Safari" }),
    /not supported/,
  );
});

test("a hidden conversation is not a drop target", () => {
  assert.throws(
    () =>
      activeConversation(
        event(a) + "\n" + event(a, "rendererWindowVisible=false"),
      ),
    /Open the conversation/,
  );
});

const route = (id, time = at) =>
  `${new Date(time).toISOString()} info [electron-message-handler] IAB_LIFECYCLE received browser sidebar owner sync ownerRoutePath=/local/${id} windowId=1`;
const helper = (id, time = at) =>
  `${new Date(time).toISOString()} info [electron-message-handler] IAB_LIFECYCLE received browser use session route capture conversationId=${id} windowId=1`;

test("an unindexed browser helper cannot replace the still-visible indexed task", () => {
  const raw = [route(a), event(a), helper(b), event(b)].join("\n");
  assert.equal(activeConversation(raw, 0, new Set([a])), a);
});

test("real navigation to an unindexed task does not fall back to the previous task", () => {
  const raw = [
    route(a),
    event(a),
    event(a, "active=false"),
    route(b),
    helper(b),
    event(b),
  ].join("\n");
  assert.equal(activeConversation(raw, 0, new Set([a])), b);
});

test("indexed tasks remain selectable even when browser routes lag behind", () => {
  const raw = [route(a), event(a), helper(b), event(b)].join("\n");
  assert.equal(activeConversation(raw, 0, new Set([a, b])), b);
});

test("helper detection requires a corroborating visible route", () => {
  assert.equal(
    activeConversation(
      [event(a), helper(b), event(b)].join("\n"),
      0,
      new Set([a]),
    ),
    b,
  );
});

test("closing the real task still clears it after helper activity", () => {
  assert.throws(
    () =>
      activeConversation(
        [
          route(a),
          event(a),
          helper(b),
          event(b),
          event(a, "active=false"),
        ].join("\n"),
        0,
        new Set([a]),
      ),
    /Open the conversation/,
  );
});

test("large navigation logs still resolve the current session", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "newron-large-activity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "codex-desktop-test-123-t0-i1.log"),
    "irrelevant diagnostic output\n".repeat(1300000) + event(a) + "\n",
  );
  await writeFile(
    join(root, "codex-desktop-test-123-t0-i2.log"),
    event(b, "", at + 1000),
  );
  assert.equal(await readOpenConversation(target, root), b);
});

// Reproduces the captured live sequence: navigation emitted only an owner-route
// update; a later browser helper advertised itself as the primary thread.
test("owner-route navigation updates the active task before an unindexed browser helper arrives", () => {
  const c = "33333333-3333-4333-8333-333333333333";
  const raw = [event(a), route(a), route(b), helper(c), event(c)].join("\n");
  assert.equal(activeConversation(raw, 0, new Set([a, b])), b);
});
test("a current owner-route corrects a helper that already displaced an older task", () => {
  const c = "33333333-3333-4333-8333-333333333333";
  const raw = [event(a), route(a), helper(c), event(c), route(b)].join("\n");
  assert.equal(activeConversation(raw, 0, new Set([a, b])), b);
});
test("closing the routed task still clears it and cannot reconnect its previous task", () => {
  const raw = [event(a), route(a), route(b), event(b, "active=false")].join(
    "\n",
  );
  assert.throws(
    () => activeConversation(raw, 0, new Set([a, b])),
    /Open the conversation/,
  );
});

const modern = (id, active = true, time = at) =>
  `${new Date(time).toISOString()} info [host-app-server-manager] thread_stream_view_activity_changed active=${active} conversationId=${id} resumeState=needs_resume streamRole=null`;
const windowContext = (
  window = "1",
  visible = true,
  appearance = "primary",
  time = at,
) =>
  `${new Date(time).toISOString()} warning [electron-message-handler] chatgpt_pubsub_transport_closed rendererWindowId=${window} rendererWindowAppearance=${appearance} rendererWindowVisible=${visible}`;
test("modern global activity resolves only the explicit visible owner route, ignoring auxiliary tasks", () => {
  const raw = [windowContext(), route(a), modern(a), helper(b), modern(b)].join(
    "\n",
  );
  assert.equal(activeConversation(raw, 0, new Set([a])), a);
});
test("modern owner-route navigation changes the selected conversation without scoped activity", () => {
  assert.equal(
    activeConversation(
      [windowContext(), route(a), modern(a), route(b)].join("\n"),
      0,
      new Set([a, b]),
    ),
    b,
  );
});
test("modern activity without visible primary ownership cannot pick the latest thread", () => {
  for (const raw of [
    modern(a),
    [route(a), modern(a)].join("\n"),
    [windowContext(), modern(a)].join("\n"),
    [windowContext("1", false), route(a), modern(a)].join("\n"),
  ])
    assert.throws(
      () => activeConversation(raw, 0, new Set([a])),
      /conversation|window|session/i,
    );
});
test("modern multiple visible primary windows are rejected even if the most recent one is known", () => {
  const raw = [
    windowContext(),
    route(a),
    windowContext("2"),
    route(b).replace("windowId=1", "windowId=2"),
    modern(b),
  ].join("\n");
  assert.throws(
    () => activeConversation(raw, 0, new Set([a, b])),
    /More than one/,
  );
});
test("modern home, cloud and unindexed routes never fall back to a known session", () => {
  for (const path of ["/", "/chat/cloud-id", "/local/" + b]) {
    const raw = [
      windowContext(),
      route(a),
      modern(a),
      route(a).replace("/local/" + a, path),
    ].join("\n");
    assert.throws(
      () => activeConversation(raw, 0, new Set([a])),
      /conversation|session/i,
    );
  }
});
test("modern background windows and late global activity cannot revive a closed legacy view", () => {
  assert.throws(
    () =>
      activeConversation(
        [windowContext("1", true, "popout"), route(a), modern(a)].join("\n"),
        0,
        new Set([a]),
      ),
    /conversation|window/i,
  );
  assert.throws(
    () =>
      activeConversation(
        [event(a), route(a), event(a, "active=false"), modern(a)].join("\n"),
        0,
        new Set([a]),
      ),
    /conversation|window/i,
  );
});
test("modern metadata is read from normal window telemetry with a nested popup present", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "nox-modern-reader-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "codex-desktop-test-123-t0-i1.log"),
    [windowContext(), route(a), modern(a), modern(b), route(a)].join("\n"),
  );
  const bounds = { x: 0, y: 0, width: 1000, height: 800 };
  const result = await readOpenConversation(
    {
      ...target,
      bounds,
      windowCount: 2,
      windowBounds: [bounds, { x: 300, y: 100, width: 400, height: 178 }],
    },
    root,
    new Set([a, b]),
  );
  assert.equal(result, a);
});
test("a newer unrelated global activation blocks a stale owner route instead of connecting the old session", () => {
  for (const id of [a, b]) {
    const raw = [
      windowContext(),
      route(a),
      modern(id === a ? b : a),
      modern(b),
    ].join("\n");
    assert.throws(
      () => activeConversation(raw, 0, new Set([a, b])),
      /changed|wait|session/i,
    );
  }
});
test("an unannounced unknown task cannot borrow the previous visible route", () => {
  assert.throws(
    () =>
      activeConversation(
        [windowContext(), route(a), modern(b)].join("\n"),
        0,
        new Set([a]),
      ),
    /changed|wait|session/i,
  );
});
test("a refreshed owner route settles navigation even after background global events", () => {
  assert.equal(
    activeConversation(
      [windowContext(), route(a), modern(b), route(a)].join("\n"),
      0,
      new Set([a, b]),
    ),
    a,
  );
});
test("ordinary window telemetry cannot select a different session even when it includes active fields", () => {
  const fake = event(b).replace(
    "thread_stream_view_activity_changed",
    "unrelated_window_telemetry",
  );
  const raw = [windowContext(), route(a), modern(a), fake].join("\n");
  assert.equal(activeConversation(raw, 0, new Set([a, b])), a);
});

import { createNavigationCache } from "../desktop/activity.mjs";
const fileInfo = { dev: 1, ino: 2, size: 30, mtimeMs: 10, ctimeMs: 10 };
test("unchanged navigation files share one parsed read, including concurrent lookups", async () => {
  let reads = 0;
  const cached = createNavigationCache(async () => {
    reads++;
    return [event(a)];
  });
  const results = await Promise.all([
    cached("file", fileInfo),
    cached("file", fileInfo),
  ]);
  assert.equal(reads, 1);
  assert.deepEqual(results, [[event(a)], [event(a)]]);
  await cached("file", { ...fileInfo });
  assert.equal(reads, 1);
});
test("appends, truncation, replacement and permission changes invalidate navigation parsing", async () => {
  for (const change of [
    { size: 31 },
    { size: 0 },
    { ino: 3 },
    { mtimeMs: 11 },
    { ctimeMs: 11 },
    { dev: 2 },
  ]) {
    let reads = 0;
    const cached = createNavigationCache(async () => [
      ++reads === 1 ? event(a) : event(b),
    ]);
    await cached("file", fileInfo);
    assert.deepEqual(await cached("file", { ...fileInfo, ...change }), [
      event(b),
    ]);
  }
});
test("failed reads are retried instead of caching an unavailable navigation file", async () => {
  let reads = 0;
  const cached = createNavigationCache(async () => {
    if (++reads === 1) throw new Error("unavailable");
    return [event(a)];
  });
  await assert.rejects(cached("file", fileInfo), /unavailable/);
  assert.deepEqual(await cached("file", fileInfo), [event(a)]);
});
test("navigation cache is bounded and rereads an evicted log", async () => {
  let reads = 0;
  const cached = createNavigationCache(async () => {
    reads++;
    return [];
  });
  for (let i = 0; i <= 128; i++) await cached(String(i), fileInfo);
  await cached("0", fileInfo);
  assert.equal(reads, 130);
});

test("a warmed real navigation reader sees switches, truncation and deleted logs immediately", async (t) => {
  const { appendFile } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "nox-navigation-fresh-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "codex-123-t0-main.log");
  await writeFile(file, event(a) + "\n");
  assert.equal(await readOpenConversation(target, root), a);
  assert.equal(await readOpenConversation(target, root), a);
  await appendFile(
    file,
    event(a, "active=false", at + 1) + "\n" + event(b, "", at + 2) + "\n",
  );
  assert.equal(await readOpenConversation(target, root), b);
  await writeFile(file, event(b, "active=false", at + 3) + "\n");
  await assert.rejects(
    readOpenConversation(target, root),
    /Open the conversation/,
  );
  await rm(file);
  await assert.rejects(
    readOpenConversation(target, root),
    /no readable navigation/,
  );
});
test("default navigation cache retains only allowed event fields", async (t) => {
  const { stat } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "nox-navigation-fields-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "log");
  await writeFile(
    file,
    event(a, "consolePayload=PRIVATE_TEXT token=PRIVATE_KEY") +
      "\nunrelated PRIVATE_BODY\n",
  );
  const cached = createNavigationCache();
  const rows = await cached(file, await stat(file));
  assert.equal(rows.length, 1);
  assert.equal(rows.join("").includes("PRIVATE"), false);
  assert.equal(activeConversation(rows.join("\n"), at), a);
});

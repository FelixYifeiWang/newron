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

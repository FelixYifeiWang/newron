import test from "node:test";
import assert from "node:assert/strict";
import { buddyBounds } from "../desktop/drag.mjs";
import {
  connectSession,
  placementHint,
  showsControls,
} from "../desktop/connect.mjs";
test("expanding near an edge keeps the buddy anchor fixed", () => {
  const anchor = { x: 900, y: 740 },
    area = { x: 0, y: 0, width: 1024, height: 800 },
    layout = buddyBounds(anchor, area, true);
  assert.equal(layout.bounds.x, anchor.x);
  assert.equal(layout.bounds.y + layout.offsetY, anchor.y);
  assert.equal(layout.bounds.height, 166);
});
test("explicit connection reports success only after capture", async () => {
  const events = [];
  const r = await connectSession({
    point: { x: 1, y: 2 },
    inspect: async () => ({ bundleId: "com.openai.codex" }),
    resolve: async () => ({ title: "Session" }),
    subscribe: async () => events.push("subscribe"),
    capture: async () => events.push("capture"),
    report: (v) => events.push(v.state),
  });
  assert.deepEqual(events, [
    "connecting",
    "subscribe",
    "collecting",
    "capture",
    "following",
  ]);
  assert.equal(r.connected, true);
});
test("failed capture never reports Connected", async () => {
  const states = [];
  const r = await connectSession({
    inspect: async () => ({ bundleId: "com.openai.codex" }),
    resolve: async () => ({ title: "Session" }),
    subscribe: async () => ({}),
    capture: async () => {
      throw new Error("Offline");
    },
    report: (v) => states.push(v.state),
  });
  assert.equal(r.connected, false);
  assert.equal(states.includes("following"), false);
});
test("unsupported target cannot connect", async () => {
  let called = false;
  await connectSession({
    inspect: async () => ({ bundleId: "com.apple.Safari" }),
    subscribe: async () => {
      called = true;
    },
    report: () => {},
  });
  assert.equal(called, false);
});

test("restored connection reports recovery before capture and resumes only after success", async () => {
  const events = [];
  await connectSession({
    inspect: async () => ({ bundleId: "com.openai.codex" }),
    resolve: async () => ({ title: "Session" }),
    subscribe: async () => ({ restored: true }),
    capture: async () => events.push({ state: "capture" }),
    report: (v) => events.push(v),
  });
  assert.equal(
    events.find((v) => v.state === "collecting").message,
    "Collection restored. Catching up…",
  );
  assert.equal(events.at(-1).message, "Collection restored. Syncing resumed.");
  assert.ok(
    events.findIndex((v) => v.state === "capture") <
      events.findIndex((v) => v.state === "following"),
  );
});

test("Nox says where to go when it isn't over a session it can read", () => {
  assert.equal(placementHint({ bundleId: "com.openai.codex" }), "");
  assert.equal(
    placementHint({ bundleId: "com.anthropic.claudefordesktop" }),
    "",
  );
  assert.match(
    placementHint({ error: "no-target" }),
    /Codex chat or the Claude app's Code tab/,
  );
  assert.match(
    placementHint({ bundleId: "com.apple.Safari" }),
    /Codex chat or the Claude app's Code tab/,
  );
  for (const terminal of [
    "com.apple.Terminal",
    "com.googlecode.iterm2",
    "com.microsoft.VSCode",
  ])
    assert.match(
      placementHint({ bundleId: terminal }),
      /Settings, then Connect a session/,
    );
});

test("a click or hover always opens Nox's panel with something to do or read", () => {
  const open = { expanded: true, moved: false, visible: true };
  assert.equal(showsControls({ ...open, paired: false }), true, "Set up");
  assert.equal(
    showsControls({ ...open, paired: true, setupPending: true }),
    true,
  );
  assert.equal(
    showsControls({ ...open, paired: true, candidate: { title: "Chat" } }),
    true,
  );
  assert.equal(
    showsControls({ ...open, paired: true, hint: "Move Nox" }),
    true,
  );
  // Still looking under Nox: nothing yet, so the panel never flashes a hint.
  assert.equal(showsControls({ ...open, paired: true }), false);
  assert.equal(
    showsControls({ ...open, expanded: false, paired: false }),
    false,
  );
  assert.equal(showsControls({ ...open, moved: true, paired: false }), false);
  assert.equal(
    showsControls({ ...open, visible: false, paired: false }),
    false,
  );
});

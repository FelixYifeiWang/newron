import test from "node:test";
import assert from "node:assert/strict";
import { createVisibilityPolicy } from "../desktop/visibility.mjs";
const fixture = () => {
  let time = 0;
  return {
    policy: createVisibilityPolicy({ now: () => time }),
    advance: (ms) => (time += ms),
  };
};
test("hides on unsupported surfaces and returns on supported ones without manual reopening", () => {
  const { policy, advance } = fixture();
  advance(16000);
  assert.equal(policy.update({ supported: false }), true);
  assert.equal(policy.update({ supported: false }), false);
  assert.equal(policy.update({ supported: true }), true);
});
test("manual Hide stays hidden even if a supported app becomes available", () => {
  const { policy, advance } = fixture();
  policy.hide();
  advance(60000);
  assert.equal(policy.update({ supported: true, interacting: true }), false);
  policy.reveal();
  assert.equal(policy.update({ supported: false }), true);
});
test("dragging and connecting do not disappear and drop gets a settling interval", () => {
  const { policy, advance } = fixture();
  advance(16000);
  for (let i = 0; i < 3; i++)
    assert.equal(policy.update({ supported: false, interacting: true }), true);
  advance(1000);
  assert.equal(policy.update({ supported: false }), true);
  advance(1000);
  policy.update({ supported: false });
  assert.equal(policy.update({ supported: false }), false);
});
test("unknown inspection results cannot cause flicker or unhide a hidden buddy", () => {
  const { policy, advance } = fixture();
  advance(16000);
  assert.equal(policy.update({ supported: null }), true);
  policy.update({ supported: false });
  policy.update({ supported: false });
  assert.equal(policy.update({ supported: null }), false);
});

test("an unavailable inspector is unknown, not an unsupported app", async () => {
  const { inspectVisibility } = await import("../desktop/visibility.mjs");
  for (const inspect of [
    async () => ({ error: "no-target" }),
    async () => {
      throw new Error("timeout");
    },
  ]) {
    const result = await inspectVisibility({
      inspect,
      resolve: async () => assert.fail("No target to resolve"),
      supportedApps: new Set(["codex"]),
    });
    assert.equal(result.supported, null);
  }
});
test("a failed session read cannot be treated as proof of an unsupported window", async () => {
  const { inspectVisibility } = await import("../desktop/visibility.mjs");
  const result = await inspectVisibility({
    inspect: async () => ({ bundleId: "codex" }),
    resolve: async () => {
      throw new Error("temporary navigation record unavailable");
    },
    supportedApps: new Set(["codex"]),
  });
  assert.equal(result.supported, null);
  assert.equal(result.reason, "session-check-failed");
});
test("confirmed unsupported apps still hide; successful exact resolution shows", async () => {
  const { inspectVisibility } = await import("../desktop/visibility.mjs");
  for (const id of ["browser", "codex"]) {
    const result = await inspectVisibility({
      inspect: async () => ({ bundleId: id }),
      resolve: async () => {},
      supportedApps: new Set(["codex"]),
    });
    assert.equal(result.supported, id === "codex");
  }
});
test("unsupported samples separated by unknown results are not consecutive misses", () => {
  const { policy, advance } = fixture();
  advance(16000);
  policy.update({ supported: false });
  policy.update({ supported: null });
  assert.equal(policy.update({ supported: false }), true);
  assert.equal(policy.update({ supported: false }), false);
});

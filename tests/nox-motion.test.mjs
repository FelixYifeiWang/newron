import test from "node:test";
import assert from "node:assert/strict";
import {
  followGaze,
  noxState,
  afterBackgroundSync,
} from "../lib/nox-motion.mjs";
test("pointer easing takes the same time at 30, 60 and 120Hz", () => {
  const results = [30, 60, 120].map((hz) => {
    let value = 0;
    for (let i = 0; i < hz; i++) value = followGaze(value, 0.3, 1 / hz);
    return value;
  });
  assert.ok(Math.max(...results) - Math.min(...results) < 0.00001);
});
test("tracking reversals settle without overshoot", () => {
  let value = 0.3;
  for (let i = 0; i < 120; i++) {
    const next = followGaze(value, -0.3, 1 / 60);
    assert.ok(next >= -0.3 && next <= value);
    value = next;
  }
  assert.ok(Math.abs(value + 0.3) < 0.00001);
});

import { pointerDirection } from "../lib/nox-motion.mjs";
test("pointer direction preserves diagonals and has no hard rectangular clamp", () => {
  const far = pointerDirection(1200, 600);
  assert.equal(far.x / far.y, 2);
  assert.ok(Math.hypot(far.x, far.y) < 2);
  assert.ok(pointerDirection(800, 0).x > pointerDirection(400, 0).x);
  assert.deepEqual(pointerDirection(0, 0), { x: 0, y: 0 });
});

import { springStep, releaseAfter } from "../lib/nox-motion.mjs";
const settle = (hz, seconds, from = 0, to = 1) => {
  let value = from,
    velocity = 0;
  const trace = [];
  for (let i = 0; i < hz * seconds; i++) {
    [value, velocity] = springStep(value, velocity, to, 1 / hz);
    trace.push(value);
  }
  return trace;
};
test("the working spring reaches its state in about a second without overshoot", () => {
  const trace = settle(60, 1.5);
  assert.ok(Math.max(...trace) <= 1);
  assert.ok(trace.every((v, i) => i === 0 || v >= trace[i - 1]));
  assert.ok(1 - trace.at(-1) < 0.01);
});
test("the working spring takes the same time at 30, 60 and 120Hz", () => {
  const ends = [30, 60, 120].map((hz) => settle(hz, 0.5).at(-1));
  assert.ok(Math.max(...ends) - Math.min(...ends) < 0.01);
});
test("flipping back halfway reverses smoothly and stays in range", () => {
  let value = 0,
    velocity = 0;
  for (let i = 0; i < 18; i++)
    [value, velocity] = springStep(value, velocity, 1, 1 / 60);
  const turn = value;
  let lowest = value;
  for (let i = 0; i < 120; i++) {
    [value, velocity] = springStep(value, velocity, 0, 1 / 60);
    lowest = Math.min(lowest, value);
  }
  assert.ok(turn > 0.2 && turn < 0.8);
  assert.ok(lowest > -0.02 && value < 0.01);
});
test("after work, the right-hand drops let go within a fifth of a second and rest again by four", () => {
  assert.equal(releaseAfter(-1), 0);
  assert.equal(releaseAfter(0), 0);
  assert.ok(releaseAfter(0.2) > 0.99);
  assert.ok(releaseAfter(1.5) > 0.99);
  assert.ok(releaseAfter(2.5) > 0 && releaseAfter(2.5) < 1);
  assert.equal(releaseAfter(4), 0);
});

test("Nox keeps working for as long as a connect is running", () => {
  assert.equal(
    noxState({ state: "following", connecting: true }),
    "connecting",
  );
  assert.equal(
    noxState({ state: "collecting", connecting: true }),
    "collecting",
  );
  assert.equal(noxState({ state: "error", connecting: true }), "error");
  assert.equal(
    noxState({ state: "following", connecting: false }),
    "following",
  );
  assert.equal(noxState({}), "waiting");
});

test("a background sync never settles a connect that is still working", () => {
  for (const working of ["connecting", "collecting", "reading"]) {
    assert.equal(afterBackgroundSync(working, "following"), working);
    assert.equal(afterBackgroundSync(working, "error"), working);
  }
  assert.equal(afterBackgroundSync("error", "following"), "following");
  assert.equal(afterBackgroundSync("following", "paused"), "paused");
});

test("intentional disconnection is quiet while real authentication failures stay visible", async () => {
  const { syncFailureState } = await import("../lib/nox-motion.mjs");
  assert.equal(
    syncFailureState({ status: 401, code: "SESSION_UNAVAILABLE" }),
    "waiting",
  );
  assert.equal(syncFailureState({ status: 409 }), "paused");
  assert.equal(syncFailureState({ status: 401 }), "error");
  assert.equal(syncFailureState({ status: 500 }), "error");
});

// A missing old transcript must not turn a healthy current chat red.
import { backgroundSyncStatus } from "../lib/nox-motion.mjs";
const healthy = {
  provider: "Codex",
  sessionId: "current",
  lastSynced: "now",
  error: "",
};
const missing = {
  provider: "Codex",
  sessionId: "old",
  error: "Local history missing",
};
test("background health does not depend on which subscription ran last", () => {
  for (const subscriptions of [
    [healthy, missing],
    [missing, healthy],
  ])
    assert.deepEqual(backgroundSyncStatus(subscriptions), {
      state: "following",
      error: "",
    });
});
test("a selected healthy session is unaffected by another session's failure", () => {
  assert.deepEqual(backgroundSyncStatus([healthy, missing], healthy), {
    state: "following",
    error: "",
  });
});
test("a selected failing session keeps its own actionable error", () => {
  assert.deepEqual(backgroundSyncStatus([healthy, missing], missing), {
    state: "error",
    error: missing.error,
  });
});
test("a new candidate does not inherit the previous session's error", () => {
  assert.deepEqual(
    backgroundSyncStatus([missing], { provider: "Codex", sessionId: "new" }),
    { state: "waiting", error: "" },
  );
});
test("paused and disconnected old subscriptions never report an active failure", () => {
  assert.deepEqual(backgroundSyncStatus([{ ...missing, paused: true }]), {
    state: "waiting",
    error: "",
  });
  assert.deepEqual(
    backgroundSyncStatus([{ ...missing, paused: true }], missing),
    { state: "paused", error: "" },
  );
});
test("provider and Claude desktop identity keep status scoped to the exact conversation", () => {
  assert.deepEqual(
    backgroundSyncStatus([missing], {
      provider: "Claude Code",
      sessionId: "old",
    }),
    { state: "waiting", error: "" },
  );
  assert.deepEqual(
    backgroundSyncStatus(
      [{ ...healthy, provider: "Claude Code", localSessionId: "desktop" }],
      {
        provider: "Claude Code",
        sessionId: "resumed",
        localSessionId: "desktop",
      },
    ),
    { state: "following", error: "" },
  );
});
test("a complete background outage remains visible and an untested subscription is waiting", () => {
  assert.deepEqual(backgroundSyncStatus([missing]), {
    state: "error",
    error: missing.error,
  });
  assert.deepEqual(
    backgroundSyncStatus([{ ...healthy, lastSynced: undefined }]),
    { state: "waiting", error: "" },
  );
});

test("authentication failure stays actionable even though its retry was stopped", () => {
  const auth = {
    ...missing,
    paused: true,
    syncState: "error",
    error: "Pair Nox again",
  };
  assert.deepEqual(backgroundSyncStatus([auth]), {
    state: "error",
    error: auth.error,
  });
  assert.deepEqual(backgroundSyncStatus([healthy, auth], auth), {
    state: "error",
    error: auth.error,
  });
});
test("a server-side pause stays paused instead of turning red", () => {
  const paused = { ...missing, syncState: "paused" };
  assert.deepEqual(backgroundSyncStatus([paused], paused), {
    state: "paused",
    error: paused.error,
  });
});

test("reconnecting a frozen conversation uses its live subscription's status", () => {
  const frozen = { ...missing, id: "frozen", paused: true };
  const live = { ...healthy, id: "live", sessionId: missing.sessionId };
  assert.deepEqual(backgroundSyncStatus([frozen, live], live), {
    state: "following",
    error: "",
  });
  assert.deepEqual(
    backgroundSyncStatus([frozen, live], { ...live, subscriptionId: "frozen" }),
    { state: "paused", error: "" },
  );
});

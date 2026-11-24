// A 140ms time constant keeps pointer tracking consistent across refresh rates.
export function followGaze(current, target, seconds) {
  return (
    current + (target - current) * (1 - Math.exp(-Math.max(0, seconds) / 0.14))
  );
}

// Radial saturation keeps the direction true even at the far corners of a display.
export function pointerDirection(dx, dy) {
  const distance = Math.hypot(240, dx, dy);
  return { x: (2 * dx) / distance, y: (2 * dy) / distance };
}

// How far Nox's mark is into working (0 at rest, 1 working) moves on a critically damped spring: it eases in and
// out, never overshoots from rest, and stays smooth when the state flips back halfway. Small substeps keep long
// frames stable. Returns [value, velocity].
export function springStep(value, velocity, target, seconds, stiffness = 5.5) {
  const steps = Math.max(1, Math.ceil(seconds / 0.01));
  const dt = seconds / steps;
  for (let i = 0; i < steps; i++) {
    velocity +=
      (stiffness * stiffness * (target - value) - 2 * stiffness * velocity) *
      dt;
    value += velocity * dt;
  }
  return [value, velocity];
}

const ease = (a, b, x) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
// Just after work ends, the two right-hand drops let go of each other quickly: the release is on within a fifth
// of a second, held, then handed back to the slow resting rhythm by about four seconds.
export function releaseAfter(seconds) {
  if (seconds < 0) return 0;
  return ease(0, 0.2, seconds) * (1 - ease(1.6, 3.8, seconds));
}

// A connect is work from the click until it ends: Nox's mark keeps working the whole time, even before the
// session is found and while another sync finishes. Only an error shows instead.
const WORKING = new Set(["connecting", "collecting", "reading"]);
export function noxState({ state = "waiting", connecting = false } = {}) {
  return connecting && !WORKING.has(state) && state !== "error"
    ? "connecting"
    : state;
}
// The background sync reports how other sessions are doing; it never settles a connect still at work.
export function afterBackgroundSync(current, next) {
  return WORKING.has(current) ? current : next;
}

// The face describes the chat under Nox. With no selected chat, report an
// outage only when every active subscription has failed, never the last one run.
export function backgroundSyncStatus(subscriptions, candidate) {
  let selected;
  if (candidate) {
    const matches = subscriptions.filter(
      (s) =>
        s.provider === candidate.provider &&
        ((s.sessionId && s.sessionId === candidate.sessionId) ||
          (s.localSessionId && s.localSessionId === candidate.localSessionId)),
    );
    selected = candidate.subscriptionId
      ? matches.find((s) => s.id === candidate.subscriptionId)
      : matches.find((s) => !s.paused && !s.done) || matches.at(-1);
    if (!selected) return { state: "waiting", error: "" };
    if (selected.paused && selected.syncState !== "error")
      return { state: "paused", error: "" };
    if (selected.error)
      return {
        state: selected.syncState === "paused" ? "paused" : "error",
        error: selected.error,
      };
  }
  const active = selected
    ? [selected]
    : subscriptions.filter(
        (s) => (!s.paused || s.syncState === "error") && !s.done,
      );
  if (active.some((s) => !s.error && s.lastSynced))
    return { state: "following", error: "" };
  if (active.length && active.every((s) => s.error))
    return {
      state: active.every((s) => s.syncState === "paused") ? "paused" : "error",
      error: active[0].error,
    };
  return { state: "waiting", error: "" };
}

// A deliberate disconnect or transfer is a normal end to this subscription.
export function syncFailureState(error) {
  if (error.status === 401 && error.code === "SESSION_UNAVAILABLE")
    return "waiting";
  return error.status === 409 ? "paused" : "error";
}

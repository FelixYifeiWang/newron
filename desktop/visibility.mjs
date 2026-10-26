// Manual hiding and a short explicit reveal are independent of automatic hiding.
export function createVisibilityPolicy({ now = Date.now } = {}) {
  let manual = false,
    revealUntil = now() + 15000,
    misses = 0,
    visible = true;
  return {
    reveal() {
      manual = false;
      revealUntil = now() + 15000;
      misses = 0;
      visible = true;
    },
    hide() {
      manual = true;
      visible = false;
    },
    isManual() {
      return manual;
    },
    update({ supported, interacting = false }) {
      if (manual) return false;
      if (interacting) {
        revealUntil = now() + 1200;
        misses = 0;
        return (visible = true);
      }
      if (now() < revealUntil) return (visible = true);
      if (supported === true) {
        misses = 0;
        return (visible = true);
      }
      if (supported === null) misses = 0;
      if (supported === false && ++misses >= 2) visible = false;
      // An inspector error is unknown, not a reason to flash or disappear.
      return visible;
    },
  };
}

// Only a positively identified unsupported app is evidence for hiding.
export async function inspectVisibility({
  inspect,
  resolve,
  supportedApps,
  onStage = () => {},
}) {
  const began = Date.now();
  let target;
  let windowMs = 0;
  let sessionBegan = 0;
  const finish = (result) => ({
    ...result,
    target: target && {
      bundleId: target.bundleId,
      pid: target.pid,
      windowCount: target.windowCount,
      launchedAt: target.launchedAt,
      bounds: target.bounds,
      point: target.point,
    },
    windowMs,
    sessionMs: sessionBegan ? Date.now() - sessionBegan : 0,
    totalMs: Date.now() - began,
  });
  try {
    onStage("window");
    target = await inspect();
    windowMs = Date.now() - began;
  } catch (error) {
    windowMs = Date.now() - began;
    return finish({
      supported: null,
      reason: "window-check-failed",
      error: diagnosticError(error),
      errorCode: error.code || error.name,
    });
  }
  if (target.error === "no-target")
    return finish({ supported: false, reason: "no-window" });
  if (target.error || !target.bundleId)
    return finish({
      supported: null,
      reason: "window-unavailable",
      errorCode: target.error,
    });
  const bundleId = target.bundleId;
  if (!supportedApps.has(bundleId))
    return finish({ supported: false, reason: "unsupported-app", bundleId });
  try {
    sessionBegan = Date.now();
    onStage("session");
    await resolve(target);
    return finish({ supported: true, reason: "session-resolved", bundleId });
  } catch (error) {
    return finish({
      supported: null,
      reason: "session-check-failed",
      bundleId,
      error: diagnosticError(error),
      errorCode: error.code || error.name,
    });
  }
}
function diagnosticError(error) {
  return String(error?.message || "Unknown inspection error")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/\b(?:sk-[\w-]+|[a-f0-9]{64})\b/gi, "[credential]")
    .replace(/\/(?:Users|home)\/[^\s/]+/g, "~")
    .slice(0, 300);
}

export const SUPPORTED_APPS = new Set([
  "com.openai.codex",
  "com.anthropic.claudefordesktop",
]);
// Terminals and editors where people run Claude Code, which Nox can't read yet.
const TERMINALS = new Set([
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "dev.warp.Warp-Stable",
  "com.mitchellh.ghostty",
  "net.kovidgoyal.kitty",
  "org.alacritty",
  "com.microsoft.VSCode",
  "com.todesktop.230313mzl4w4u92",
  "com.exafunction.windsurf",
  "dev.zed.Zed",
]);
// What Nox says when it isn't over a session it can read, so a click never looks like nothing happened.
export function placementHint(target) {
  if (!target?.error && SUPPORTED_APPS.has(target?.bundleId)) return "";
  if (TERMINALS.has(target?.bundleId))
    // Claude Code in a terminal connects from Newron's Connect a session prompt instead.
    return "In a terminal? In Newron, go to Settings, then Connect a session.";
  return "Move Nox onto a Codex chat or the Claude app's Code tab.";
}
// Nox's panel opens on every click or hover: Set up when unpaired, Connect over a session, otherwise a hint.
// It waits while Nox is still looking, so a hint never flashes before a session is found.
export function showsControls({
  expanded,
  moved,
  visible,
  paired,
  setupPending = false,
  candidate = null,
  hint = "",
}) {
  if (!expanded || moved || !visible) return false;
  return !paired || setupPending || !!candidate || !!hint;
}
// Only the explicit Connect action may subscribe; resolving the candidate is read-only.
export async function connectSession({
  inspect,
  resolve,
  subscribe,
  capture,
  report,
  point,
}) {
  try {
    const target = await inspect(point);
    if (target.error || !SUPPORTED_APPS.has(target.bundleId))
      throw new Error(
        "Place Nox over an open Codex conversation or Claude Code session.",
      );
    const source = await resolve(target);
    report({ state: "connecting", target: source.title, error: "", point });
    const subscription = await subscribe(source);
    report({
      state: "collecting",
      target: source.title,
      message: subscription?.restored
        ? "Collection restored. Catching up…"
        : "",
    });
    await capture(source, subscription);
    report({
      state: "following",
      target: source.title,
      error: "",
      message: subscription?.restored
        ? "Collection restored. Syncing resumed."
        : "",
    });
    return { connected: true, source };
  } catch (error) {
    report({ state: "error", error: error.message });
    return { connected: false };
  }
}

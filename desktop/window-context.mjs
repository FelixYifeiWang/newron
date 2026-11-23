const rectangle = (value) =>
  value &&
  ["x", "y", "width", "height"].every((key) => Number.isFinite(value[key])) &&
  value.width > 0 &&
  value.height > 0;
const same = (a, b) =>
  ["x", "y", "width", "height"].every((key) => Math.abs(a[key] - b[key]) < 1);
// Conservative exclusion: only a short, narrow rectangle fully inside a much
// larger window. Separate, overlapping or full-sized windows remain ambiguous.
function nestedPanel(child, parent) {
  return (
    parent.width >= 700 &&
    parent.height >= 480 &&
    child.width <= 720 &&
    child.height <= 240 &&
    child.width <= parent.width * 0.65 &&
    child.height <= parent.height * 0.35 &&
    child.x >= parent.x &&
    child.y >= parent.y &&
    child.x + child.width <= parent.x + parent.width &&
    child.y + child.height <= parent.y + parent.height
  );
}
export function assertConversationWindow(target, app) {
  const reject = () => {
    throw new Error(`Keep one ${app} window open, then connect again.`);
  };
  if (
    !Number.isInteger(target.windowCount) ||
    target.windowCount < 1 ||
    !rectangle(target.bounds)
  )
    return reject();
  if (target.bounds.height <= 240)
    throw new Error(
      "Move Nox over the conversation area, away from floating panels.",
    );
  if (target.windowCount === 1) return;
  const windows = target.windowBounds;
  if (
    !Array.isArray(windows) ||
    windows.length !== target.windowCount ||
    windows.length > 32 ||
    !windows.every(rectangle)
  )
    return reject();
  const panels = windows.map((child) =>
    windows.some((parent) => parent !== child && nestedPanel(child, parent)),
  );
  const selected = windows.findIndex((rect) => same(rect, target.bounds));
  if (selected === -1) return reject();
  if (panels[selected])
    throw new Error(
      "Move Nox over the conversation area, away from floating panels.",
    );
  if (panels.filter((panel) => !panel).length !== 1) return reject();
}

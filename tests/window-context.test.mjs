import test from "node:test";
import assert from "node:assert/strict";
import { assertConversationWindow } from "../desktop/window-context.mjs";
const main = { x: 0, y: 33, width: 1470, height: 923 };
const panel = { x: 469, y: 164, width: 599, height: 178 };
const target = (bounds = main, windows = [main, panel]) => ({
  bounds,
  windowCount: windows.length,
  windowBounds: windows,
});
test("the captured contained short panel does not count as another conversation", () => {
  assert.doesNotThrow(() => assertConversationWindow(target(), "Codex"));
});
test("a point on the short panel never selects the underlying conversation", () => {
  assert.throws(
    () => assertConversationWindow(target(panel), "Codex"),
    /conversation area/,
  );
});
test("a genuinely separate or full-sized second window is rejected", () => {
  for (const second of [
    { x: 30, y: 45, width: 900, height: 700 },
    { ...main, x: 1600 },
    { ...panel, x: 1500 },
  ])
    assert.throws(
      () => assertConversationWindow(target(main, [main, second]), "Codex"),
      /one Codex window/,
    );
});
test("missing, incomplete or inconsistent geometry never bypasses the window guard", () => {
  for (const value of [
    { bounds: main, windowCount: 2 },
    { ...target(), windowBounds: [main] },
    { ...target(), bounds: { ...main, x: 20 } },
    { ...target(), windowBounds: [main, { ...panel, width: NaN }] },
  ])
    assert.throws(() => assertConversationWindow(value, "Codex"));
});
test("one window remains compatible with the older native helper", () => {
  assert.doesNotThrow(() =>
    assertConversationWindow({ windowCount: 1, bounds: main }, "Codex"),
  );
});
test("a standalone short panel cannot borrow the last conversation route", () => {
  assert.throws(
    () => assertConversationWindow({ windowCount: 1, bounds: panel }, "Codex"),
    /conversation area/,
  );
});

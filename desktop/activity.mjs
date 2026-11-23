import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { assertConversationWindow } from "./window-context.mjs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const windowContextEvent = (line) =>
  line.includes("rendererWindowId=") &&
  line.includes("rendererWindowAppearance=") &&
  line.includes("rendererWindowVisible=");
const navigationEvent = (line) =>
  line.includes(" thread_stream_view_activity_changed ") ||
  line.includes("IAB_LIFECYCLE received browser sidebar owner sync ") ||
  line.includes("IAB_LIFECYCLE received browser use session route capture ");

export function activeConversation(
  raw,
  launchedAt = 0,
  knownSessionIds = null,
) {
  const windows = new Map();
  const routes = new Map();
  const browserSessions = new Map();
  const contexts = new Map();
  const routeOrders = new Map();
  const activations = new Map();
  const closed = new Set();
  let lastGlobal = -1,
    lastScoped = -1,
    order = 0;
  for (const line of raw.split("\n")) {
    if (!navigationEvent(line) && !windowContextEvent(line)) continue;
    const timestamp = Date.parse(line.slice(0, 24));
    if (!Number.isFinite(timestamp) || timestamp < launchedAt) continue;
    const fields = Object.fromEntries(
      [...line.matchAll(/\b([A-Za-z][A-Za-z0-9]*)=([^\s]+)/g)].map((m) => [
        m[1],
        m[2],
      ]),
    );
    order++;
    if (windowContextEvent(line) && /^\d+$/.test(fields.rendererWindowId || ""))
      contexts.set(fields.rendererWindowId, {
        primary: fields.rendererWindowAppearance === "primary",
        visible: fields.rendererWindowVisible === "true",
      });
    if (
      line.includes(" thread_stream_view_activity_changed ") &&
      !fields.rendererWindowId &&
      uuid.test(fields.conversationId || "")
    ) {
      // Host-level activity can belong to a helper or background task. It never
      // establishes UI ownership; only the visible primary window's route can.
      lastGlobal = order;
      if (fields.active === "true")
        activations.set(fields.conversationId, order);
      continue;
    }
    if (line.includes("IAB_LIFECYCLE received browser sidebar owner sync ")) {
      const route = /^\/local\/([0-9a-f-]{36})(?:[?#]|$)/i.exec(
        fields.ownerRoutePath || "",
      );
      if (/^\d+$/.test(fields.windowId || "")) {
        const window = fields.windowId;
        const routed = route && uuid.test(route[1]) ? route[1] : null;
        routes.set(window, routed);
        routeOrders.set(window, order);
        // New Codex builds can navigate with owner-route events alone. Keep the
        // already-active window in sync, or a subsequent helper stream can
        // displace the real task because it no longer matches the routed task.
        // Never reactivate a closed window or choose the last known task for a
        // home/cloud/unindexed route. Exact index validation still follows.
        if (windows.has(window)) {
          if (routed) windows.set(window, routed);
          else windows.delete(window);
        }
      }
      continue;
    }
    if (
      line.includes("IAB_LIFECYCLE received browser use session route capture ")
    ) {
      if (
        uuid.test(fields.conversationId || "") &&
        /^\d+$/.test(fields.windowId || "")
      ) {
        if (!browserSessions.has(fields.windowId))
          browserSessions.set(fields.windowId, new Set());
        browserSessions.get(fields.windowId).add(fields.conversationId);
      }
      continue;
    }
    if (!line.includes(" thread_stream_view_activity_changed ")) continue;
    if (
      fields.rendererWindowAppearance !== "primary" ||
      !uuid.test(fields.conversationId || "") ||
      !/^\d+$/.test(fields.rendererWindowId || "")
    )
      continue;
    const id = fields.conversationId,
      window = fields.rendererWindowId;
    const current = windows.get(window);
    // Codex emits helper-stream activity as if it were the primary view. Ignore it only
    // when the indexed task is still active AND its visible route corroborates it.
    // A closed task or genuine navigation never falls back to an older conversation.
    const internalHelper =
      knownSessionIds?.has(current) &&
      !knownSessionIds.has(id) &&
      routes.get(window) === current &&
      browserSessions.get(window)?.has(id);
    if (fields.active === "true" && fields.rendererWindowVisible === "true") {
      lastScoped = order;
      if (!internalHelper) {
        windows.set(window, id);
        closed.delete(window);
      }
    } else if (
      (fields.active === "false" || fields.rendererWindowVisible === "false") &&
      windows.get(window) === id
    ) {
      lastScoped = order;
      windows.delete(window);
      closed.add(window);
    }
  }
  if (lastGlobal > lastScoped) {
    const primary = [...contexts].filter(
      ([window, context]) =>
        context.primary && context.visible && !closed.has(window),
    );
    if (primary.length > 1)
      throw new Error(
        "More than one conversation is open. Keep one Codex window open and connect again.",
      );
    const selected = primary.length === 1 && routes.get(primary[0][0]);
    if (!selected || (knownSessionIds && !knownSessionIds.has(selected)))
      throw new Error(
        "Open a local Codex conversation with a readable session, then connect again.",
      );
    const window = primary[0][0];
    const pendingNavigation = [...activations].some(
      ([id, activation]) =>
        id !== selected &&
        activation > routeOrders.get(window) &&
        !(
          knownSessionIds &&
          !knownSessionIds.has(id) &&
          browserSessions.get(window)?.has(id)
        ),
    );
    if (pendingNavigation)
      throw new Error(
        "The session changed. Wait for the conversation to finish opening, then connect again.",
      );
    return selected;
  }
  const ids = [...new Set(windows.values())];
  if (ids.length !== 1)
    throw new Error(
      ids.length
        ? "More than one conversation is open. Keep one Codex window open and connect again."
        : "Open the conversation in Codex, then connect again.",
    );
  return ids[0];
}

async function logFiles(root, pid) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const result = [];
  for (const entry of entries) {
    const file = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await logFiles(file, pid)));
    else if (
      entry.isFile() &&
      entry.name.includes(`-${pid}-t0-`) &&
      entry.name.endsWith(".log")
    )
      result.push(file);
  }
  return result;
}
export async function readOpenConversation(
  target,
  root = join(homedir(), "Library/Logs/com.openai.codex"),
  knownSessionIds = null,
) {
  if (target.bundleId !== "com.openai.codex")
    throw new Error(
      "Move Nox over the open Codex conversation. Other apps are not supported yet.",
    );
  assertConversationWindow(target, "Codex");
  if (
    !Number.isSafeInteger(target.pid) ||
    target.pid <= 0 ||
    !(target.launchedAt > 0)
  )
    throw new Error("Could not identify the running Codex app.");
  // Without screen access we cannot identify an inactive sidebar row. Do not silently choose the open conversation for such a drop.
  if (
    !target.bounds ||
    !target.point ||
    target.point.x < target.bounds.x + Math.min(360, target.bounds.width * 0.35)
  )
    throw new Error(
      "Open that session first, then move Nox over the conversation area.",
    );
  const files = await Promise.all(
    (await logFiles(root, target.pid)).map(async (file) => ({
      file,
      info: await stat(file),
    })),
  );
  const current = files
    .filter((entry) => entry.info.mtimeMs >= target.launchedAt)
    .sort((a, b) => a.info.mtimeMs - b.info.mtimeMs);
  if (!current.length)
    throw new Error(
      "This Codex version has no readable navigation record. Nothing was connected.",
    );
  // Keep only the navigation event. Conversation messages and other log contents are never uploaded.
  const events = [];
  for (const { file } of current) {
    const input = createReadStream(file, { encoding: "utf8" });
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (navigationEvent(line) || windowContextEvent(line)) {
          // Retain only navigation/visibility fields, never URLs, console text,
          // message bodies or other unrelated log payloads.
          const eventName = line.includes(
            " thread_stream_view_activity_changed ",
          )
            ? "thread_stream_view_activity_changed"
            : line.includes("browser sidebar owner sync ")
              ? "IAB_LIFECYCLE received browser sidebar owner sync"
              : line.includes("browser use session route capture ")
                ? "IAB_LIFECYCLE received browser use session route capture"
                : "window_context";
          const allowed = new Set([
            "active",
            "conversationId",
            "rendererWindowAppearance",
            "rendererWindowId",
            "rendererWindowVisible",
            "windowId",
            "ownerRoutePath",
          ]);
          const fields = [
            ...line.matchAll(/\b([A-Za-z][A-Za-z0-9]*)=([^\s]+)/g),
          ]
            .filter((match) => allowed.has(match[1]))
            .map((match) => `${match[1]}=${match[2]}`);
          events.push(`${line.slice(0, 24)} ${eventName} ${fields.join(" ")}`);
        }
      }
    } finally {
      lines.close();
      input.destroy();
    }
  }
  events.sort((a, b) => a.slice(0, 24).localeCompare(b.slice(0, 24)));
  return activeConversation(
    events.join("\n"),
    target.launchedAt,
    knownSessionIds,
  );
}

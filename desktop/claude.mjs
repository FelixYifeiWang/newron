import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { assertConversationWindow } from "./window-context.mjs";
export const CLAUDE_BUNDLE_ID = "com.anthropic.claudefordesktop";
const localId =
  /^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cliId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const focusEvent = " LocalSessions.setFocusedSession: sessionId=";

// The latest focus event wins. A null event means no session is focused, so never fall back to an earlier one.
export function focusedClaudeSession(raw, launchedAt = 0) {
  // Log timestamps have second precision; keep events from the launch second.
  const since = Math.floor(launchedAt / 1000) * 1000;
  let focused = null;
  for (const line of raw.split("\n")) {
    const at = line.indexOf(focusEvent);
    if (at === -1) continue;
    const timestamp = Date.parse(line.slice(0, 19).replace(" ", "T"));
    if (!Number.isFinite(timestamp) || timestamp < since) continue;
    const id = line.slice(at + focusEvent.length).trim();
    focused = localId.test(id) ? id : null;
  }
  if (!focused)
    throw new Error(
      "Open the session in Claude's Code tab, then connect again.",
    );
  return focused;
}

export async function readFocusedClaudeSession(
  target,
  logFile = join(homedir(), "Library/Logs/Claude/main.log"),
) {
  if (target.bundleId !== CLAUDE_BUNDLE_ID)
    throw new Error("Move Nox over an open Claude Code session.");
  assertConversationWindow(target, "Claude");
  if (
    !Number.isSafeInteger(target.pid) ||
    target.pid <= 0 ||
    !(target.launchedAt > 0)
  )
    throw new Error("Could not identify the running Claude app.");
  // Without screen access we cannot identify an inactive sidebar row. Do not silently choose the open session for such a drop.
  if (
    !target.bounds ||
    !target.point ||
    target.point.x < target.bounds.x + Math.min(360, target.bounds.width * 0.35)
  )
    throw new Error(
      "Open that session first, then move Nox over the conversation area.",
    );
  let info;
  try {
    info = await stat(logFile);
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error(
        "This Claude version has no readable navigation record. Nothing was connected.",
      );
    throw error;
  }
  if (info.size > 32 * 1024 * 1024)
    throw new Error(
      "Claude's log is too large for this preview. Restart Claude and try again.",
    );
  // Keep only focus events. Conversation messages and other log contents are never uploaded.
  const events = (await readFile(logFile, "utf8"))
    .split("\n")
    .filter((line) => line.includes(focusEvent));
  return focusedClaudeSession(events.join("\n"), target.launchedAt);
}

async function subfolders(root) {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

// Session metadata lives at <account>/<organization>/<local id>.json. Read only identifiers, title and working folder.
export async function claudeSessionMetadata(
  id,
  sessionsRoot = join(
    homedir(),
    "Library/Application Support/Claude/claude-code-sessions",
  ),
) {
  if (!localId.test(id)) throw new Error("Unknown Claude session.");
  const matches = [];
  for (const account of await subfolders(sessionsRoot))
    for (const org of await subfolders(account)) {
      let raw;
      try {
        raw = await readFile(join(org, `${id}.json`), "utf8");
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      const record = JSON.parse(raw);
      if (record.sessionId === id && cliId.test(record.cliSessionId || ""))
        matches.push({
          cliSessionId: record.cliSessionId,
          title: String(record.title || "").trim(),
          cwd: record.cwd || "",
        });
    }
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? "Ambiguous Claude session. Nothing was connected."
        : "Claude session index not found on this computer.",
    );
  return matches[0];
}

// Recover desktop identity for subscriptions made before Nox saved it.
export async function claudeLocalSessionId(
  cliSessionId,
  sessionsRoot = join(
    homedir(),
    "Library/Application Support/Claude/claude-code-sessions",
  ),
) {
  const matches = [];
  for (const account of await subfolders(sessionsRoot))
    for (const org of await subfolders(account)) {
      for (const file of await readdir(org)) {
        if (!file.endsWith(".json") || !localId.test(file.slice(0, -5)))
          continue;
        let record;
        try {
          record = JSON.parse(await readFile(join(org, file), "utf8"));
        } catch (error) {
          if (error.code === "ENOENT" || error instanceof SyntaxError) continue;
          throw error;
        }
        if (
          record.cliSessionId === cliSessionId &&
          localId.test(record.sessionId)
        )
          matches.push(record.sessionId);
      }
    }
  return matches.length === 1 ? matches[0] : undefined;
}

export async function findClaudeTranscript(
  cliSessionId,
  projectsRoot = join(homedir(), ".claude", "projects"),
) {
  if (!cliId.test(cliSessionId)) throw new Error("Unknown Claude session.");
  const root = await realpath(projectsRoot).catch((error) => {
    if (error.code === "ENOENT")
      throw new Error("Claude Code transcripts not found on this computer.");
    throw error;
  });
  const found = [];
  for (const folder of await subfolders(root)) {
    let canonical;
    try {
      canonical = await realpath(join(folder, `${cliSessionId}.jsonl`));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const local = relative(root, canonical);
    if (local && !local.startsWith("..") && !isAbsolute(local))
      found.push(canonical);
  }
  if (!found.length)
    throw new Error(
      "This session has no transcript yet. Send a message, then connect again.",
    );
  const ranked = await Promise.all(
    found.map(async (file) => ({ file, mtime: (await stat(file)).mtimeMs })),
  );
  ranked.sort((a, b) => a.mtime - b.mtime);
  return ranked.at(-1).file;
}

// Following a project folder captures every Claude Code session started in it, including later ones.
// Claude Code keeps them under ~/.claude/projects/<folder path with non-alphanumerics replaced by "-">.
export async function claudeProjectSource(
  folder,
  projectsRoot = join(homedir(), ".claude", "projects"),
) {
  if (typeof folder !== "string" || !isAbsolute(folder))
    throw new Error("Choose a project folder by its full path.");
  const root = await realpath(projectsRoot).catch((error) => {
    if (error.code === "ENOENT")
      throw new Error("Claude Code transcripts not found on this computer.");
    throw error;
  });
  const project = folder.replace(/\/+$/, "") || "/";
  let canonical;
  try {
    canonical = await realpath(
      join(root, project.replace(/[^a-zA-Z0-9]/g, "-")),
    );
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error(
        "No Claude Code sessions found for this folder. Start one there, then follow it again.",
      );
    throw error;
  }
  const local = relative(root, canonical);
  if (
    !local ||
    local.startsWith("..") ||
    isAbsolute(local) ||
    local.includes("/")
  )
    throw new Error(
      "The project transcripts are outside the Claude Code folder.",
    );
  return {
    sessionId: `claude-project:${project}`,
    title: project.split("/").pop() || project,
    file: canonical,
    folder: true,
    provider: "Claude Code",
  };
}

export async function resolveClaudeTarget(target, paths = {}) {
  const id = await readFocusedClaudeSession(target, paths.logFile);
  const meta = await claudeSessionMetadata(id, paths.sessionsRoot);
  return {
    sessionId: meta.cliSessionId,
    localSessionId: id,
    title: meta.title || meta.cwd.split("/").pop() || "Claude Code session",
    file: await findClaudeTranscript(meta.cliSessionId, paths.projectsRoot),
    provider: "Claude Code",
  };
}

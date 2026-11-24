import { readdir, realpath } from "node:fs/promises";
import { join, relative, isAbsolute, basename } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readOpenConversation } from "./activity.mjs";
import {
  CLAUDE_BUNDLE_ID,
  resolveClaudeTarget,
  claudeSessionMetadata,
  claudeLocalSessionId,
} from "./claude.mjs";
import { codexTranscripts, claudeTranscripts } from "./transcripts.mjs";
const exec = promisify(execFile);
const normalized = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

export function resolveTarget(target, sessions) {
  if (target.bundleId !== "com.openai.codex")
    throw new Error(
      "Drop onto a Codex conversation. Other apps are not supported yet.",
    );
  const labels = (target.labels || []).map(normalized).filter(Boolean);
  const ids = new Set(
    (target.urls || []).flatMap(
      (value) =>
        String(value).match(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        ) || [],
    ),
  );
  const identified = sessions.filter((s) => ids.has(s.sessionId));
  if (identified.length > 1)
    throw new Error(
      "Ambiguous drop. Drop directly onto the conversation title.",
    );
  if (identified.length === 1) return identified[0];
  const matched = sessions.filter((s) =>
    [s.title, ...(s.aliases || [])].some((title) =>
      labels.includes(normalized(title)),
    ),
  );
  if (matched.length > 1)
    throw new Error(
      "Ambiguous title. These conversations have the same name. Rename one and drop again.",
    );
  if (matched.length === 1) return matched[0];
  throw new Error(
    "Could not identify this session. Drop directly onto its full title.",
  );
}

export async function confineTranscript(file, codexHome) {
  const canonical = await realpath(file);
  for (const folder of ["sessions", "archived_sessions"]) {
    let root;
    try {
      root = await realpath(join(codexHome, folder));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const local = relative(root, canonical);
    if (
      local &&
      !local.startsWith("..") &&
      !isAbsolute(local) &&
      canonical.endsWith(".jsonl")
    )
      return canonical;
  }
  throw new Error(
    "The selected transcript is outside the Codex session folder.",
  );
}

export async function codexSessionMetadata(
  codexHome = process.env.CODEX_HOME || join(homedir(), ".codex"),
) {
  const names = (await readdir(codexHome))
    .filter((name) => /^state_\d+\.sqlite$/.test(name))
    .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
  if (!names.length)
    throw new Error("Codex session index not found on this computer.");
  const db = join(codexHome, names[0]);
  const options = { timeout: 5000, maxBuffer: 8 * 1024 * 1024 };
  const schema = JSON.parse(
    (
      await exec(
        "/usr/bin/sqlite3",
        ["-readonly", "-json", db, "PRAGMA table_info(threads);"],
        options,
      )
    ).stdout,
  );
  const hasName = schema.some((column) => column.name === "name");
  // Read only identifiers, titles, and transcript paths; never scan conversation bodies to guess a target.
  const query = `SELECT id, title, rollout_path${hasName ? ", name" : ""} FROM threads WHERE rollout_path <> '';`;
  const rows = JSON.parse(
    (await exec("/usr/bin/sqlite3", ["-readonly", "-json", db, query], options))
      .stdout || "[]",
  );
  return rows.map((row) => ({
    sessionId: row.id,
    title: row.name || row.title,
    aliases: [row.title].filter(Boolean),
    file: row.rollout_path,
    provider: "Codex",
  }));
}

export async function resolveLocalTarget(
  target,
  codexHome = process.env.CODEX_HOME || join(homedir(), ".codex"),
) {
  if (target.bundleId === CLAUDE_BUNDLE_ID) return resolveClaudeTarget(target);
  const sessions = await codexSessionMetadata(codexHome);
  const sessionId = await readOpenConversation(
    target,
    undefined,
    new Set(sessions.map((session) => session.sessionId)),
  );
  const selected = resolveTarget(
    { bundleId: target.bundleId, urls: [sessionId] },
    sessions,
  );
  return {
    ...selected,
    file: await codexTranscriptFile(selected, codexHome),
  };
}

async function codexTranscriptFile(selected, codexHome) {
  try {
    return await confineTranscript(selected.file, codexHome);
  } catch (error) {
    // Codex can leave an index pointing at a moved or removed file. Recovery
    // requires a matching filename AND session header, never a similar title.
    if (error.code !== "ENOENT") throw error;
    const files = await codexTranscripts(selected.sessionId, codexHome);
    if (files.length) return files.at(-1);
    const unavailable = new Error(
      "Local history is missing. Open this session in Codex, then try again.",
    );
    unavailable.code = "LOCAL_TRANSCRIPT_UNAVAILABLE";
    throw unavailable;
  }
}

// Codex can replace a thread's rollout when it resumes. Follow the thread, not
// the file captured on connect. Legacy subscriptions recover its ID from the filename.
export async function resolveFollowedTranscript(
  subscription,
  {
    codexHome = process.env.CODEX_HOME || join(homedir(), ".codex"),
    metadata = codexSessionMetadata,
    projectsRoot = join(homedir(), ".claude", "projects"),
    sessionsRoot,
  } = {},
) {
  if (subscription.folder) return { file: subscription.file };
  if (subscription.provider === "Claude Code" && subscription.sessionId) {
    const ids = new Set(
      subscription.transcriptSessionIds || [subscription.sessionId],
    );
    const localSessionId =
      subscription.localSessionId ||
      (await claudeLocalSessionId(subscription.sessionId, sessionsRoot));
    if (localSessionId) {
      const meta = await claudeSessionMetadata(localSessionId, sessionsRoot);
      ids.add(meta.cliSessionId);
    }
    const files = await claudeTranscripts([...ids], projectsRoot);
    if (!files.length)
      throw new Error("This Claude session has no readable transcript yet.");
    return {
      file: files.at(-1),
      files,
      transcriptSessionIds: [...ids],
      localSessionId,
    };
  }
  if (subscription.provider !== "Codex") return { file: subscription.file };
  const sessionId =
    subscription.sessionId ||
    basename(subscription.file).match(
      /^rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_|\.jsonl$)/i,
    )?.[1];
  const selected =
    sessionId &&
    (await metadata(codexHome)).find((s) => s.sessionId === sessionId);
  if (!selected)
    throw new Error(
      "Subscribed Codex session is unavailable. Open it in Codex and reconnect.",
    );
  const file = await codexTranscriptFile(selected, codexHome);
  return {
    file,
    sessionId,
    files: await codexTranscripts(sessionId, codexHome, file),
  };
}

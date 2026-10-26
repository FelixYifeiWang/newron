// Reports are untrusted input. Only bounded, redacted text is kept: no credentials, private links,
// home folder paths or email addresses.
function redact(value, limit) {
  return String(value ?? "")
    .slice(0, 16000)
    .replace(/https?:\/\/[^\s"<>]+/gi, (value) => {
      try {
        const url = new URL(value);
        return url.origin + url.pathname;
      } catch {
        return "[URL]";
      }
    })
    .replace(/\b(?:sk-[\w-]+|[a-f0-9]{64})\b/gi, "[credential]")
    .replace(/\bBearer\s+[^\s"<>]+/gi, "Bearer [credential]")
    .replace(
      /\b(?:[\w-]*(?:token|secret|password|api[_-]?key))\s*[:=]\s*[^\s,;]+/gi,
      "[credential]",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\/(?:Users|home)\/[^\s/"']+/g, "~")
    .slice(0, limit);
}
// Diagnostics are untrusted agent input. Only keep explicit, bounded fields.
export function sanitizeSetupReport(input) {
  if (!input || !["installer", "agent"].includes(input.reporter))
    throw new Error("Invalid setup report.");
  return {
    reporter: input.reporter,
    stage: redact(input.stage, 120),
    environment: redact(input.environment, 1000),
    evidence: redact(input.evidence, 6000),
    rootCause: redact(input.rootCause, 2000),
    confidence: ["confirmed", "likely", "unknown"].includes(input.confidence)
      ? input.confidence
      : "unknown",
    suggestedFix: redact(input.suggestedFix, 2000),
  };
}
export async function storeSetupReport(db, codeHash, report, now = Date.now()) {
  // One immutable report per reporter per code. Does not claim or complete setup.
  await db
    .prepare("DELETE FROM setup_reports WHERE created_at<?")
    .bind(now - 30 * 24 * 60 * 60 * 1000)
    .run();
  await db
    .prepare(
      `INSERT OR IGNORE INTO setup_reports(code_hash,owner_id,reporter,report,created_at)
    SELECT code_hash,owner_id,?,?,? FROM pairing_codes WHERE code_hash=? AND expires_at>?`,
    )
    .bind(report.reporter, JSON.stringify(report), now, codeHash, now)
    .run();
  const result = await db
    .prepare(
      "UPDATE setup_reports SET created_at=created_at WHERE code_hash=? AND reporter=? AND EXISTS(SELECT 1 FROM pairing_codes WHERE code_hash=? AND expires_at>?)",
    )
    .bind(codeHash, report.reporter, codeHash, now)
    .run();
  return result.meta.changes === 1;
}

// A report someone sends from Newron's Report a problem page (often opened from Nox): what happened in their
// words, an error they pasted, and the facts Nox attached. Redacted like setup reports.
export function sanitizeUserReport(input) {
  const note = redact(input?.note, 2000).trim();
  if (note.length < 3) throw new Error("Say what happened.");
  return {
    reporter: "user",
    stage: ["nox", "setup", "other"].includes(input.stage)
      ? input.stage
      : "other",
    note,
    error: redact(input.error, 4000),
    nox:
      input.nox && typeof input.nox === "object"
        ? redact(JSON.stringify(input.nox), 7000)
        : "",
    environment: redact(input.environment, 400),
  };
}
// Stored beside setup reports (read with scripts/setup-reports.mjs), kept 30 days, at most ten per person a day.
export async function storeUserReport(
  db,
  ownerId,
  id,
  report,
  now = Date.now(),
) {
  await db
    .prepare("DELETE FROM setup_reports WHERE created_at<?")
    .bind(now - 30 * 24 * 60 * 60 * 1000)
    .run();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO setup_reports(code_hash,owner_id,reporter,report,created_at)
       SELECT ?,?,'user',?,? WHERE (SELECT COUNT(*) FROM setup_reports WHERE owner_id=? AND reporter='user' AND created_at>?)<10`,
    )
    .bind(
      `user:${id}`,
      ownerId,
      JSON.stringify(report),
      now,
      ownerId,
      now - 24 * 60 * 60 * 1000,
    )
    .run();
  return result.meta.changes === 1;
}

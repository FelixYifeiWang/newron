// What Nox attaches when someone chooses Report a problem: explicit facts about this install and its last
// problems, never session titles, transcript paths, conversation text or keys. The facts travel in the link's
// fragment, which the browser never sends to a server, and the person sees them before sending (app/report).
const MAX_DATA = 7000;
const text = (value, limit) => String(value ?? "").slice(0, limit);
export function noxReport({
  release,
  version,
  os,
  arch,
  paired,
  setupPending,
  status,
  lastError,
  hint,
  subscriptions = [],
  problems = [],
}) {
  return {
    release: text(release, 80),
    version: text(version, 40),
    os: text(os, 80),
    arch: text(arch, 20),
    paired: !!paired,
    setupPending: !!setupPending,
    status: text(status, 40),
    lastError: text(lastError, 500),
    hint: text(hint, 200),
    sessions: subscriptions.slice(0, 20).map((s) => ({
      provider: text(s.provider, 40),
      mode: text(s.mode, 20),
      paused: !!s.paused,
      done: !!s.done,
      error: text(s.error, 300),
    })),
    problems: problems.slice(-32),
  };
}
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
// The newest problems matter most; the oldest are dropped until the link is short enough to open.
export function reportLink(origin, report) {
  const trimmed = { ...report, problems: [...(report.problems || [])] };
  let data = encode(trimmed);
  while (data.length > MAX_DATA && trimmed.problems.length) {
    trimmed.problems.shift();
    data = encode(trimmed);
  }
  return `${origin}/report#nox=${data}`;
}

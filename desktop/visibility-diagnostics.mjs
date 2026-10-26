import { readFile, writeFile, rename } from "node:fs/promises";
const limits = { recent: 128, problems: 32 };
const fields = new Set([
  "event",
  "reason",
  "error",
  "errorCode",
  "visible",
  "expectedVisible",
  "actualVisible",
  "opacity",
  "appHidden",
  "manual",
  "interacting",
  "revision",
  "target",
  "state",
  "windowMs",
  "sessionMs",
  "totalMs",
  "pendingMs",
  "lagMs",
  "pid",
  "windowCount",
  "launchedAt",
  "bounds",
  "point",
  "x",
  "y",
  "width",
  "height",
  "bundleId",
  "platform",
  "electron",
  "node",
  "release",
  "loading",
  "destroyed",
  "exitCode",
  "type",
  "displayCount",
]);
function clean(value, depth = 0) {
  if (depth > 3) return undefined;
  if (typeof value === "string")
    return value
      .slice(0, 2000)
      .replace(/https?:\/\/\S+/gi, "[URL]")
      .replace(/\b(?:sk-[\w-]+|[a-f0-9]{64})\b/gi, "[credential]")
      .replace(/\bBearer\s+\S+/gi, "Bearer [credential]")
      .replace(
        /\b[\w-]*(?:token|secret|password|api[_-]?key)\s*[:=]\s*\S+/gi,
        "[credential]",
      )
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
      .replace(/\/(?:Users|home)\/[^\s/]+/g, "~")
      .slice(0, 400);
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  if (value && typeof value === "object" && !Array.isArray(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => fields.has(key))
        .map(([key, v]) => [key, clean(v, depth + 1)]),
    );
}
function problem(event) {
  return (
    !!event.error ||
    /failed|gone|unresponsive|stalled|mismatch|outer-error/.test(
      `${event.event || ""} ${event.reason || ""}`,
    ) ||
    event.totalMs > 5000 ||
    event.pendingMs > 10000 ||
    event.lagMs > 5000 ||
    (event.state?.expectedVisible &&
      (!event.state.actualVisible ||
        event.state.appHidden ||
        event.state.opacity < 0.05) &&
      event.event === "heartbeat")
  );
}
export async function createVisibilityDiagnostics(
  file,
  {
    onError = (error) =>
      console.error("Nox diagnostics:", error.code || error.name),
    now = Date.now,
  } = {},
) {
  const data = { version: 2, recent: [], problems: [] };
  try {
    let old = JSON.parse(await readFile(file, "utf8"));
    if (Array.isArray(old))
      old = { version: 2, recent: old, problems: old.filter(problem) };
    if (old?.version === 2)
      for (const key of Object.keys(limits))
        data[key] = (Array.isArray(old[key]) ? old[key] : [])
          .slice(-limits[key])
          .map((row) => ({
            ...clean(row),
            at: typeof row.at === "string" ? row.at.slice(0, 30) : "",
          }));
  } catch (error) {
    if (error.code !== "ENOENT") onError(error);
  }
  let writing = null,
    pending = false;
  async function persist() {
    while (pending) {
      pending = false;
      try {
        // One writer and same-directory rename: interruption cannot truncate the previous log.
        await writeFile(file + ".tmp", JSON.stringify(data), { mode: 0o600 });
        await rename(file + ".tmp", file);
      } catch (error) {
        onError(error);
      }
    }
  }
  function startWrite() {
    writing = persist().finally(() => {
      writing = null;
      if (pending) startWrite();
    });
  }
  return {
    record(event) {
      const entry = { at: new Date(now()).toISOString(), ...clean(event) };
      data.recent.push(entry);
      data.recent = data.recent.slice(-limits.recent);
      if (problem(entry)) {
        data.problems.push(entry);
        data.problems = data.problems.slice(-limits.problems);
      }
      pending = true;
      // Coalesce writes while IO is busy; memory and queue size remain bounded.
      if (!writing) startWrite();
    },
    async flush() {
      while (writing) await writing;
    },
    // The kept problem history, for Report a problem (already limited to explicit diagnostic fields).
    problems() {
      return data.problems.map((row) => ({ ...row }));
    },
  };
}

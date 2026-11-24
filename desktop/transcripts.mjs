import { readdir, realpath, open, stat } from "node:fs/promises";
import { join, relative, isAbsolute, basename } from "node:path";

// Enumerate names only. Open a header only when the filename identifies this
// session; never scan other conversations' text or nested helper transcripts.
async function walk(root, depth) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const files = [];
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".jsonl")) files.push(join(root, e.name));
    else if (e.isDirectory() && depth > 0 && e.name !== "subagents")
      files.push(...(await walk(join(root, e.name), depth - 1)));
  }
  return files;
}
async function inside(file, root) {
  const [path, base] = await Promise.all([realpath(file), realpath(root)]);
  const local = relative(base, path);
  return local && !local.startsWith("..") && !isAbsolute(local) ? path : null;
}
async function header(file) {
  const f = await open(file, "r");
  try {
    const b = Buffer.alloc(65536);
    const { bytesRead } = await f.read(b, 0, b.length, 0);
    return JSON.parse(b.toString("utf8", 0, bytesRead).split("\n")[0]);
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  } finally {
    await f.close();
  }
}
export async function codexTranscripts(sessionId, codexHome, current) {
  const files = [];
  for (const folder of ["sessions", "archived_sessions"]) {
    const root = join(codexHome, folder);
    for (const file of await walk(root, 3)) {
      const id = basename(file).match(
        /^rollout-.*?(\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_|\.jsonl$)/i,
      )?.[1];
      if (id !== sessionId) continue;
      const path = await inside(file, root);
      if (!path) continue;
      const meta = await header(path);
      if (meta?.type !== "session_meta" || meta.payload?.id !== sessionId)
        continue;
      if (
        typeof meta.payload.source === "object" &&
        meta.payload.source?.subagent
      )
        continue;
      files.push({
        file: path,
        order: String(meta.payload.timestamp || basename(file)),
      });
    }
  }
  files.sort(
    (a, b) => a.order.localeCompare(b.order) || a.file.localeCompare(b.file),
  );
  // The index identifies the active segment even before its first header lands.
  return [
    ...new Set([
      ...files.map((x) => x.file).filter((f) => f !== current),
      ...(current ? [current] : []),
    ]),
  ];
}
export async function claudeTranscripts(ids, projectsRoot) {
  const names = new Set(ids.map((id) => `${id}.jsonl`));
  const files = [];
  for (const file of await walk(projectsRoot, 1)) {
    if (!names.has(basename(file))) continue;
    const path = await inside(file, projectsRoot);
    if (!path) continue;
    const info = await stat(path);
    if (info.isFile())
      files.push({ file: path, order: info.birthtimeMs || info.mtimeMs });
  }
  return [
    ...new Set(
      files
        .sort((a, b) => a.order - b.order || a.file.localeCompare(b.file))
        .map((x) => x.file),
    ),
  ];
}

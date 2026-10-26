import { mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const sources = {
  "desktop/nox-tray.png": "desktop/release/nox-tray.png",
  "desktop/commonplace.png": "desktop/release/commonplace.png",
  "desktop/commonplace.icns": "desktop/release/commonplace.icns",
  "package.json": "desktop/release/package.json",
  "package-lock.json": "desktop/release/package-lock.json",
  "desktop/native/bin/commonplace-target": "desktop/release/commonplace-target",
  "lib/protocol.mjs": "lib/protocol.mjs",
  "lib/nox-motion.mjs": "lib/nox-motion.mjs",
  "lib/session-media.mjs": "lib/session-media.mjs",
};
for (const file of [
  "main.mjs",
  "preload.cjs",
  "collector.mjs",
  "response-boundary.mjs",
  "target.mjs",
  "transcripts.mjs",
  "activity.mjs",
  "claude.mjs",
  "install.mjs",
  "update.mjs",
  "media-tools.mjs",
  "artifact-region.mjs",
  "connect.mjs",
  "drag.mjs",
  "visibility.mjs",
  "visibility-diagnostics.mjs",
  "setup-session.mjs",
  "setup-inbox.mjs",
])
  sources["desktop/" + file] = "desktop/" + file;
const root = "public/companion";
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
const files = [];
for (const [path, source] of Object.entries(sources).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  const content = await readFile(source);
  const target = join(root, "files", path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  files.push({ path, size: content.length, sha256: digest(content) });
}
await writeFile(
  join(root, "manifest.json"),
  JSON.stringify({ version: 1, release: digest(JSON.stringify(files)), files }),
);
await copyFile("desktop/install.mjs", join(root, "install.mjs"));
console.log(`Packaged ${files.length} client-only companion files.`);

// Reads the facts Nox put in a Report a problem link (desktop/problem-report.mjs). The fragment is untrusted:
// anything that doesn't decode to an object is ignored, and the server redacts what is sent.
export function readNoxDetails(hash) {
  const match = /(?:^#|&)nox=([A-Za-z0-9_-]+)/.exec(hash || "");
  if (!match) return null;
  try {
    const binary = atob(match[1].replace(/-/g, "+").replace(/_/g, "/"));
    const value = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))),
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

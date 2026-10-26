"use client";
import { useState } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { readNoxDetails } from "@/lib/problem-report.mjs";
// Report a problem: opened from Nox's menus (with Nox's details in the link's fragment) or from Newron's
// setup and Open Nox dialogs. The person sees everything that is sent before sending it.
const DRAFT = "newron:report-draft";
type Draft = {
  note: string;
  error: string;
  nox: Record<string, unknown> | null;
};
function loadDraft(): Draft | null {
  try {
    return JSON.parse(localStorage.getItem(DRAFT) || "null");
  } catch {
    return null;
  }
}
function saveDraft(draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(DRAFT, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT);
  } catch {
    // The draft is a convenience; sending works without it.
  }
}
export function ReportForm() {
  // Client-only (app/report/page.tsx), so the link and the saved draft are read once, on first render.
  const [initial] = useState(() => {
    const draft = loadDraft();
    const details = readNoxDetails(window.location.hash);
    const nox = details || draft?.nox || null;
    return {
      note: draft?.note || "",
      error: draft?.error || "",
      nox,
      from: nox
        ? "nox"
        : new URLSearchParams(window.location.search).get("from") === "setup"
          ? "setup"
          : "other",
    };
  });
  const [note, setNote] = useState(initial.note);
  const [error, setError] = useState(initial.error);
  const { nox, from } = initial;
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [problem, setProblem] = useState("");
  const [signIn, setSignIn] = useState(false);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    setProblem("");
    setSignIn(false);
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: from,
          note,
          error,
          nox,
          environment: navigator.userAgent,
        }),
      });
      if (response.status === 401) {
        saveDraft({ note, error, nox });
        setSignIn(true);
        setStatus("idle");
        return;
      }
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "Could not send. Try again.");
      saveDraft(null);
      setStatus("sent");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not send. Try again.");
      setStatus("idle");
    }
  }
  return (
    <main className="report-page">
      <div className="report-card">
        <Image
          className="setup-mark"
          src="/nox.svg"
          alt=""
          width={56}
          height={56}
        />
        <h1>Report a problem</h1>
        {status === "sent" ? (
          <p className="report-lead" role="status">
            Sent. Thanks, we&apos;ll take a look.
          </p>
        ) : (
          <form className="form" onSubmit={send}>
            <p className="report-lead">
              Tell us what went wrong with Nox or setup. Only what you see here
              is sent.
            </p>
            <label>
              What happened?
              <textarea
                required
                minLength={3}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="I clicked Nox and nothing appeared."
              />
            </label>
            <label>
              Error message <span>optional</span>
              <textarea
                maxLength={4000}
                value={error}
                onChange={(e) => setError(e.target.value)}
                placeholder="Paste anything Nox or your agent showed."
              />
            </label>
            {nox && (
              <details className="report-nox">
                <summary>Details from Nox, sent with your report</summary>
                <pre>{JSON.stringify(nox, null, 2)}</pre>
              </details>
            )}
            {signIn && (
              <p className="form-error" role="alert">
                Sign in to Newron in this browser, then open this page again.
                Your report is saved here. <a href="/sign-in">Sign in</a>
              </p>
            )}
            {problem && (
              <p className="form-error" role="alert">
                {problem}
              </p>
            )}
            <button
              className="button primary"
              type="submit"
              disabled={status === "sending" || note.trim().length < 3}
            >
              {status === "sending" ? (
                <Loader2 size={14} className="spin" aria-hidden="true" />
              ) : null}
              {status === "sending" ? "Sending…" : "Send report"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

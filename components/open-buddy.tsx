"use client";
import { buddyLink } from "@/lib/brand.mjs";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { Modal } from "./modal";

const Nox = dynamic(() => import("./nox").then((module) => module.Nox), {
  ssr: false,
});

export function OpenBuddy({ onSetup }: { onSetup: () => void }) {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    // A protocol handoff has no browser acknowledgement. Offer a retry after
    // the cold-start window without claiming that the desktop app opened.
    const timer = window.setTimeout(() => setOpening(false), 8000);
    return () => window.clearTimeout(timer);
  }, [open, attempt]);
  function launch() {
    setOpening(true);
    setAttempt((value) => value + 1);
    // This link only opens the installed app. It never pairs or subscribes.
    window.location.href = buddyLink(window.location.origin);
  }
  return (
    <>
      <button
        className="text-button open-buddy"
        onClick={() => {
          setOpen(true);
          launch();
        }}
      >
        Open Nox
      </button>
      {open && (
        <Modal
          title={opening ? "Opening Nox…" : "Open Nox"}
          className="nox-launch-dialog"
          onClose={() => setOpen(false)}
        >
          <span className="nox-launch-mark">
            <Nox size={48} />
          </span>
          <p className="nox-launch-description" role="status">
            {opening
              ? "Allow your browser to open Nox. Starting up may take a few seconds."
              : "Nothing appeared? Try again, or set up Nox."}
          </p>
          {!opening && (
            <a className="nox-launch-report text-button" href="/report">
              Still stuck? Report a problem
            </a>
          )}
          <div className="nox-launch-actions">
            <button
              className="text-button"
              onClick={() => {
                setOpen(false);
                onSetup();
              }}
            >
              Set up Nox
            </button>
            <button
              className="button primary"
              onClick={launch}
              disabled={opening}
            >
              {opening ? "Opening…" : "Try again"}
              {opening ? (
                <Loader2 size={14} className="spin" aria-hidden="true" />
              ) : (
                <ArrowUpRight size={14} aria-hidden="true" />
              )}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

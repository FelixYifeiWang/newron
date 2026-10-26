"use client";
import { useEffect, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import Image from "next/image";
import { readSetupTicket, saveSetupTicket } from "@/lib/setup-progress.mjs";
import { Modal } from "./modal";
type Ticket = { link: string; setupId: string; expiresAt: number };
export function SetupDialog({
  mode,
  demo,
  onClose,
  onConnect,
  account,
  onReady,
  onWaiting,
}: {
  mode: "setup" | "connect";
  demo: boolean;
  onClose: () => void;
  onConnect: () => void;
  account: string;
  onReady: () => void;
  onWaiting: (waiting: boolean) => void;
}) {
  const storageKey = `newron.setup:${account}:${mode}`;
  const storage = () => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  };
  const [ticket, setTicket] = useState<Ticket | null>(() =>
    readSetupTicket(storage(), storageKey),
  );
  const [status, setStatus] = useState(ticket ? "waiting" : "idle");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!ticket || demo || status !== "waiting") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (Date.now() >= ticket!.expiresAt) {
          saveSetupTicket(storage(), storageKey, null);
          onWaiting(false);
          setStatus("expired");
          setTicket(null);
          return;
        }
        const r = await fetch(`/api/setup?id=${ticket!.setupId}`, {
          cache: "no-store",
        });
        const result = (await r.json()) as { status?: string; error?: string };
        if (cancelled) return;
        if (!r.ok)
          throw new Error(result.error || "Could not check setup. Try again.");
        if (result.status === "ready") {
          saveSetupTicket(storage(), storageKey, null);
          onReady();
          setStatus("ready");
          setError("");
          return;
        }
        if (result.status === "expired") {
          saveSetupTicket(storage(), storageKey, null);
          onWaiting(false);
          setStatus("expired");
          setTicket(null);
          return;
        }
        setError("");
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not check setup.");
      }
      if (!cancelled) timer = setTimeout(poll, 2500);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ticket, demo, status, storageKey, onReady, onWaiting]);
  async function copy() {
    setStatus("copying");
    setError("");
    try {
      let next = ticket;
      if (!next || next.expiresAt <= Date.now()) {
        if (demo) throw new Error("Open your own space to set up Nox.");
        const r = await fetch("/api/setup", { method: "POST" });
        const result = (await r.json()) as Ticket & { error?: string };
        if (!r.ok) throw new Error(result.error || "Could not start setup.");
        next = result as Ticket;
        setTicket(next);
      }
      const link =
        mode === "setup"
          ? next.link
          : next.link.replace("/setup.md#", "/connect#");
      await navigator.clipboard.writeText(
        `${mode === "setup" ? "Set up" : "Connect"} ${link}`,
      );
      saveSetupTicket(storage(), storageKey, next);
      onWaiting(mode === "setup");
      setStatus("waiting");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not copy. Try again.");
      setStatus("idle");
    }
  }
  const ready = status === "ready";
  return (
    <Modal
      title={
        ready
          ? mode === "setup"
            ? "Nox ready"
            : "Session connected"
          : mode === "setup"
            ? "Set up Nox"
            : "Connect a session"
      }
      onClose={onClose}
      className="setup-dialog"
    >
      <Image
        className="setup-mark"
        src="/nox.svg"
        alt=""
        width={56}
        height={56}
      />
      {ready ? (
        <>
          <p className="setup-description">
            {mode === "setup"
              ? "Open a project conversation. Move Nox over it, then choose Connect."
              : "Your collection will update as you work."}
          </p>
          <button className="button primary full" onClick={onClose}>
            Done
          </button>
          {mode === "setup" && (
            <button
              className="setup-alternative text-button"
              onClick={onConnect}
            >
              Using Cursor or a terminal? Connect with a prompt
            </button>
          )}
        </>
      ) : (
        <>
          <p className="setup-description">
            {mode === "setup"
              ? status === "waiting"
                ? "Paste into a coding agent on your Mac. Approve setup if asked, then wait for Nox ready."
                : "Paste into Codex, Claude Code or Cursor on your Mac. Your agent will install and open Nox."
              : "Paste this prompt into the conversation you want to save. Anyone with the collection link can view it."}
          </p>
          {status === "waiting" && (
            <div className="setup-waiting" role="status">
              <Loader2 size={16} className="spin" />
              <span>
                {mode === "setup"
                  ? "Waiting for Nox"
                  : "Connecting your session"}
                <span>
                  {mode === "setup"
                    ? "Connect becomes available when setup finishes."
                    : "Your collection will appear when it is ready."}
                </span>
              </span>
            </div>
          )}
          <button
            className={
              status === "waiting"
                ? "button setup-recopy full"
                : "button primary full"
            }
            onClick={() => void copy()}
            disabled={status === "copying"}
          >
            {status === "copying" ? (
              <Loader2 size={15} className="spin" />
            ) : status === "waiting" ? (
              <Check size={15} />
            ) : (
              <Copy size={15} />
            )}
            {status === "waiting"
              ? "Copy again"
              : status === "expired"
                ? "Copy a new prompt"
                : "Copy prompt"}
          </button>
          <p className="setup-progress" role="status">
            {status === "waiting" ? (
              <>
                {mode === "setup"
                  ? "Keep this page open. You can also return later."
                  : "Waiting for your agent…"}
              </>
            ) : status === "expired" ? (
              "This prompt expired. Copy a new one."
            ) : mode === "setup" ? (
              "macOS · one-time setup"
            ) : (
              "Codex · Claude Code · Cursor"
            )}
          </p>
          <a
            className="setup-alternative text-button"
            href={`/report?from=${mode === "setup" ? "setup" : "other"}`}
          >
            Having trouble? Report a problem
          </a>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

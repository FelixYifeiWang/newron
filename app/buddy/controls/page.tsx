"use client";
import { useEffect, useState } from "react";
import { Check, Plus, Star, Loader2 } from "lucide-react";
type State = {
  revision?: number;
  connected?: boolean;
  setupPending?: boolean;
  candidateTitle: string;
  candidateHint?: string;
  candidateConnected: boolean;
  connecting: boolean;
  expanded: boolean;
  favorites?: { id: string; name: string }[];
};
export default function Controls() {
  const [state, setState] = useState<State | null>(null),
    [copied, setCopied] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  useEffect(() => {
    document.body.classList.add("desktop-buddy-page");
    const receive = (value: State) =>
      setState((old) =>
        !old || (value.revision || 0) >= (old.revision || 0) ? value : old,
      );
    let active = true;
    void window.commonplaceDesktop?.snapshot().then((s) => {
      if (active) receive(s);
    });
    const unsubscribe = window.commonplaceDesktop?.onSnapshot?.(receive);
    return () => {
      active = false;
      unsubscribe?.();
      document.body.classList.remove("desktop-buddy-page");
    };
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!state?.expanded) return null;
  const needsSetup = state.connected === false || !!state.setupPending;
  // No session under Nox: say where to move it rather than showing nothing.
  if (!state.candidateTitle && !needsSetup)
    return state.candidateHint ? (
      <div className="buddy-controls" aria-label="Session controls">
        <p className="buddy-hint" role="status">
          {state.candidateHint}
        </p>
      </div>
    ) : null;
  return (
    <div className="buddy-controls" aria-label="Session controls">
      {(state.candidateTitle ? state.favorites || [] : []).map((collection) => (
        <button
          key={collection.id}
          className="buddy-reference"
          aria-label={`Copy reference: ${collection.name}`}
          disabled={!!busy}
          title={`Copy ${collection.name} as reference`}
          onClick={async () => {
            setBusy(collection.id);
            setError("");
            try {
              await window.commonplaceDesktop?.copyReference?.(collection.id);
              setCopied(collection.id);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not copy.");
            } finally {
              setBusy("");
            }
          }}
        >
          {copied === collection.id ? (
            <Check size={12} />
          ) : busy === collection.id ? (
            <Loader2 size={12} className="spin" />
          ) : (
            <Star size={12} />
          )}
          <span>{copied === collection.id ? "Copied" : collection.name}</span>
        </button>
      ))}
      <button
        className="native-connect"
        title={
          error ||
          (state.connected === false
            ? "Open Newron to set up Nox."
            : state.candidateTitle)
        }
        disabled={
          state.setupPending || state.connecting || state.candidateConnected
        }
        onClick={async () => {
          if (state.connected === false) {
            window.commonplaceDesktop?.openSpace();
            return;
          }
          setError("");
          try {
            await window.commonplaceDesktop?.connect();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not connect.");
          }
        }}
      >
        {state.setupPending || state.connecting ? (
          <Loader2 size={12} className="spin" />
        ) : state.candidateConnected ? (
          <Check size={12} />
        ) : (
          <Plus size={12} />
        )}
        {state.setupPending
          ? "Setting up…"
          : state.connected === false
            ? "Set up Nox"
            : state.connecting
              ? "Connecting"
              : state.candidateConnected
                ? "Connected"
                : "Connect"}
      </button>
      {error && (
        <span className="buddy-control-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

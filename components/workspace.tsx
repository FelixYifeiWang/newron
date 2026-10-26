"use client";
import Image from "next/image";
import Link from "next/link";
import { imageSource } from "@/lib/media-source.mjs";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Plus,
  Unplug,
  Trash2,
  Radio,
  Star,
} from "lucide-react";
import { needsPreview } from "@/lib/preview-policy.mjs";
import type {
  Collection,
  Item,
  ItemKind,
  Session,
  WorkspaceData,
} from "@/lib/types";
import { MAX_FAVORITES, overlayFavorites } from "@/lib/favorites.mjs";
import { workspaceRequests } from "@/lib/workspace-requests.mjs";
import { SAMPLE } from "@/lib/sample";
import { sessionLabel } from "./buddy";
import { MediaDetail } from "./media-card";
import { CollectionPicker } from "./collection-picker";
import { parseBlockInput } from "@/lib/gallery.mjs";
import { Gallery } from "./gallery";
import { SessionView } from "./session-view";
import { MediaCard } from "./media-card";
import { AddBlock } from "./add-block";
import { AccountControls, AccountTransition } from "./account-controls";
import { Modal } from "./modal";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { OpenBuddy } from "./open-buddy";
import { SetupDialog } from "./setup-dialog";
import { RecentlyDeleted } from "./recently-deleted";
import { itemAvailable } from "@/lib/item-retention.mjs";
import {
  readWorkspaceNavigation,
  workspaceNavigationUrl,
} from "@/lib/workspace-navigation.mjs";

function ActionHint({
  text,
  children,
}: {
  text: string;
  children: React.ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        className="session-action-tooltip"
        side="top"
        sideOffset={8}
      >
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

const EMPTY: WorkspaceData = {
  collections: [],
  sessions: [],
  items: [],
  devices: [],
  user: null,
};
async function requestApi<T = Record<string, unknown>>(
  path: string,
  method = "GET",
  body?: unknown,
) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("Please sign in to connect your space.");
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function Logo() {
  return (
    <Image src="/nox.svg" alt="" width={34} height={34} className="brand-nox" />
  );
}
function Provider({ name }: { name: string }) {
  return (
    <span
      className={`provider-icon provider-${name.toLowerCase().replace(" ", "-")}`}
      aria-hidden="true"
    >
      {name === "Claude Code"
        ? "✳"
        : name === "Codex"
          ? "⌘"
          : name === "Cursor"
            ? "◈"
            : "↗"}
    </span>
  );
}

export default function Workspace({
  initialDemo = false,
}: {
  initialDemo?: boolean;
}) {
  const demo = initialDemo;
  const [data, setData] = useState<WorkspaceData>(() =>
      initialDemo ? structuredClone(SAMPLE) : EMPTY,
    ),
    [ready, setReady] = useState(initialDemo),
    [error, setError] = useState("");
  const [selected, setSelected] = useState(initialDemo ? "c1" : "all"),
    [screen, setScreen] = useState<"collection" | "trash" | "settings">(
      "collection",
    );
  const [modal, setModal] = useState<
      "setup" | "connect" | "collection" | "item" | null
    >(null),
    [detail, setDetail] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [modalError, setModalError] = useState("");
  const [disconnectSession, setDisconnectSession] = useState<Session | null>(
    null,
  );
  const [allowIncomplete, setAllowIncomplete] = useState(false);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const [disconnectError, setDisconnectError] = useState("");
  // Dev mode reveals the item grid and guided map for this workspace visit.
  const [view, setView] = useState<"gallery" | "map" | "story">("map");
  const [devMode, setDevMode] = useState(false);
  const [navigationReady, setNavigationReady] = useState(false);
  useEffect(() => {
    const restore = () => {
      const state = readWorkspaceNavigation(window.location.href, demo);
      setSelected(state.selected);
      setScreen(state.screen as "collection" | "trash" | "settings");
      setView(state.view as "gallery" | "map" | "story");
      setDevMode(state.devMode);
      setNavigationReady(true);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [demo]);
  useEffect(() => {
    if (!navigationReady) return;
    const url = workspaceNavigationUrl(window.location.href, {
      selected,
      screen,
      view,
      devMode,
    });
    if (
      url !==
      window.location.pathname + window.location.search + window.location.hash
    ) {
      window.history.replaceState(window.history.state, "", url);
    }
  }, [navigationReady, selected, screen, view, devMode]);

  useEffect(() => {
    const toggleDevMode = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "g" &&
        !target.closest("input,textarea,[contenteditable=true]")
      ) {
        event.preventDefault();
        if (event.repeat) return;
        setView(devMode ? "map" : "gallery");
        setDevMode(!devMode);
      }
    };
    window.addEventListener("keydown", toggleDevMode);
    return () => window.removeEventListener("keydown", toggleDevMode);
  }, [devMode]);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [droppedText, setDroppedText] = useState("");
  const [undo, setUndo] = useState<{
    kind: "items" | "collection";
    ids: string[];
    previous?: WorkspaceData;
  } | null>(null);
  const requests = useRef(workspaceRequests());
  async function api<T = Record<string, unknown>>(
    path: string,
    method = "GET",
    body?: unknown,
  ) {
    const finish = method === "GET" ? null : requests.current.mutate();
    try {
      return await requestApi<T>(path, method, body);
    } finally {
      finish?.();
    }
  }
  const favoriteRevision = useRef(0);
  const favoritePending = useRef(new Map<string, boolean>());
  const previewBusy = useRef(false);
  const refresh = useCallback(async () => {
    const ticket = requests.current.read();
    if (ticket === null) return;
    const revision = favoriteRevision.current;
    try {
      const result = await requestApi<WorkspaceData>("/api/workspace");
      if (!requests.current.current(ticket)) return;
      setSelected((id) =>
        id === "all" || result.collections.some((c) => c.id === id)
          ? id
          : "all",
      );
      setData((current) =>
        overlayFavorites(
          revision === favoriteRevision.current
            ? result
            : {
                ...result,
                collections: result.collections.map((c) => ({
                  ...c,
                  favorite:
                    current.collections.find((old) => old.id === c.id)
                      ?.favorite ?? c.favorite,
                })),
              },
          favoritePending.current,
        ),
      );
      setError("");
    } catch (e) {
      if (requests.current.current(ticket))
        setError(e instanceof Error ? e.message : "Unable to load your space.");
    } finally {
      if (requests.current.current(ticket)) setReady(true);
      requests.current.complete(ticket);
    }
  }, []);
  useEffect(() => {
    if (demo) return;
    const coordinator = requests.current;
    const timer = setTimeout(() => void refresh(), 0);
    return () => {
      clearTimeout(timer);
      coordinator.invalidate();
    };
  }, [demo, refresh]);
  useEffect(() => {
    if (demo) return;
    const id = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [demo, refresh]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(
      () => {
        setToast("");
        setUndo(null);
      },
      undo ? 15000 : 3500,
    );
    return () => clearTimeout(id);
  }, [toast, undo]);
  useEffect(() => {
    if (demo || previewBusy.current) return;
    const pending = data.items
      .filter(
        (item) =>
          needsPreview(item) &&
          !data.collections.find((c) => c.id === item.collectionId)?.frozenAt,
      )
      .slice(0, 4);
    if (!pending.length) return;
    previewBusy.current = true;
    void requestApi("/api/previews", "POST", {
      ids: pending.map((item) => item.id),
    })
      .then(() => refresh())
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Preview unavailable."),
      )
      .finally(() => {
        previewBusy.current = false;
      });
  }, [data.items, data.collections, demo, refresh]);
  const collections = [...data.collections].sort(
    (a, b) =>
      Number(!!b.favorite) - Number(!!a.favorite) ||
      b.createdAt.localeCompare(a.createdAt),
  );
  const writableCollections = collections.filter((c) => !c.frozenAt);
  const frozen = !!collections.find((c) => c.id === selected)?.frozenAt;
  const hasBuddy = data.devices.some(
    (device) => !device.revoked && !!device.readyAt,
  );
  const [setupWaiting, setSetupWaiting] = useState(false);
  const setupReady = useCallback(() => {
    setSetupWaiting(false);
    void refresh();
  }, [refresh, setSetupWaiting]);
  const connectionLabel = hasBuddy ? "Connect a session" : "Set up Nox";
  const allItems =
    selected === "all"
      ? data.items
      : data.items.filter((i) => i.collectionId === selected);
  const visibleItems = [...allItems].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  function openModal(value: typeof modal) {
    setDroppedFiles([]);
    setDroppedText("");
    setModalError("");
    setModal(value === "connect" && !hasBuddy ? "setup" : value);
  }
  function chooseCollection(id: string) {
    setSelected(id);
    setScreen("collection");
  }
  async function sessionAction(
    session: Session,
    action: "pause" | "resume" | "revoke",
    allowIncomplete = false,
  ) {
    try {
      if (demo) {
        setData((d) => ({
          ...d,
          collections:
            action === "revoke"
              ? d.collections.map((c) =>
                  c.id === session.collectionId
                    ? { ...c, frozenAt: new Date().toISOString() }
                    : c,
                )
              : d.collections,
          sessions: d.sessions.map((s) =>
            s.id === session.id
              ? {
                  ...s,
                  state:
                    action === "pause"
                      ? "paused"
                      : action === "revoke"
                        ? "revoked"
                        : "following",
                }
              : s,
          ),
        }));
      } else {
        await api("/api/sessions", "PATCH", {
          id: session.id,
          action,
          allowIncomplete,
        });
        await refresh();
      }
      setToast(
        action === "pause"
          ? "Session paused."
          : action === "resume"
            ? "Resumed. Catching up on missed updates."
            : "Disconnected. Your collection is saved.",
      );
      return true;
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not update session.";
      if (action === "revoke") {
        setDisconnectError(message);
        if (message.startsWith("Map or Story is unfinished"))
          setDisconnectSession((s) =>
            s ? { ...s, snapshotUnfinished: true } : s,
          );
      } else setToast(message);
      return false;
    }
  }
  async function createCollection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setModalError("");
    try {
      const payload = {
        name: String(form.get("name")),
        description: String(form.get("description")),
      };
      if (demo) {
        const c = {
          ...payload,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        };
        setData((d) => ({ ...d, collections: [...d.collections, c] }));
        setSelected(c.id);
      } else {
        const c = await api<Collection>("/api/collections", "POST", payload);
        await refresh();
        setSelected(c.id);
      }
      setModal(null);
      setScreen("collection");
      setToast("A new place to collect.");
    } catch (e) {
      setModalError(
        e instanceof Error ? e.message : "Could not create collection.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveBlock(payload: Record<string, unknown>) {
    if (demo) {
      if (payload.fileKey)
        throw new Error("Use your local space to upload files.");
      const now = new Date().toISOString();
      const item = {
        ...payload,
        id: crypto.randomUUID(),
        sessionId: null,
        kind: payload.kind as ItemKind,
        imageUrl: null,
        sourceText: String(payload.body || payload.url || payload.title),
        sourceRole: "user",
        sourceTurn: "",
        inferred: false,
        createdAt: now,
        updatedAt: now,
      } as Item;
      setData((d) => ({ ...d, items: [item, ...d.items] }));
    } else {
      await api("/api/items", "POST", payload);
      await refresh();
    }
  }
  async function deleteBlocks(ids: string[]) {
    if (
      data.items.some(
        (item) =>
          ids.includes(item.id) &&
          collections.find((c) => c.id === item.collectionId)?.frozenAt,
      )
    )
      throw new Error("This collection is frozen.");
    const previous = demo ? structuredClone(data) : undefined;
    if (!demo) await api("/api/items", "DELETE", { ids });
    setData((d) => ({
      ...d,
      recentlyDeleted: [
        ...d.items
          .filter((i) => ids.includes(i.id))
          .map((i) => ({
            ...i,
            deletedAt: new Date().toISOString(),
            collectionName: d.collections.find((c) => c.id === i.collectionId)
              ?.name,
          })),
        ...(d.recentlyDeleted || []),
      ],
      items: d.items.filter((i) => !ids.includes(i.id)),
    }));
    setDetail(null);
    setUndo({ kind: "items", ids, previous });
    setToast(`${ids.length} ${ids.length === 1 ? "block" : "blocks"} deleted`);
  }
  async function restoreItem(item: Item) {
    if (!demo) {
      await api("/api/items", "PATCH", { action: "restore", ids: [item.id] });
      await refresh();
    } else
      setData((d) => ({
        ...d,
        items: [{ ...item, deletedAt: null }, ...d.items],
        recentlyDeleted: (d.recentlyDeleted || []).filter(
          (i) => i.id !== item.id,
        ),
      }));
    setDetail(null);
    setToast("Item restored");
  }
  async function favoriteCollection(collection: Collection) {
    if (favoritePending.current.has(collection.id)) return;
    const favorite = !collection.favorite;
    if (
      favorite &&
      data.collections.filter((c) => c.favorite).length >= MAX_FAVORITES
    ) {
      setToast("You can star up to five collections.");
      return;
    }
    favoriteRevision.current++;
    favoritePending.current.set(collection.id, favorite);
    setData((d) => overlayFavorites(d, favoritePending.current));
    try {
      if (!demo)
        await api("/api/collections", "PATCH", {
          id: collection.id,
          action: "favorite",
          favorite,
        });
    } catch (e) {
      setData((d) => ({
        ...d,
        collections: d.collections.map((c) =>
          c.id === collection.id
            ? { ...c, favorite: !!collection.favorite }
            : c,
        ),
      }));
      setError(e instanceof Error ? e.message : "Could not save favorite.");
    } finally {
      favoriteRevision.current++;
      favoritePending.current.delete(collection.id);
    }
  }
  async function deleteCollection(id: string) {
    try {
      const previous = demo ? structuredClone(data) : undefined;
      if (!demo) await api("/api/collections", "DELETE", { id });
      setData((d) => ({
        ...d,
        deletedCollections: [
          ...d.collections
            .filter((c) => c.id === id)
            .map((c) => ({
              ...c,
              deletedAt: new Date().toISOString(),
              frozenAt: c.frozenAt,
              resumeOnRestore: d.sessions.some(
                (s) =>
                  s.collectionId === id &&
                  !["paused", "revoked", "complete"].includes(s.state),
              ),
            })),
          ...(d.deletedCollections || []).filter((c) => c.id !== id),
        ],
        collections: d.collections.filter((c) => c.id !== id),
        items: d.items.filter((i) => i.collectionId !== id),
        sessions: d.sessions.filter((s) => s.collectionId !== id),
      }));
      if (selected === id) chooseCollection("all");
      setUndo({ kind: "collection", ids: [id], previous });
      setToast("Collection moved to Trash");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Could not delete collection.");
    }
  }
  async function restoreCollection(collection: Collection) {
    if (!demo) {
      await api("/api/collections", "PATCH", {
        action: "restore",
        id: collection.id,
      });
      await refresh();
    } else {
      const previous = undo?.previous;
      setData((d) => ({
        ...d,
        collections: [
          ...d.collections,
          { ...collection, deletedAt: null, favorite: false },
        ],
        deletedCollections: (d.deletedCollections || []).filter(
          (c) => c.id !== collection.id,
        ),
        items: [
          ...d.items,
          ...(previous?.items || []).filter(
            (i) => i.collectionId === collection.id,
          ),
        ],
        sessions: [
          ...d.sessions,
          ...(previous?.sessions || []).filter(
            (s) => s.collectionId === collection.id,
          ),
        ],
      }));
    }
    setUndo(null);
    setToast("Collection restored.");
  }
  async function permanentlyDelete(
    target: Collection | Item,
    kind: "collection" | "item",
  ) {
    if (!demo) {
      await api(
        kind === "collection" ? "/api/collections" : "/api/items",
        "DELETE",
        kind === "collection"
          ? { id: target.id, permanent: true }
          : { ids: [target.id], permanent: true },
      );
      await refresh();
    } else
      setData((d) => ({
        ...d,
        deletedCollections: (d.deletedCollections || []).filter(
          (c) => kind !== "collection" || c.id !== target.id,
        ),
        recentlyDeleted: (d.recentlyDeleted || []).filter((i) =>
          kind === "collection"
            ? i.collectionId !== target.id
            : i.id !== target.id,
        ),
      }));
    setUndo(null);
    setDetail(null);
    setToast("Permanently deleted.");
  }
  async function undoDelete() {
    if (!undo) return;
    try {
      if (undo.kind === "collection") {
        const collection = data.deletedCollections?.find(
          (c) => c.id === undo.ids[0],
        );
        if (collection) {
          await restoreCollection(collection);
          return;
        }
      }
      if (demo && undo.previous) setData(undo.previous);
      else {
        await api(
          undo.kind === "items" ? "/api/items" : "/api/collections",
          "PATCH",
          {
            action: "restore",
            ...(undo.kind === "items"
              ? { ids: undo.ids }
              : { id: undo.ids[0] }),
          },
        );
        await refresh();
      }
      setToast(
        undo.kind === "collection" ? "Collection restored" : "Blocks restored",
      );
      setUndo(null);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Could not restore.");
    }
  }
  function addFromGallery(drop?: { files?: File[]; text?: string }) {
    if (frozen) return;
    if (!writableCollections.length) {
      openModal("collection");
      return;
    }
    setDroppedFiles(drop?.files || []);
    setDroppedText(drop?.text || "");
    setModal("item");
  }
  function renderSession(session: Session, compact = false) {
    const count = data.items.filter((i) => i.sessionId === session.id).length;
    return (
      <div
        className={`session-row ${compact ? "compact" : ""}`}
        data-session-id={session.id}
        key={session.id}
      >
        <Provider name={session.provider} />
        <div className="session-row-main">
          <button
            className="session-collection-link"
            onClick={() => chooseCollection(session.collectionId)}
          >
            {collections.find((c) => c.id === session.collectionId)?.name ||
              session.title}
          </button>
          <span>
            {session.provider}
            <i>·</i>
            {count} {count === 1 ? "idea" : "ideas"} collected
          </span>
        </div>
        <span className={`session-status ${session.state}`}>
          <i />
          {sessionLabel(
            session.state,
            demo ? new Date().toISOString() : session.lastSeen,
          )}
        </span>
        <TooltipProvider delayDuration={650} skipDelayDuration={0}>
          <div className="session-actions">
            {session.state !== "revoked" && (
              <>
                <ActionHint
                  text={
                    session.state === "paused"
                      ? "Resume and catch up on missed updates."
                      : "Pause syncing. Resume catches up."
                  }
                >
                  <button
                    className="icon-button"
                    aria-label={`${session.state === "paused" ? "Resume" : "Pause"} ${session.title}`}
                    onClick={() =>
                      void sessionAction(
                        session,
                        session.state === "paused" ? "resume" : "pause",
                      )
                    }
                  >
                    {session.state === "paused" ? (
                      <Play size={14} />
                    ) : (
                      <Pause size={14} />
                    )}
                  </button>
                </ActionHint>
                <ActionHint text="Stop updates. Keep a frozen copy.">
                  <button
                    className="icon-button session-disconnect"
                    aria-label={`Disconnect ${session.title}`}
                    onClick={() => {
                      setDisconnectError("");
                      setAllowIncomplete(false);
                      setDisconnectSession(session);
                    }}
                  >
                    <Unplug size={14} />
                  </button>
                </ActionHint>
              </>
            )}
            <ActionHint text="Pause and move to Trash for 30 days.">
              <button
                className="icon-button session-delete"
                aria-label={`Delete ${collections.find((c) => c.id === session.collectionId)?.name || session.title}`}
                onClick={() => void deleteCollection(session.collectionId)}
              >
                <Trash2 size={14} />
              </button>
            </ActionHint>
          </div>
        </TooltipProvider>
      </div>
    );
  }

  const itemGrid = (
    <Gallery
      key={selected}
      items={visibleItems}
      onOpen={setDetail}
      onDelete={deleteBlocks}
      readOnly={frozen}
      canAdd={writableCollections.length > 0}
      onQuickAdd={(text) =>
        saveBlock({
          ...parseBlockInput(text),
          collectionId:
            selected === "all" ? writableCollections[0]?.id : selected,
        })
      }
      onAdd={addFromGallery}
    />
  );
  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        if (!modal) e.preventDefault();
      }}
      onDrop={(e) => {
        if (modal || frozen || !writableCollections.length) return;
        e.preventDefault();
        setDroppedFiles(Array.from(e.dataTransfer.files));
        setDroppedText(
          e.dataTransfer.files.length
            ? ""
            : e.dataTransfer.getData("text/uri-list") ||
                e.dataTransfer.getData("text/plain"),
        );
        setModal("item");
      }}
    >
      <div className="workspace">
        <header className="minimal-header">
          <button
            className="minimal-home"
            aria-label="All collections"
            onClick={() => chooseCollection("all")}
          >
            <Logo />
          </button>
          {/* One black pill holds the collection and its views. */}
          <nav className="pill-nav" aria-label="Collection">
            <CollectionPicker
              collections={collections}
              selected={selected}
              screen={screen}
              onChoose={chooseCollection}
              onManage={setScreen}
              onFavorite={(c) => void favoriteCollection(c)}
              onDelete={(id) => void deleteCollection(id)}
            />
            {screen === "collection" && selected !== "all" && (
              <div
                className="channel-view-switch"
                role="group"
                aria-label="Collection view"
              >
                {(devMode
                  ? (["gallery", "map", "story"] as const)
                  : (["map", "story"] as const)
                ).map((option) => (
                  <button
                    key={option}
                    aria-pressed={view === option}
                    onClick={() => setView(option)}
                  >
                    {option[0].toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </nav>
          {demo && (
            <Link className="minimal-demo" href="/">
              Example
            </Link>
          )}
          <div className="workspace-actions">
            {!demo &&
              ready &&
              data.user &&
              (hasBuddy ? (
                <OpenBuddy onSetup={() => openModal("setup")} />
              ) : (
                <button
                  className="text-button open-buddy"
                  onClick={() => openModal("setup")}
                >
                  {setupWaiting ? "Setting up Nox…" : "Set up Nox"}
                </button>
              ))}
            {devMode && (screen !== "collection" || selected === "all") && (
              <button
                className="button new-collection"
                onClick={() => openModal("collection")}
              >
                <Plus size={16} strokeWidth={1.5} />
                <span>New collection</span>
              </button>
            )}
          </div>
        </header>
        {!demo &&
          process.env.NEXT_PUBLIC_ACCOUNTS_ENABLED === "1" &&
          data.user && <AccountTransition onLinked={refresh} />}
        <main
          className={
            screen === "collection" && view === "map" && selected !== "all"
              ? "map-main"
              : undefined
          }
        >
          {!ready || !navigationReady ? (
            <div className="loading-state">
              <Loader2 className="spin" size={18} aria-label="Loading" />
            </div>
          ) : error && !data.user ? (
            <div className="welcome">
              <a className="button primary" href="/sign-in" target="_top">
                {process.env.NEXT_PUBLIC_HOSTED === "1"
                  ? "Sign in"
                  : "Continue with ChatGPT"}{" "}
                <ArrowRight size={15} />
              </a>
            </div>
          ) : (
            <>
              {error && (
                <div className="error-banner" role="alert">
                  {error}
                  <button onClick={() => void refresh()}>Try again</button>
                </div>
              )}
              {screen === "collection" && !collections.length && !demo && (
                <div className="welcome first-collection">
                  <Image
                    className="welcome-nox"
                    src="/nox.svg"
                    alt=""
                    width={72}
                    height={72}
                  />
                  <h1>Your first collection</h1>
                  <p>
                    {devMode
                      ? "Add things yourself, or connect a session with Nox."
                      : "Meet Nox, your desktop companion. Save ideas from a working session as you go."}
                  </p>
                  <div className="first-collection-actions">
                    {devMode && (
                      <button
                        className="button primary"
                        onClick={() => openModal("collection")}
                      >
                        Create collection
                      </button>
                    )}
                    {hasBuddy ? (
                      <OpenBuddy onSetup={() => openModal("setup")} />
                    ) : (
                      <button
                        className="button primary"
                        onClick={() => openModal("setup")}
                      >
                        {setupWaiting ? "Continue setup" : "Set up Nox"}
                        <ArrowUpRight size={15} />
                      </button>
                    )}
                  </div>
                </div>
              )}
              {screen === "collection" &&
                selected !== "all" &&
                (view === "gallery" ? (
                  itemGrid
                ) : (
                  <SessionView
                    key={`${selected}-${view}`}
                    collectionId={selected}
                    name={
                      collections.find((c) => c.id === selected)?.name ||
                      "Untitled"
                    }
                    mode={view === "map" ? "gallery" : "story"}
                    devMode={devMode}
                    items={[
                      ...visibleItems,
                      ...(data.recentlyDeleted || []).filter(
                        (i) => i.collectionId === selected && itemAvailable(i),
                      ),
                    ]}
                    onOpen={setDetail}
                    demo={demo}
                  />
                ))}
              {screen === "collection" &&
                selected === "all" &&
                collections.length > 0 && (
                  <div className="collection-overview">
                    {collections.map((collection) => {
                      const covers = data.items
                        .filter(
                          (item) =>
                            item.collectionId === collection.id &&
                            !!imageSource(item),
                        )
                        .slice(0, 3);
                      return (
                        <div
                          className="collection-overview-card"
                          key={collection.id}
                        >
                          <button
                            className="collection-cover"
                            onClick={() => chooseCollection(collection.id)}
                          >
                            <span className="collection-cover-sheet soft-sheet">
                              {covers.length ? (
                                covers.map((item) => (
                                  <span key={item.id}>
                                    <MediaCard
                                      item={item}
                                      screenshots={false}
                                    />
                                  </span>
                                ))
                              ) : (
                                <span className="collection-cover-empty">
                                  {collection.name.slice(0, 1)}
                                </span>
                              )}
                            </span>
                            <span className="collection-cover-caption">
                              {collection.name}
                              {collection.frozenAt && (
                                <small
                                  className="collection-frozen-label"
                                  title="Disconnected. Saved content stays unchanged."
                                >
                                  <Unplug size={12} aria-hidden="true" />
                                  Disconnected
                                </small>
                              )}
                            </span>
                          </button>
                          <button
                            className="collection-favorite"
                            aria-label={`${collection.favorite ? "Unfavorite" : "Favorite"} ${collection.name}`}
                            aria-pressed={!!collection.favorite}
                            onClick={() => void favoriteCollection(collection)}
                          >
                            <Star
                              size={15}
                              fill={
                                collection.favorite ? "currentColor" : "none"
                              }
                            />
                          </button>
                          <button
                            className="collection-overview-delete"
                            aria-label={`Delete ${collection.name}`}
                            title="Pause and move to Trash"
                            onClick={() => void deleteCollection(collection.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              {screen === "trash" && (
                <div className="utility-page">
                  <div className="utility-heading">
                    <h1>Trash</h1>
                  </div>
                  <RecentlyDeleted
                    collections={data.deletedCollections || []}
                    onRestoreCollection={restoreCollection}
                    items={data.recentlyDeleted || []}
                    onOpen={setDetail}
                    onRestore={restoreItem}
                    onDeleteCollection={(c) =>
                      permanentlyDelete(c, "collection")
                    }
                    onDeleteItem={(i) => permanentlyDelete(i, "item")}
                  />
                </div>
              )}
              {screen === "settings" && (
                <div className="utility-page settings-page">
                  <div className="utility-heading">
                    <h1>Settings</h1>
                  </div>
                  <section className="settings-section">
                    <h2>Account</h2>
                    <div className="setting-row account-row">
                      <span className="space-avatar">
                        {data.user?.displayName.slice(0, 1) || "Y"}
                      </span>
                      <div>
                        <strong>
                          {demo ? "Example space" : data.user?.displayName}
                        </strong>
                        <p>
                          {demo
                            ? "A sample collection. Your real space starts empty."
                            : data.user?.email}
                        </p>
                      </div>
                      {!demo &&
                      process.env.NEXT_PUBLIC_ACCOUNTS_ENABLED === "1" ? (
                        <AccountControls />
                      ) : demo ? (
                        <Link className="button subtle" href="/">
                          Open my space
                        </Link>
                      ) : (
                        <a
                          className="text-button"
                          href="/signout-with-chatgpt?return_to=%2F"
                          target="_top"
                        >
                          Sign out <ArrowUpRight size={13} />
                        </a>
                      )}
                    </div>
                  </section>
                  <section className="settings-section">
                    <div className="section-heading">
                      <h2>
                        Connections{" "}
                        <span
                          className="section-count"
                          aria-label={`${data.sessions.filter((s) => s.state !== "revoked").length} connected sessions`}
                        >
                          {
                            data.sessions.filter((s) => s.state !== "revoked")
                              .length
                          }{" "}
                          connected
                        </span>
                      </h2>
                      <button
                        className="text-button utility-connect"
                        aria-label={connectionLabel}
                        onClick={() => openModal("connect")}
                      >
                        <Plus size={14} />
                        Connect
                      </button>
                    </div>
                    <div className="sessions-table">
                      {data.sessions.length ? (
                        data.sessions.map((s) => renderSession(s))
                      ) : (
                        <div className="empty-sessions">
                          <Radio size={26} strokeWidth={1} />
                          <h3>No sessions</h3>
                          <button
                            className="button subtle"
                            onClick={() => openModal("connect")}
                          >
                            {connectionLabel} <ArrowRight size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                    <a className="text-button settings-report" href="/report">
                      Trouble with Nox or setup? Report a problem
                    </a>
                  </section>
                </div>
              )}
            </>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={14} />
          {toast}
          {undo && <button onClick={() => void undoDelete()}>Undo</button>}
        </div>
      )}
      {(modal === "connect" || modal === "setup") && (
        <SetupDialog
          key={modal}
          mode={modal}
          demo={demo}
          account={data.user?.email || ""}
          onReady={setupReady}
          onWaiting={setSetupWaiting}
          onClose={() => setModal(null)}
          onConnect={() => setModal("connect")}
        />
      )}

      {disconnectSession && (
        <Modal
          title="Disconnect this session?"
          className="disconnect-dialog"
          onClose={() => {
            if (!disconnectBusy) setDisconnectSession(null);
          }}
        >
          <p className="disconnect-copy">
            Keep a frozen copy. Reconnecting starts a new collection.
          </p>
          <p className="disconnect-copy">
            <strong>Cannot be undone.</strong>
          </p>
          {disconnectSession.snapshotUnfinished && (
            <label className="disconnect-incomplete">
              <input
                type="checkbox"
                checked={allowIncomplete}
                onChange={(e) => setAllowIncomplete(e.target.checked)}
              />
              <span>
                Map or Story is unfinished. Freeze the current version.
              </span>
            </label>
          )}
          {disconnectError && (
            <p className="form-error" role="alert">
              {disconnectError}
            </p>
          )}
          <div className="disconnect-actions">
            <button
              className="button"
              data-autofocus
              disabled={disconnectBusy}
              onClick={() => setDisconnectSession(null)}
            >
              Cancel
            </button>
            <button
              className="button primary disconnect-confirm"
              disabled={
                disconnectBusy ||
                (!!disconnectSession.snapshotUnfinished && !allowIncomplete)
              }
              onClick={async () => {
                setDisconnectBusy(true);
                setDisconnectError("");
                const success = await sessionAction(
                  disconnectSession,
                  "revoke",
                  allowIncomplete,
                );
                setDisconnectBusy(false);
                if (success) setDisconnectSession(null);
              }}
            >
              {disconnectBusy ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </Modal>
      )}
      {modal === "collection" && (
        <Modal title="New collection" onClose={() => setModal(null)}>
          <form onSubmit={createCollection} className="form">
            <label>
              Collection name
              <input
                name="name"
                placeholder="Untitled"
                maxLength={100}
                required
                autoFocus
              />
            </label>
            <label>
              Description <span>optional</span>
              <textarea
                name="description"
                placeholder="Description"
                maxLength={500}
              />
            </label>
            {modalError && (
              <p className="form-error" role="alert">
                {modalError}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? "Creating..." : "Create collection"}
              <ArrowRight size={14} />
            </button>
          </form>
        </Modal>
      )}
      {modal === "item" && (
        <AddBlock
          allowFiles={!demo}
          collections={writableCollections}
          collectionId={
            selected === "all" ? writableCollections[0]?.id : selected
          }
          initialFiles={droppedFiles}
          initialText={droppedText}
          onSave={saveBlock}
          onClose={() => setModal(null)}
        />
      )}
      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)} wide>
          {collections.find((c) => c.id === detail.collectionId)
            ?.frozenAt ? null : detail.deletedAt ? (
            <div className="deleted-item-notice">
              <span>Recently deleted</span>
              <button
                className="text-button"
                onClick={() =>
                  void restoreItem(detail).catch((e) => setToast(e.message))
                }
              >
                Restore
              </button>
            </div>
          ) : (
            <button
              className="detail-delete"
              aria-label="Delete block"
              onClick={() =>
                void deleteBlocks([detail.id]).catch((e) => setToast(e.message))
              }
            >
              <Trash2 size={15} />
            </button>
          )}
          <MediaDetail
            item={data.items.find((item) => item.id === detail.id) || detail}
          />
          {detail.inferred && (
            <p className="minimal-inference">AI interpretation</p>
          )}
          {detail.url && (
            <a
              className="text-link"
              href={detail.url}
              target="_blank"
              rel="noreferrer"
            >
              Open original <ExternalLink size={13} />
            </a>
          )}
          <details className="minimal-source">
            <summary>Source</summary>
            <blockquote>{detail.sourceText}</blockquote>
          </details>
        </Modal>
      )}
    </div>
  );
}

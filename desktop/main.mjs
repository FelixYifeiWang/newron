import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  shell,
  screen,
  net,
  Tray,
  Menu,
  nativeImage,
  dialog,
  clipboard,
  session,
  powerMonitor,
} from "electron";
import path from "node:path";
import { createMediaTools } from "./media-tools.mjs";
import { updateNox } from "./update.mjs";
import { createVisibilityPolicy, inspectVisibility } from "./visibility.mjs";
import {
  afterBackgroundSync,
  syncFailureState,
  noxState,
  pointerDirection,
} from "../lib/nox-motion.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveLocalTarget } from "./target.mjs";
import { claudeProjectSource } from "./claude.mjs";
import { consumeSetupRequest, consumeShowRequest } from "./setup-inbox.mjs";
import { connectSession, SUPPORTED_APPS } from "./connect.mjs";
import {
  createDragController,
  createHoverController,
  buddyHoverRegion,
  buddyBounds,
  buddyControlsBounds,
  insideBuddyControls,
  handleBuddyMouse,
  createBuddyHitTest,
} from "./drag.mjs";
const exec = promisify(execFile);
import { createVisibilityDiagnostics } from "./visibility-diagnostics.mjs";
let visibilityDiagnostics;
function recordVisibility(event, detail = {}) {
  const exists = win && !win.isDestroyed();
  visibilityDiagnostics?.record({
    event,
    pid: process.pid,
    revision: visibilityRevision,
    state: {
      expectedVisible: desiredVisible,
      actualVisible: !!exists && win.isVisible(),
      opacity: exists ? win.getOpacity() : 0,
      appHidden: app.isReady() && app.isHidden(),
      manual: visibility.isManual(),
      bounds: exists ? win.getBounds() : null,
      loading:
        !!exists &&
        !win.webContents.isDestroyed() &&
        win.webContents.isLoadingMainFrame(),
    },
    ...detail,
  });
}
const visibility = createVisibilityPolicy();
let visibilityRevision = 0,
  visibilityFade,
  desiredVisible = true;
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = existsSync(path.join(__dirname, "commonplace.png"))
  ? __dirname
  : path.join(__dirname, "release");
const appIcon = path.join(assetsDir, "commonplace.png");
const ORIGIN = process.env.COMMONPLACE_ORIGIN || "http://127.0.0.1:3100";
// An installed Nox runs from <space>/current, which an update moves to a newer verified release.
// A development run (npm run desktop) never updates itself.
const launchedFrom = path.resolve(process.argv[1] || ".");
const installRoot =
  process.env.COMMONPLACE_LAUNCHER === "1" &&
  path.basename(launchedFrom) === "current"
    ? path.dirname(launchedFrom)
    : null;
if (process.env.COMMONPLACE_DATA_DIR) {
  if (!path.isAbsolute(process.env.COMMONPLACE_DATA_DIR))
    throw new Error("Invalid companion storage path.");
  app.setPath("userData", process.env.COMMONPLACE_DATA_DIR);
}
let setupBusy = false,
  setupPending = false;
async function processSetup() {
  try {
    await consumeShowRequest(app.getPath("userData"), showBuddy);
  } catch (error) {
    console.error("Could not reopen Nox:", error.message);
  }
  if (setupBusy || busy) return;
  setupBusy = true;
  setupPending = existsSync(
    path.join(app.getPath("userData"), "setup-request.json"),
  );
  if (setupPending) notifyBuddy();
  try {
    const result = await consumeSetupRequest(app.getPath("userData"), {
      origin: ORIGIN,
      connection,
      pair,
      subscribe: subscribeSource,
      capture: captureSource,
      report: showDropFeedback,
      request,
    });
    if (result?.ok && result.action === "setup") showBuddy();
  } catch (error) {
    lastError = error.message;
    status = "error";
  } finally {
    setupBusy = false;
    if (setupPending) {
      setupPending = false;
      notifyBuddy();
    }
  }
}
let win,
  feedbackWindow,
  feedbackTimer,
  feedbackPoint = { x: 50, y: 50 },
  tray,
  collector,
  connection = null,
  subscriptions = [],
  cursors = {},
  dragController,
  hoverController,
  controlsWindow,
  controlsReady = false,
  favorites = [],
  expanded = false,
  targetTitle = "",
  feedbackMessage = "",
  busy = false,
  status = "waiting",
  lastError = "";
let savedPosition = null,
  candidateRevision = 0,
  stateRevision = 0;
const configPath = () => path.join(app.getPath("userData"), "connection.enc");
const statePath = () =>
  path.join(app.getPath("userData"), "subscriptions.json");
function senderAllowed(event) {
  return new URL(event.senderFrame.url).origin === ORIGIN;
}
function register(name, handler) {
  ipcMain.handle(name, async (event, ...args) => {
    if (!senderAllowed(event)) throw new Error("Untrusted window.");
    return handler(...args);
  });
}
async function persist() {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(
    statePath(),
    JSON.stringify({
      subscriptions,
      cursors,
      position: win && !win.isDestroyed() ? win.getBounds() : savedPosition,
    }),
    {
      mode: 0o600,
    },
  );
}
async function pair({ token, origin, id }) {
  if (origin !== ORIGIN || !/^[a-f0-9]{64}$/.test(token))
    throw new Error("This connection does not belong to the configured space.");
  if (!safeStorage.isEncryptionAvailable())
    throw new Error(
      "Secure credential storage is unavailable on this computer.",
    );
  connection = { origin, token, id };
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(
    configPath(),
    safeStorage.encryptString(JSON.stringify(connection)),
    { mode: 0o600 },
  );
  lastError = "";
  status = "waiting";
}
async function request(url, options) {
  return net.fetch(url, {
    signal: AbortSignal.timeout(15000),
    ...options,
    credentials: "include",
  });
}
async function tick() {
  if (!connection || setupBusy || busy || dragController?.isDragging()) return;
  busy = true;
  try {
    for (const subscription of subscriptions.filter(
      (s) => !s.paused && !s.done,
    )) {
      if (dragController?.isDragging()) break;
      try {
        const result = await collector.syncTranscript({
          connection,
          subscription,
          cursors,
          request,
          media: mediaTools(),
        });
        subscription.turns = result.total;
        subscription.lastSynced = new Date().toISOString();
        subscription.error = "";
        if (subscription.mode === "once" && !subscription.historyRemaining)
          subscription.done = true;
        if (!dragController?.isDragging()) {
          lastError = "";
          status = afterBackgroundSync(status, "following");
        }
        await persist();
      } catch (error) {
        const nextState = syncFailureState(error);
        subscription.error = nextState === "waiting" ? "" : error.message;
        if (!dragController?.isDragging()) {
          lastError = subscription.error;
          status = afterBackgroundSync(status, nextState);
        }
        if (error.status === 401) subscription.paused = true;
        await persist();
      }
    }
  } finally {
    busy = false;
  }
}
const buddyOffsetY = 54;
let candidate = null,
  candidateConnected = false,
  connecting = false;
function anchorPoint() {
  const b = win.getBounds();
  return { x: b.x + 52, y: b.y + buddyOffsetY + 54 };
}
function setExpanded(value) {
  expanded = value;
  notifyBuddy();
}
function notifyBuddy() {
  stateRevision++;
  const visible =
    expanded && !!candidate && !dragController?.hasMoved() && win?.isVisible();
  if (controlsWindow && !controlsWindow.isDestroyed()) {
    if (visible && controlsReady) {
      const point = anchorPoint(),
        area = screen.getDisplayNearestPoint(point).workArea;
      controlsWindow.setBounds(
        buddyControlsBounds(point, favorites.length, area),
        false,
      );
      controlsWindow.showInactive();
    } else controlsWindow.hide();
    controlsWindow.webContents.send("companion:state", buddySnapshot());
  }
  if (win && !win.isDestroyed())
    win.webContents.send("companion:state", buddySnapshot());
}
function showBuddy() {
  recordVisibility("show-request");
  visibility.reveal();
  desiredVisible = true;
  visibilityRevision++;
  clearInterval(visibilityFade);
  if (!win || win.isDestroyed()) return;
  win.setOpacity(1);
  const b = win.getBounds(),
    area = screen.getDisplayMatching(b).workArea;
  if (!win.isVisible())
    win.setPosition(
      Math.round(
        Math.max(area.x, Math.min(b.x, area.x + area.width - b.width)),
      ),
      Math.round(
        Math.max(area.y, Math.min(b.y, area.y + area.height - b.height)),
      ),
      false,
    );
  win.show();
  notifyBuddy();
}
function hideBuddy() {
  recordVisibility("manual-hide-request");
  visibility.hide();
  desiredVisible = false;
  visibilityRevision++;
  clearInterval(visibilityFade);
  hoverController?.reset();
  dragController?.cancel();
  candidateRevision++;
  setExpanded(false);
  win?.hide();
  void persist();
}
function applyVisibility(visible) {
  if (!win || win.isDestroyed()) return;
  clearInterval(visibilityFade);
  recordVisibility("fade-start", { visible });
  if (visible) {
    if (!win.isVisible()) {
      win.setOpacity(0);
      win.showInactive();
    }
  } else {
    candidateRevision++;
    candidate = null;
    hoverController?.reset();
    setExpanded(false);
  }
  const start = win.getOpacity(),
    goal = visible ? 1 : 0,
    began = Date.now();
  visibilityFade = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(visibilityFade);
    // Never hide a drag that began while fading out.
    if (dragController?.isDragging() || connecting) {
      win.setOpacity(1);
      clearInterval(visibilityFade);
      return;
    }
    const progress = Math.min(1, (Date.now() - began) / 180);
    win.setOpacity(start + (goal - start) * progress);
    if (progress === 1) {
      clearInterval(visibilityFade);
      if (!visible) win.hide();
      recordVisibility("fade-finish", { visible });
    }
  }, 16);
}
function buddyMenu() {
  return Menu.buildFromTemplate([
    { label: "Hide Nox", click: hideBuddy },
    {
      label: "Open Newron",
      click: () =>
        shell.openExternal(
          ORIGIN === "https://commonplace-pearl.vercel.app"
            ? "https://newron.app"
            : ORIGIN,
        ),
    },
    { type: "separator" },
    { label: "Quit and stop syncing", click: () => app.quit() },
  ]);
}
function pointerGaze() {
  const cursor = screen.getCursorScreenPoint(),
    bounds = win.getBounds();
  return pointerDirection(
    cursor.x - bounds.x - 52,
    cursor.y - bounds.y - buddyOffsetY - 54,
  );
}
function buddySnapshot() {
  return {
    gaze: pointerGaze(),
    separateControls: true,
    favorites,
    revision: stateRevision,
    dragging: dragController?.hasMoved() || false,
    buddyOffsetY,
    candidateTitle: candidate?.title || "",
    candidateConnected,
    connecting,
    connected: !!connection,
    setupPending,
    expanded,
    targetTitle,
    feedbackMessage,
    feedbackPoint,
    feedbackActive: !!feedbackWindow?.isVisible(),
    subscriptions: subscriptions.map((s) => ({
      id: s.id,
      title: s.title,
      provider: s.provider,
      mode: s.mode,
      paused: s.paused,
      done: s.done,
      turns: s.turns,
      error: s.error,
    })),
    state: noxState({ state: status, connecting }),
    error: lastError,
    origin: ORIGIN,
  };
}
async function inspectPoint(point) {
  const { stdout } = await exec(
    path.join(__dirname, "native/bin/commonplace-target"),
    [String(point.x), String(point.y), String(process.pid)],
    { timeout: 8000, maxBuffer: 64 * 1024 },
  );
  return JSON.parse(stdout);
}
async function findCandidate() {
  const revision = ++candidateRevision;
  lastError = "";
  try {
    const target = await inspectPoint(anchorPoint());
    if (target.error || !SUPPORTED_APPS.has(target.bundleId)) {
      if (revision === candidateRevision) {
        candidate = null;
        candidateConnected = false;
      }
      return;
    }
    const found = await resolveLocalTarget(target);
    const previous =
      found.localSessionId &&
      subscriptions.find((s) => s.localSessionId === found.localSessionId);
    if (previous) found.sessionId = previous.sessionId;
    let connected = false;
    if (connection) {
      const r = await request(
        `${connection.origin}/api/device-session?externalId=${encodeURIComponent(found.sessionId)}&provider=${encodeURIComponent(found.provider)}`,
        { headers: { Authorization: `Bearer ${connection.token}` } },
      );
      if (r.ok) connected = !!(await r.json()).connected;
    }
    if (
      revision === candidateRevision &&
      expanded &&
      !dragController?.isDragging()
    ) {
      candidate = found;
      candidateConnected = connected;
    }
  } catch (e) {
    if (revision === candidateRevision) {
      lastError = e.message;
      candidate = null;
      candidateConnected = false;
    }
  } finally {
    notifyBuddy();
  }
}
async function toggleControls() {
  candidateRevision++;
  candidate = null;
  candidateConnected = false;
  setExpanded(true);
  if (expanded && connection)
    await Promise.all([findCandidate(), refreshFavorites()]);
}
async function refreshFavorites() {
  if (!connection) {
    favorites = [];
    return;
  }
  try {
    const response = await request(
      `${connection.origin}/api/device-favorites`,
      { headers: { Authorization: `Bearer ${connection.token}` } },
    );
    if (!response.ok) {
      favorites = [];
      return;
    }
    const data = await response.json();
    favorites = Array.isArray(data.collections)
      ? data.collections.slice(0, 5)
      : [];
  } catch {
    favorites = [];
  } finally {
    notifyBuddy();
  }
}
async function copyReference(id) {
  if (!connection || !favorites.some((c) => c.id === id))
    throw new Error("Choose a starred collection.");
  const target = await inspectPoint(anchorPoint());
  if (target.error || !SUPPORTED_APPS.has(target.bundleId))
    throw new Error("Open a supported session first.");
  await resolveLocalTarget(target);
  const response = await request(`${connection.origin}/api/device-favorites`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id }),
  });
  if (!response.ok)
    throw new Error("Could not copy this collection. Try again.");
  const data = await response.json();
  if (typeof data.prompt !== "string")
    throw new Error("Reference unavailable.");
  clipboard.writeText(data.prompt);
  return { copied: true };
}
// Nox checks for a newer release shortly after launch and every few hours. After switching, it waits until
// it is not syncing or being dragged, saves its state and exits with an error code, so launchd starts
// the new release through <space>/current (the LaunchAgent restarts Nox on any unsuccessful exit).
let restarting = false;
function restartWhenIdle() {
  if (busy || dragController?.isDragging()) {
    setTimeout(restartWhenIdle, 5000);
    return;
  }
  void persist().finally(() => app.exit(75));
}
async function checkForUpdate() {
  if (!installRoot || restarting) return;
  try {
    const result = await updateNox({
      origin: ORIGIN,
      root: installRoot,
      runtime: path.dirname(__dirname),
    });
    if (result.status === "updated") {
      restarting = true;
      console.log(`Nox updated to ${result.release}; restarting.`);
      restartWhenIdle();
    } else if (result.status === "needs-setup")
      console.log("A new Nox release needs setup to update its runtime.");
  } catch (error) {
    console.error("Nox could not update:", error.message);
  }
}
// Pasted images and artifact captures for the transcripts Nox follows; made once Electron is ready.
let media;
function mediaTools() {
  media ||= createMediaTools({ BrowserWindow, nativeImage, session });
  return media;
}
async function captureSource(_source, subscription) {
  while (busy) await new Promise((resolve) => setTimeout(resolve, 50));
  busy = true;
  try {
    const result = await collector.syncTranscript({
      connection,
      subscription,
      cursors,
      request,
      media: mediaTools(),
    });
    subscription.turns = result.total;
    subscription.lastSynced = new Date().toISOString();
    subscription.error = "";
  } finally {
    busy = false;
    await persist();
  }
}
function showDropFeedback(value) {
  status = value.state;
  feedbackMessage = value.message || "";
  if (value.error !== undefined) lastError = value.error;
  if (value.target !== undefined) targetTitle = value.target;
  if (!feedbackWindow) return;
  if (value.state === "reading") {
    clearTimeout(feedbackTimer);
    feedbackWindow.hide();
    return;
  }
  clearTimeout(feedbackTimer);
  if (!feedbackWindow.isVisible()) {
    const point = value.point || screen.getCursorScreenPoint(),
      display = screen.getDisplayNearestPoint(point);
    feedbackPoint = {
      x: ((point.x - display.bounds.x) / display.bounds.width) * 100,
      y: ((point.y - display.bounds.y) / display.bounds.height) * 100,
    };
    feedbackWindow.setBounds(display.bounds);
    feedbackWindow.showInactive();
  }
  if (["following", "error"].includes(value.state))
    feedbackTimer = setTimeout(
      () => feedbackWindow?.hide(),
      value.state === "error" ? 2400 : 1800,
    );
}
async function subscribeSource(source) {
  // Claude's desktop conversation can move to a new CLI transcript on resume.
  const previous =
    source.localSessionId &&
    subscriptions.find((s) => s.localSessionId === source.localSessionId);
  if (previous) source = { ...source, sessionId: previous.sessionId };
  if (!connection) {
    const response = await request(`${ORIGIN}/api/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nox" }),
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("application/json")
    )
      throw new Error("Sign in to your space, then connect again.");
    const device = await response.json();
    await pair({ origin: ORIGIN, token: device.token });
  }
  const response = await request(`${ORIGIN}/api/subscribe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${connection.token}`,
    },
    body: JSON.stringify({
      sessionId: source.sessionId,
      title: source.title,
      provider: source.provider,
      mode: "follow",
    }),
  });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("Sign in to your space, then connect again.");
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Could not connect this conversation.");
  const existing = subscriptions.find((s) => s.id === result.subscriptionId);
  if (existing)
    Object.assign(existing, {
      paused: false,
      done: false,
      mode: "follow",
      file: source.file,
      sessionId: source.sessionId,
      localSessionId: source.localSessionId,
      folder: !!source.folder,
    });
  else
    subscriptions.push({
      id: result.subscriptionId,
      title: source.title,
      provider: source.provider,
      file: source.file,
      sessionId: source.sessionId,
      localSessionId: source.localSessionId,
      folder: !!source.folder,
      mode: "follow",
      paused: false,
      done: false,
    });
  await persist();
  const subscription = subscriptions.find(
    (s) => s.id === result.subscriptionId,
  );
  subscription.restored = result.restored === true;
  return subscription;
}
const FOLLOW_PROJECT = "--follow-claude-project=";
const projectArg = (argv) =>
  argv.find((a) => a.startsWith(FOLLOW_PROJECT))?.slice(FOLLOW_PROJECT.length);
// The user names a Claude Code project folder on the command line; every session in it is followed.
async function followClaudeProject(folder) {
  try {
    const source = await claudeProjectSource(folder);
    showDropFeedback({ state: "connecting", target: source.title, error: "" });
    const subscription = await subscribeSource(source);
    await captureSource(source, subscription);
    showDropFeedback({
      state: "following",
      target: source.title,
      error: "",
      message: subscription.restored
        ? "Collection restored. Syncing resumed."
        : "",
    });
    console.log(`Following Claude Code project ${source.title}.`);
  } catch (error) {
    showDropFeedback({ state: "error", error: error.message });
    console.error(`Could not follow ${folder}: ${error.message}`);
  }
}
async function handleProtocol(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "commonplace:") return;
    if (url.hostname === "show") {
      if (url.searchParams.get("origin") === ORIGIN) showBuddy();
      return;
    }
    if (url.hostname !== "pair") return;
    await pair({
      origin: url.searchParams.get("origin"),
      token: url.hash.slice(1),
    });
    showBuddy();
    win?.focus();
  } catch (error) {
    lastError = error.message;
    showBuddy();
  }
}
const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const link = argv.find((a) => a.startsWith("commonplace://"));
    if (link) void handleProtocol(link);
    const folder = projectArg(argv);
    if (folder) void followClaudeProject(folder);
    showBuddy();
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    void handleProtocol(url);
  });
  app
    .whenReady()
    .then(async () => {
      // Keep the original encryption service so upgrading does not orphan paired devices.
      // The app's display identity is configured after Chromium's storage key is cached.
      if (safeStorage.isEncryptionAvailable()) safeStorage.encryptString("");
      visibilityDiagnostics = await createVisibilityDiagnostics(
        path.join(app.getPath("userData"), "visibility-diagnostics.json"),
      );
      recordVisibility("startup", {
        platform: process.platform,
        electron: process.versions.electron,
        node: process.versions.node,
        release: path.basename(path.dirname(__dirname)).slice(0, 12),
      });
      for (const event of ["suspend", "resume", "lock-screen", "unlock-screen"])
        powerMonitor.on(event, () => recordVisibility(event));
      for (const event of [
        "display-added",
        "display-removed",
        "display-metrics-changed",
      ])
        screen.on(event, () =>
          recordVisibility(event, {
            displayCount: screen.getAllDisplays().length,
          }),
        );
      app.on("before-quit", () => recordVisibility("before-quit"));
      app.setName("Nox");
      app.dock?.setIcon(nativeImage.createFromPath(appIcon));
      app.setAboutPanelOptions({
        applicationName: "Nox",
        applicationVersion: "0.1.0",
        iconPath: appIcon,
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "Nox",
            submenu: [
              {
                label: "About Nox",
                click: () =>
                  dialog.showMessageBox({
                    type: "none",
                    icon: nativeImage.createFromPath(appIcon),
                    title: "About Nox",
                    message: "Nox",
                    detail: "Newron’s desktop companion · Version 0.1.0",
                    buttons: ["Done"],
                  }),
              },
              { type: "separator" },
              { label: "Show Nox", click: showBuddy },
              { label: "Hide Nox", click: hideBuddy },
              {
                label: "Open my space",
                click: () =>
                  shell.openExternal(
                    ORIGIN === "https://commonplace-pearl.vercel.app"
                      ? "https://newron.app"
                      : ORIGIN,
                  ),
              },
              { type: "separator" },
              {
                label: "Quit and stop syncing",
                accelerator: "CommandOrControl+Q",
                click: () => app.quit(),
              },
            ],
          },
          { role: "editMenu" },
        ]),
      );
      collector = await import(
        pathToFileURL(path.join(__dirname, "collector.mjs")).href
      );
      try {
        const encrypted = await fs.readFile(configPath());
        connection = JSON.parse(safeStorage.decryptString(encrypted));
        if (connection.origin !== ORIGIN) connection = null;
      } catch (error) {
        if (error.code !== "ENOENT")
          lastError =
            "Saved connection could not be restored. Please reconnect.";
      }
      try {
        const saved = JSON.parse(await fs.readFile(statePath(), "utf8"));
        subscriptions = saved.subscriptions || [];
        cursors = saved.cursors || {};
        if (
          Number.isFinite(saved.position?.x) &&
          Number.isFinite(saved.position?.y)
        )
          savedPosition = saved.position;
      } catch (error) {
        if (error.code !== "ENOENT")
          lastError = "Saved subscriptions could not be restored.";
      }
      // macOS setup registers the dedicated Nox launcher. Registering bare Electron here
      // discards the app entry path and opens Electron's welcome screen.
      if (process.platform !== "darwin" && !process.defaultApp)
        app.setAsDefaultProtocolClient("commonplace");
      const area = screen.getPrimaryDisplay().workArea;
      win = new BrowserWindow({
        title: "Nox",
        ...buddyBounds({
          x: savedPosition?.x ?? area.x + area.width - 128,
          y: savedPosition ? savedPosition.y + 54 : area.y + area.height - 136,
        }).bounds,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        hasShadow: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      for (const event of [
        "show",
        "hide",
        "closed",
        "unresponsive",
        "responsive",
      ])
        win.on(event, () => recordVisibility("window-" + event));
      win.webContents.on("render-process-gone", (_event, detail) =>
        recordVisibility("renderer-gone", {
          reason: detail.reason,
          exitCode: detail.exitCode,
        }),
      );
      win.webContents.on(
        "did-fail-load",
        (_event, errorCode, error, _url, isMainFrame) => {
          if (isMainFrame)
            recordVisibility("renderer-load-failed", { errorCode, error });
        },
      );
      win.webContents.on("did-finish-load", () =>
        recordVisibility("renderer-loaded"),
      );
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith(ORIGIN)) void shell.openExternal(url);
        return { action: "deny" };
      });
      win.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).origin !== ORIGIN) {
          event.preventDefault();
          void shell.openExternal(url);
        }
      });
      controlsWindow = new BrowserWindow({
        title: "Nox",
        width: 220,
        height: 224,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        hasShadow: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      controlsWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
      controlsWindow.webContents.setWindowOpenHandler(() => ({
        action: "deny",
      }));
      controlsWindow.webContents.on("will-navigate", (event) =>
        event.preventDefault(),
      );
      controlsWindow.webContents.on("before-input-event", (_event, input) => {
        if (input.type === "keyDown" && input.key === "Escape")
          hoverController?.reset();
      });
      controlsWindow.on("blur", () => {
        if (!connecting) hoverController?.update(false);
      });
      register("companion:copy-reference", copyReference);
      register("companion:snapshot", buddySnapshot);
      register("companion:pair", pair);
      dragController = createDragController({
        window: win,
        polling: false,
        cursor: () => screen.getCursorScreenPoint(),
        onMoveStart: () => {
          visibilityRevision++;
          visibility.update({ supported: null, interacting: true });
          clearInterval(visibilityFade);
          win.setOpacity(1);
          hoverController?.reset();
          candidateRevision++;
          setExpanded(false);
        },
      });
      hoverController = createHoverController({
        onChange: (open) => {
          if (open) void toggleControls();
          else {
            candidateRevision++;
            setExpanded(false);
          }
        },
      });
      const hitTest = createBuddyHitTest(win);
      let lastGaze = { x: Infinity, y: Infinity };
      const hoverTimer = setInterval(() => {
        if (win.isDestroyed() || !win.isVisible()) return;
        const gaze = pointerGaze();
        if (
          Math.abs(gaze.x - lastGaze.x) + Math.abs(gaze.y - lastGaze.y) >
          0.002
        ) {
          win.webContents.send("companion:gaze", gaze);
          lastGaze = gaze;
        }
        const cursor = screen.getCursorScreenPoint(),
          bounds = win.getBounds();
        hitTest.update(
          { x: cursor.x - bounds.x, y: cursor.y - bounds.y },
          dragController.isDragging(),
        );
        if (connecting || dragController.isDragging()) return;
        hoverController.update(
          buddyHoverRegion(
            { x: cursor.x - bounds.x, y: cursor.y - bounds.y },
            expanded,
          ) ||
            (controlsWindow?.isVisible() &&
              insideBuddyControls(
                cursor,
                anchorPoint(),
                controlsWindow.getBounds(),
              )),
        );
      }, 33);
      let inspectingVisibility = false;
      let inspectionBegan = 0;
      let inspectionStage = null;
      let nextHeartbeat = Date.now() + 30000;
      const healthTimer = setInterval(() => {
        const time = Date.now();
        recordVisibility("heartbeat", {
          pendingMs: inspectionBegan ? time - inspectionBegan : 0,
          type: inspectionStage,
          lagMs: Math.max(0, time - nextHeartbeat),
          reason:
            inspectionBegan && time - inspectionBegan > 10000
              ? "inspection-stalled"
              : "health",
        });
        nextHeartbeat = time + 30000;
      }, 30000);
      let lastVisibilityDecision = "";
      const visibilityTimer = setInterval(async () => {
        if (win.isDestroyed() || inspectingVisibility || visibility.isManual())
          return;
        const interacting = connecting || dragController.isDragging();
        const revision = visibilityRevision;
        let decision = { supported: null, reason: "interacting" };
        inspectingVisibility = true;
        inspectionBegan = Date.now();
        try {
          if (!interacting)
            decision = await inspectVisibility({
              inspect: () => inspectPoint(anchorPoint()),
              resolve: resolveLocalTarget,
              supportedApps: SUPPORTED_APPS,
              onStage: (stage) => {
                inspectionStage = stage;
              },
            });
          if (revision !== visibilityRevision || win.isDestroyed()) return;
          const visible = visibility.update({
            supported: decision.supported,
            interacting: connecting || dragController.isDragging(),
          });
          if (visible !== desiredVisible || (visible && !win.isVisible())) {
            desiredVisible = visible;
            applyVisibility(visible);
          }
          const totalMs = decision.totalMs || 0;
          const key = JSON.stringify({
            supported: decision.supported,
            reason: decision.reason,
            error: decision.error,
            target: decision.target && [
              decision.target.bundleId,
              decision.target.pid,
              decision.target.windowCount,
              decision.target.bounds?.x,
              decision.target.bounds?.y,
              decision.target.bounds?.width,
              decision.target.bounds?.height,
              decision.target.point?.x,
              decision.target.point?.y,
            ],
            visible,
          });
          if (key !== lastVisibilityDecision || totalMs > 5000) {
            lastVisibilityDecision = key;
            recordVisibility("check", { ...decision, visible });
          }
          if (visible && !win.isVisible())
            recordVisibility("visibility-mismatch", {
              reason: "expected-visible-window-hidden",
            });
        } catch (error) {
          recordVisibility("inspection-outer-error", {
            error: error.message,
            errorCode: error.code || error.name,
          });
        } finally {
          inspectingVisibility = false;
          inspectionBegan = 0;
          inspectionStage = null;
        }
      }, 1000);
      win.once("closed", () => {
        clearInterval(hoverTimer);
        clearInterval(visibilityTimer);
        clearInterval(healthTimer);
        clearInterval(visibilityFade);
      });
      const finishDrag = (result) => {
        notifyBuddy();
        if (result.click) hoverController.show();
        if (result.moved) void persist();
      };
      win.webContents.on("before-mouse-event", (_event, mouse) => {
        hitTest.update({ x: mouse.x, y: mouse.y }, dragController.isDragging());
        handleBuddyMouse(dragController, mouse, win.getBounds(), finishDrag);
      });
      win.webContents.on("before-input-event", (_event, input) => {
        if (input.type === "keyDown" && input.key === "Escape") {
          dragController.cancel({ restore: true });
          hoverController.reset();
          notifyBuddy();
        }
      });
      win.on("blur", () => {
        if (dragController.isDragging()) {
          dragController.cancel();
          finishDrag({ click: false, moved: true });
        }
      });
      // Older hosted renderers may still call these. Native events own the drag.
      register("companion:drag-start", () => dragController.isDragging());
      register("companion:drag-end", () => ({ click: false }));
      register("companion:drag-cancel", () => {});
      register("companion:toggle", () => hoverController.show());
      // Older hosted pages send asynchronous hover messages. Native hit testing
      // deliberately ignores them so stale messages cannot disable the face.
      register("companion:hit-test", () => {});
      register("companion:context-menu", () => {
        dragController.cancel();
        notifyBuddy();
        buddyMenu().popup({ window: win });
      });
      register("companion:connect", async () => {
        if (setupPending || !connection)
          throw new Error("Finish setting up Nox before connecting a session.");
        if (connecting) return { connected: false };
        connecting = true;
        notifyBuddy();
        try {
          const result = await connectSession({
            inspect: inspectPoint,
            resolve: resolveLocalTarget,
            subscribe: subscribeSource,
            capture: captureSource,
            report: showDropFeedback,
            point: anchorPoint(),
          });
          candidateConnected = result.connected;
          if (result.source) candidate = result.source;
          return result;
        } finally {
          connecting = false;
          notifyBuddy();
        }
      });
      register("companion:pause", async (id) => {
        const source = subscriptions.find((s) => s.id === id);
        if (!source) throw new Error("Session not found.");
        const paused = !source.paused;
        const response = await request(
          `${connection.origin}/api/device-session`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${connection.token}`,
            },
            body: JSON.stringify({
              subscriptionId: id,
              action: paused ? "pause" : "resume",
            }),
          },
        );
        if (!response.ok)
          throw new Error("Could not change session state. Try again.");
        source.paused = paused;
        status = paused ? "paused" : "following";
        await persist();
        if (!source.paused) void tick();
        return { ok: true };
      });
      register("companion:open-space", () =>
        shell.openExternal(
          ORIGIN === "https://commonplace-pearl.vercel.app"
            ? "https://newron.app"
            : ORIGIN,
        ),
      );
      register("companion:hide", hideBuddy);
      win.on("closed", () => dragController?.cancel());
      feedbackWindow = new BrowserWindow({
        title: "Nox",
        ...screen.getPrimaryDisplay().bounds,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        hasShadow: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        focusable: false,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      feedbackWindow.setIgnoreMouseEvents(true);
      feedbackWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
      feedbackWindow.webContents.setWindowOpenHandler(() => ({
        action: "deny",
      }));
      feedbackWindow.webContents.on("will-navigate", (event) =>
        event.preventDefault(),
      );
      await feedbackWindow.loadURL(`${ORIGIN}/buddy/feedback`);
      // Account sign-in belongs in the browser. The native shell is always available,
      // including before pairing and while recovering a connection.
      await controlsWindow.loadURL(`${ORIGIN}/buddy/controls`);
      controlsReady = true;
      await win.loadURL(`${ORIGIN}/buddy`);
      showBuddy();
      const icon = nativeImage.createFromPath(
        path.join(assetsDir, "nox-tray.png"),
      );
      const trayIcon = icon.resize({ width: 18, height: 18 });
      trayIcon.setTemplateImage(true);
      tray = new Tray(trayIcon);
      tray.setToolTip("Nox");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "Show Nox", click: showBuddy },
          { label: "Hide Nox", click: hideBuddy },
          {
            label: "Open my space",
            click: () =>
              shell.openExternal(
                ORIGIN === "https://commonplace-pearl.vercel.app"
                  ? "https://newron.app"
                  : ORIGIN,
              ),
          },
          { type: "separator" },
          { label: "Quit and stop syncing", click: () => app.quit() },
        ]),
      );
      tray.on("click", showBuddy);
      app.on("activate", showBuddy);
      await processSetup();
      setInterval(() => void processSetup(), 2000);
      setInterval(() => void tick(), 15000);
      setTimeout(() => void checkForUpdate(), 60000);
      setInterval(() => void checkForUpdate(), 6 * 60 * 60 * 1000);
      setInterval(() => {
        if (
          expanded &&
          candidate &&
          !connecting &&
          !dragController.isDragging()
        )
          void Promise.all([refreshFavorites(), findCandidate()]);
      }, 4000);
      void tick();
      const folder = projectArg(process.argv);
      if (folder) void followClaudeProject(folder);
    })
    .catch((error) => {
      console.error("Companion could not start:", error.message);
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
}

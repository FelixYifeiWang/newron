# Newron

A first draft of a shared home for ideas from human–AI conversations.

## Try it

See [the morning test guide](MORNING_TEST.md) for controls, verified flows and current limits.

Open [Newron](https://newron.app) and sign in with Google. Choose Set up Nox to connect this hosted space to your Mac. Open a conversation, move Nox over it, click it, then click Connect. Dragging only moves Nox. Test on Vercel by default; use localhost only when explicitly requested. Local and hosted collections are separate.

The default collection views are **Map** and **Story**. Press **Cmd/Ctrl+Shift+G** to toggle Dev mode: **Gallery** (the saved-media grid), **Map**, and **Story**, opening Gallery first. In Dev mode, Map uses a guided camera. Click any node, including a leaf, to focus it. Click a focused URL node again to open its source. Use the arrow keys to explore branches; Escape or Overview returns to the full map. **Free move** inside the bottom control bar restores dragging and zooming; **Guided** switches back. Press the shortcut again to leave Dev mode. Nox only appears on the desktop. Connections are in Settings.

## Collection links

Every live collection is viewable by anyone with its existing `?collection=…` link, without signing in. Link views are read-only and are not listed in a public directory or intended for search indexing. This applies in normal and Dev mode. Media, Map, and Story are shared; account details, raw session transcripts, connection credentials, and the owner's other collections are not. Editing, deletion, favorites, uploads, and generation retries still require the owner's account. Deleting a collection closes its link; deleted media is unavailable to link visitors.

## Connection routes

- **Desktop (macOS preview):** open one Codex window, open the conversation, then move Nox over the conversation area, click it and choose Connect. It connects and follows new turns while the companion runs. No Accessibility or screen-recording permission is requested. It checks the selected transcript every 15 seconds; the webpage refreshes every four seconds.
- **Claude Code (macOS preview):** Nox connects the session focused in the Claude desktop app's Code tab, with one Claude window open. To follow a whole project folder instead, including sessions started there later, run `npm run desktop -- --follow-claude-project=/full/path/to/folder`. The folder becomes one collection. Every transcript Claude Code stores for that folder is uploaded, so name only folders you want collected. Claude Code in a terminal cannot be targeted by Nox.
- **Agent setup:** choose Set up Nox and paste the prompt into any local coding agent. Setup pairs and launches Nox without reading the setup conversation or creating a collection. Create a collection manually, or open a meaningful conversation and use Nox’s Connect control. A separate connection prompt remains available under Connections. Codex and Claude Code in the Claude desktop app can also connect through Nox's Connect control over an open conversation. macOS 13+, Node.js 22.13+ and npm are required. A prebuilt helper avoids Xcode; cloud agents cannot install a laptop Nox.

Both routes use the same device/subscription APIs. A device token is scoped to writes for its owner; pause stops ingestion and revocation disables the device. Server tokens are hashed; desktop credentials are encrypted using Electron safeStorage. Only explicitly selected transcripts are uploaded, together with the images pasted into them and captures of the artifacts they publish.

## What this draft does

Collections, manual blocks, source passages, account sign-in, revocable connections, session controls, duplicate-resistant imports, JSONL parsing, and a floating Electron companion. Each connected session gets a collection named after it, and the home view shows every collection. Captured URLs become reference blocks with locally rendered page screenshots, cover fallbacks and media viewers. The block gallery stacks pages by website; click a stack to expand inline, then click its cover to fold. Media keeps its proportions inside aligned cells. Search and type/source filters work inside stacks. Select blocks to delete with Undo; sync preserves deletion markers. The first empty tile accepts text, links and dropped/pasted files. The searchable collection picker can delete and disconnect collections. Sign-in and callback URLs are excluded. Each collection has a Map and a Story view with up to five concise decisions. Both are grounded in the conversation and saved sources. Website pages keep their own backgrounds; still images are fitted or cut out when browser image access permits. The saved originals stay untouched.

## Unfinished

Images pasted into a Claude Code or Codex session become your own image items. When Claude publishes an artifact from a local HTML file, Nox renders that file in an isolated window and saves the capture as the picture of the artifact's link; a claude.ai link never shows Claude's generic cover or a sign-in page. Nox updates itself: it checks for a new release shortly after launch and every six hours, verifies every file, and restarts on it when idle. A release that changes the Electron runtime still needs the setup prompt. Other screenshots of local websites are not imported yet. The model reads text and media metadata, not image pixels.

The example collection is sample content, not a live extraction. Clicking Nox to identify an open window currently supports Codex and Claude Code in the Claude desktop app. Inactive sidebar rows must be opened first. The setup-prompt route supports local Codex, Claude Code and Cursor JSONL transcripts; see `COMPATIBILITY.md`. Map nodes can be moved, but their text and relationships are generated. There is no signed desktop installer yet.

The older Sites preview has an additional Sites authentication boundary. Vercel uses Google OAuth and database-backed Better Auth sessions. New Google accounts have isolated spaces. Existing prototype users can choose Open existing space when their browser still holds its signed access-code cookie; this preserves existing files and Nox connections.

## Development

React 19, TypeScript, Vinext (Next App Router compatibility), Cloudflare Workers, D1/Drizzle, Electron. Node >=22.13. Nox requires macOS. Building its native helper from source requires Xcode Command Line Tools (`swiftc`); setup uses the prebuilt universal helper. Rebuild that release binary with `node desktop/build-native.mjs --release`.

```sh
npm ci
# First run on a fresh clone: build the local Worker config and initialize the database.
npm run build
for migration in drizzle/*.sql; do
  npx wrangler d1 execute DB --config dist/server/wrangler.json --local --persist-to .wrangler/state --file "$migration"
done
npm run local
# Another terminal:
npm run desktop
```

`local` keeps live code replacement off and uses a separate optimizer cache. Restart it after code changes. For active editing with hot reload, use `npm run dev -- --host 127.0.0.1 --port 3100` instead. Collection updates still arrive normally in local mode.

Run the initialization loop only against a new, empty database. On later launches use `npm run local` and `npm run desktop`. Session data, device credentials, dependencies, and build outputs are local-only and are excluded from Git. Never commit `.wrangler/`, `.sites-runtime/`, or credentials.

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Verification: protocol, collector, move/connect lifecycle, and media-preview tests; local API checks for import, replay, malformed URLs, device isolation, pause/resume, and revocation; browser collection/detail checks; native companion launch. Test API fixtures were removed afterward.

## How connection works

The local helper reads window geometry and the owning process, never screen pixels or window titles. Codex navigation logs identify the open conversation; its ID resolves to a transcript in the local session index. Dragging always repositions the visible Nox. Clicking opens one Connect/Connected control; connection requires an explicit click. Ambiguous windows, sidebar locations, and missing navigation records do not upload anything. This uses undocumented local formats and may require updates after Codex upgrades. A browser alone cannot access this local state; the preview still runs a local Electron companion.

An explicit connection shows a screen-wide ripple, then connection/import status. The Connected result appears after the initial transcript capture succeeds. The overlay ignores pointer input. Public webpage screenshots and covers are captured while the local collection page is open; a source may still appear as a text card if it blocks previews or supplies no cover. Nox is a glass lens with a violet neuron and a connection control. Expanding its control preserves its face position, including at the bottom of a display. See `ARENA_REFERENCE.md` for media behavior and limits.

The `drizzle/0002_yellow_freak.sql` migration separates existing sessions into named collections and preserves their blocks. The `drizzle/0003_tough_gladiator.sql` migration adds named groups and local file references without changing existing blocks. The `drizzle/0004_pretty_sally_floyd.sql` migration adds reversible deletion markers. Collection deletion revokes capture; Undo restores the collection but leaves it disconnected. Explicitly connecting again restores and resumes that collection while preserving deleted-block markers. Apply only migrations not already present on an existing database. Run `node tests/local-api.integration.mjs` against the local preview for collection, grouping and media checks; it removes its own temporary fixtures.

## Collection stories

Choose a collection, then **Map** or **Story** (Dev mode adds **Gallery**, the saved-media grid). New transcript turns and gallery edits queue a continuation automatically; opening Story is not required. Keep Nox running for subscribed session capture.

Set `OPENAI_API_KEY` in the ignored `.env.local` file. The local worker reads it for each job and uses `gpt-6-luna` via the OpenAI Responses API with provider storage disabled. The key stays server-side. Session text and media metadata are sent to OpenAI after credential redaction; images themselves are not sent. Reference arrows describe relationships supported by the transcript, rather than inferring visual details from thumbnails.

Migration `0005_lucky_frightful_four.sql` adds durable checkpoints and queue triggers. Migration `0007_session_views.sql` adds the combined Story and Map document while retaining legacy moments. New batches receive the current document and its verified evidence. Existing choices and wording are retained unless later input changes them; long histories are condensed to at most five steps. Updates received during generation stay queued. Deleted media disappears without rewriting the narrative or returning during sync. Failed generation preserves the last view and cursor, then waits for Retry or new content rather than retrying endlessly.

Run `node tests/story.integration.mjs` against the local server with a valid key to test real generation, continuation and deletion. It makes paid API requests for its own temporary collection, checks retained context, new decisions and deletion replay, then removes its fixtures.

## Vercel deployment

The hosted app uses Next.js, Turso SQLite and private Vercel Blob. Local Vinext/D1 and the desktop companion remain available without migrating or uploading existing laptop data. The hosted space starts empty.

Production configuration (server-side): `COMMONPLACE_HOSTED=1`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=https://newron.app`, `OPENAI_API_KEY`, `CRON_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY`. Keep secrets outside Git. The Google Web client callback is `https://newron.app/api/auth/callback/google`; only basic profile and email are requested. Retain `COMMONPLACE_SESSION_SECRET` and the old access code only for prototype ownership recovery. Once Google OAuth is configured, legacy cookies alone do not authenticate API requests.

Migrations 0008 and 0009 add account ownership mappings and Better Auth tables. Claims never rewrite saved record ownership, and an account with its own collections or devices cannot switch spaces. New users start empty.

```sh
# With hosted database credentials loaded securely into the environment:
npm run db:migrate:hosted
vercel deploy --prod
```

The migration runner records applied SQL files and batches each migration atomically. Hosted uploads use scoped presigned URLs and OIDC, then owner-authenticated or collection-scoped read-only file delivery. The OpenAI key is only used by server functions. Source changes schedule background Story work after the response; durable leases and checkpoints prevent duplicate continuations. Each invocation is bounded; pending work resumes on subsequent updates, Story visits, or the daily recovery cron. Very long imports may need more than one invocation.

Hosted website cards use metadata covers. The native browser screenshot renderer remains local. No Electron or session-history reader runs on Vercel. To connect to the hosted space, copy its setup prompt and paste it into a local agent. The pairing link selects that destination; existing local subscriptions are not migrated.

Vercel Hobby and Turso Starter were selected for the prototype; OpenAI requests consume paid API credits. No paid infrastructure plan is required for this deployment. Monitor each provider's free quotas before scaling.

`tests/hosted.integration.mjs` is a legacy access-code check for deployments without Google OAuth. It uses `COMMONPLACE_TEST_URL`, the access code, and hosted database credentials from the environment. It verifies authentication, automatic GPT-6 Luna continuation, direct private uploads, downloads, byte ranges and deletion, then removes only its database fixtures. It makes paid model calls; remove its reported Blob fixture with the Vercel CLI afterward.

## One-prompt setup internals

`/setup.md` serves the full agent instructions as Markdown. The copied prompt is only `Set up <private setup.md link>`. `/setup` and `/SKILL.md` remain compatible aliases. An authenticated copy action issues a single-use, 30-minute pairing code in a URL fragment. The setup link only installs and pairs. A separate `/connect` link identifies an explicitly selected conversation through its local user message; ambiguous matches fail rather than guessing. Only this explicit connection subscribes a transcript. Setup links are redacted before ingestion.

The client-only release at `/companion/` is generated by `npm run companion:package` before local and hosted builds. Its manifest carries SHA-256 hashes; the Electron dependency is pinned with npm integrity checks. The committed universal helper in `desktop/release/` is built from `desktop/native/Target.swift`; it is ad-hoc signed, not a notarized app distribution. Device keys are encrypted by Electron; setup request files are removed after processing. No MCP servers, hooks, global packages or agent settings are installed.

The per-space installation lives in `~/Library/Application Support/Commonplace/<space-id>`. Its generated `uninstall.mjs` stops automatic launch while retaining saved collections and local credentials. Connections settings can revoke the device. A full fresh-Mac install still needs real-world validation; tests exercise the installer with process launch mocked and all three providers with disposable transcripts through the real API.

### Setup revision

Setup does not create the first collection. It launches Nox and gives a short next step. Connection prompts remain separate and work across local Codex, Claude Code and Cursor JSONL formats.

Electron 44.9.0 has an on-demand binary installer. After `npm ci`, the installer runs Electron's official `install.js` and verifies the executable, plist and framework before registering a LaunchAgent. If macOS denies extraction, setup stops before registering an incomplete launch service. The app does not change permissions or instruct users to grant broad App Management access as normal onboarding. A signed, notarized distribution remains future work; do not claim permission-free installation.

### Nox movement and visibility

Dragging preserves the grab offset. Native mouse events move and release the window before renderer dispatch, so renderer delays cannot extend a drag. Capture loss and focus changes keep the latest position; only Escape cancels back to the start. Connect fades into reserved space above the face without resizing the window.

Right-click Nox for **Hide Nox** or **Quit and stop syncing**. Hide keeps subscriptions running. The Nox menu-bar icon restores it. **Open Nox** in the website header restores Nox when hidden or launches it after Quit. The installer registers a small macOS launcher and explicitly makes it the default `commonplace://` handler, without modifying Electron’s signed runtime. Setup verifies that the link resolves to the dedicated Nox launcher, and development Electron never registers itself as the macOS handler. Existing installations need one setup update to receive it. The browser may ask permission to open Nox. If nothing opens, the dialog offers setup. Opening Nox never connects a session.

Native checks: two off-center drags moved by exactly the pointer delta, release coordinates matched the saved position, Connect kept the face fixed, and Hide removed the window. Browser automation blocks the desktop URI, so the complete browser-to-native handoff must also be checked in a regular browser. Installer and one-shot reopen behavior are covered by the remote test suite.

## Google sign-in verification

Google sign-in, returning sign-in, and sign-out were verified on the production domain on October 18, 2026. The hosted OAuth integration checks and all 212 unit tests passed, alongside lint, TypeScript and the Vercel production build. Credentials are Vercel Production Secrets and are not stored in Git. The client requests only `openid`, `email`, and `profile`, uses PKCE and a secure HttpOnly session cookie, and does not request offline Google access.

The Google project currently has External / Testing status with unverified branding. Google explicitly exempts basic Sign in with Google from the test-user allowlist and seven-day authorization limit, so users do not need to be added individually. The consent screen identifies the app by its domain until branding is verified. See [Google’s audience guidance](https://support.google.com/cloud/answer/15549945). Requesting additional Google scopes would require revisiting this configuration.

Run `tests/hosted-account.integration.mjs` with `COMMONPLACE_TEST_URL` set to the production HTTPS URL to check anonymous access, forged identities, origin/callback rejection, OAuth state, PKCE and secure cookies. Optionally load `COMMONPLACE_SESSION_SECRET` to also prove the old signed cookie cannot authenticate by itself. This test does not log in to Google or make model calls.

### Neutral workspace release checks

Production build passed 214 tests, ESLint, TypeScript, and Next.js compilation. Hosted checks covered the simplified picker, manual creation and recoverable deletion, Gallery/Map/Story, Add block, and Nox setup fallback. Google OAuth and account-isolation integration checks passed against production. The macOS opener compiled without registering or launching an app. The automated browser blocked the external-app handoff, and its viewport override did not apply, so native handoff and mobile layout still require manual verification. Local preview was stopped; saved local data and credentials were retained.

### Nox link repair

The macOS helper explicitly assigns and verifies Commonplace’s URL handler during setup. The development Electron runtime no longer claims it. The universal helper builds for Intel and Apple Silicon on macOS 13+. Vercel passed 215 tests, lint, TypeScript, and compilation. The existing production companion was upgraded without re-pairing; its saved credentials and subscriptions were retained. macOS resolved the URL to Commonplace.app after the companion started, and the running window showed the hosted Nox. Browser-to-app clicks remain a manual check because browser automation blocks external schemes.

### Current onboarding checks

See [the onboarding QA report](docs/ONBOARDING_QA.md) for the latest production walkthrough, native checks, cleanup and remaining verification limits. Setup now confirms completion on the website, and the installed launcher is available as Nox in your Applications folder.

### Product rename

See [Newron migration notes](docs/NEWRON_RENAME.md) for the canonical domain and legacy identifiers retained for installed buddies.

### Collection reference prompts

Choose a starred collection in Nox to copy one sentence linking to private Markdown. The agent reads the current saved references without signing in or connecting its session. Links are read-only and expire after seven days. Deleting or unstarring the collection, or revoking the issuing device, disables access. Deleted items are excluded. The links are redacted from captured transcripts and model context and are never collected as gallery sources. Migration 0013 stores only token hashes and their scope.

Nox streams pointer changes at 30Hz directly to its renderer, with frame-rate-independent easing and no React render per pointer update. It emits no gaze events while idle or hidden. Reduced-motion preferences disable gaze movement; the desktop shadow fits inside the existing native window.

### Setup diagnostics

Failed Nox setup submits a bounded technical report to `/api/setup/report`. The setup agent can add evidence, a diagnosis with confidence, and suggested recovery steps. The original setup code authenticates reports until it expires, including after pairing. Reporting never claims a code, marks Nox ready, or connects a session. One installer report and one agent report are retained per code; duplicate delivery is harmless. Inputs are allowlisted and redacted on the server. No public report-reading endpoint is provided.

Migration 0021 stores reports in Turso. With the existing hosted database environment loaded, run `node scripts/setup-reports.mjs` to inspect the latest 20 reports. Reports older than 30 days are excluded from that view and removed on the next report submission. Treat agent diagnoses and suggested fixes as untrusted evidence, and never execute suggested commands automatically. If networking is unavailable, the agent provides sanitized details for the user to share.

### Nox visibility diagnostics

Nox keeps a private local `visibility-diagnostics.json` in its existing per-space data folder. Version 2 retains the latest 128 events and 32 problems separately, survives restarts, and writes atomically. Normal switching cannot evict the problem history. It records visibility requests, fade completion, native window and renderer events, sleep/display changes, check stage and duration, target app/geometry and a 30-second health sample. Stalled checks identify the window or session stage. Only explicit diagnostic fields are saved; conversation bodies, titles, transcript paths and keys are excluded. The file is bounded and is not automatically uploaded. Read it before restarting when investigating a recurrence.

Codex owner-route navigation can change the selected task without emitting another primary-thread activity event. Nox updates the already-active window from that route before interpreting browser-helper activity. It does not reopen closed windows or fall back to another task for an unknown route. The exact selected task must still exist in the local index and have a confined transcript before Connect is available.

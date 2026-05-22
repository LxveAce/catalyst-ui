# Security & Correctness Review — Phase 6 (Vault Sync)

> Reviewed: 2026-05-21 · Branch: phase-6-vault-sync · Reviewer: red-team agent

## Summary
Phase 6 ships vault-to-private-GitHub-repo sync. Input validation, path-traversal guards, and the "private only" check are all in place; the consent gate, however, is an integrity flag the renderer chooses to set rather than a security boundary, and several operational issues (failed-push hot-loop, fs.watch silent death on Windows, sticky `lastError`, no remote-prune on local delete) create real data-leak / surprise-upload risks for a feature whose payload is conversation transcripts. No exploit gives a remote attacker the vault contents on its own; the highest-severity findings are consent/UX gaps that materially affect what data actually leaves the device.

## Critical
_None on default configuration._ The end-to-end path requires (a) a GitHub PAT already in safeStorage, (b) `enabled === true`, (c) `consentAt` recorded, and (d) `owner`/`repo` pointing at a private repo the PAT can write. There is no path that uploads vaults without the user previously completing the wizard at least once.

## High

### [H1] `lastError` never clears on partial-success runs, masking subsequent good syncs
**Where:** `src/main/cloud-sync.ts:266-287` (`syncNow`)
**Issue:** `this.lastError = null` is only set at the start of a run; if a `pushVault` call throws partway through the loop, the loop aborts (the `for` is inside the try, no per-iteration catch) and `lastError` is set. The next `syncNow()` resets it again, but if no one calls `syncNow` (debounce timer cleared, no new file events) the banner sticks indefinitely. More importantly, when a single bad file (e.g., a vault that grew past `MAX_FILE_BYTES`, line 309-310) throws, **every queued file behind it in the same loop iteration is silently skipped** because the throw bubbles to the outer catch. There is no per-file try/catch.
**Exploit/scenario:** compact-controller dumps vault-A (1.2MB, oversize) and vault-B (50KB) in the same window. Loop processes vault-A first (alphabetical sort doesn't apply — `listLocalVaults` sorts by mtime desc, so newest first), throws on size cap; vault-B is never pushed even though it is well-formed. User sees "Vault X is 1234567B (cap 1048576B)" once and assumes that's the only problem; vault-B sits as "pending" until something else triggers `syncNow`.
**Fix:** Wrap the body of the `for (const v of local)` loop in `try { await this.pushVault(...) } catch (e) { perFileErrors.push({name: v.name, error: ...}) }`; surface a count of skipped files in `lastError` and continue the loop.

### [H2] Failed push of a permanently-bad vault produces a watcher-driven hot loop
**Where:** `src/main/cloud-sync.ts:275-279, 388-406, 423-429`
**Issue:** Files only land in `this.pushed` on **successful** push (line 342). A vault that always fails (size > 1MB, malformed JSON the GitHub API rejects, repo-permissions issue, secondary rate limit) is therefore re-tried on every subsequent `syncNow`. Worse: `fs.watch` fires not just on writes but on metadata changes; on Windows, atomic-move-into-place by compact-controller can fire several events per file. Each event reschedules the 5s debounce timer. As long as the watcher is up and the user has any always-failing vault on disk, every subsequent legit vault arrival re-pushes the bad one too (and fails again). With H1, this also blocks any *good* vaults newer than the bad one from making it out.
**Exploit/scenario:** User pastes a 2MB log into Claude → transcript_tail_bytes still 50KB so vault stays small, but if compact-controller is ever reconfigured (or a third-party process drops a >1MB `vault-*.json` into the dir) sync sticks. Every new compact cycle triggers another GitHub API hit that 4xxs. GitHub secondary rate-limit response is invisible to the user (just `lastError`).
**Fix:** Add an in-memory `failedOnce: Set<string>` (or persistent `failedIndex` with first-fail timestamp + attempt count) that suppresses retry for N minutes / M attempts; expose "skipped, click to retry" in the UI; combine with H1 fix so other files are not collateral damage.

### [H3] `verifyRepo` only checks `private`, not write access or repo ownership
**Where:** `src/main/cloud-sync.ts:254-264`
**Issue:** `verifyRepo` accepts any private repo the PAT can `GET /repos/:owner/:repo`. PATs with `repo` scope can read **any** private repo the user collaborates on, including org repos. A user can be tricked (or carelessly types) into pointing sync at an org's repo — verify will succeed (it's private, PAT has read), then pushes will either (a) succeed and leak transcripts into a shared codebase, or (b) fail with 403 and the user sees "Verify success but push fails" with no obvious next step. Note also that `repos.get` returning `private: true` does **not** distinguish between "repo the PAT-bearer owns" and "private repo a collaborator can read but not write."
**Exploit/scenario:** Lower-privilege social-engineering: "use my private repo for backup" → user pastes owner+repo → verify passes → first push succeeds → org now has the user's transcript tails (including cwd, pasted code, file paths) in a repo other org members can read. Not remote-exploitable but a real privacy footgun.
**Fix:** After `repos.get`, also call `repos.getCollaboratorPermissionLevel({ owner, repo, username: authenticatedLogin })` and require `permission in {'admin','write','maintain'}`. Or attempt a dry-run write (create an empty `.claude-sync-marker` file on first verify, refuse if 403).

### [H4] Pruning local vaults does not prune the remote — transcripts persist on GitHub forever
**Where:** `src/main/cloud-sync.ts:266-287` (sync model is push-only) + UI has no delete button
**Issue:** compact-controller caps local vault count at `vault_max_entries` (default 10) and overwrites/rolls older files. After sync, the remote accumulates monotonically — there is no GC. Users will reasonably assume "if I clean up locally, it cleans up remotely" or "rotating my local vaults limits exposure." That assumption is false. There is also no UI to delete a remote vault, no warning during the wizard that uploads are append-only, and `listRemoteVaults` (line 214-238) is read-only.
**Exploit/scenario:** User accidentally pastes a secret into chat (API key, password, customer PII). compact-controller captures it in `transcript_tail`. Sync pushes it. User notices, deletes the local vault, re-rolls the PAT. The pushed vault is still on GitHub indefinitely. Rotating the PAT does not remove it. Even deleting the file in the GitHub UI leaves it in the repo's git history forever.
**Fix:** (1) Add a prominent line in the consent screen: "Uploaded vaults are retained on GitHub indefinitely; you must manually delete them and the repo history if needed." (2) Add a "Delete remote vault" action (`client.repos.deleteFile`). (3) Optional: a "sync mirror" mode that deletes remote vaults absent locally, behind a flag.

## Medium

### [M1] Renderer-controlled `consentAt` makes the consent gate cosmetic from a security-boundary view
**Where:** `src/main/cloud-sync.ts:98-106, 115-122` and `src/renderer/components/sync/SyncWizard.tsx:70-88`
**Issue:** The "consent recorded" check (`if (!next.consentAt) throw`) is satisfied by **any ISO date string the renderer passes**. There is no main-process record that the wizard's "I understand" checkbox was actually ticked, that a preview was shown, or that the user even saw the consent screen. A renderer-side XSS (e.g., from any of the unsanitized vault preview surfaces if a future change rendered something other than a `<pre>`) or any malicious renderer code could:
```js
await window.electronAPI.sync.setSettings({
  owner: 'attacker', repo: 'siphon',
  consentAt: new Date().toISOString(),
  enabled: true,
});
```
…and immediately begin pushing the user's transcripts to a private repo the **attacker** controls (assuming the attacker's PAT was somehow paired, or the user's PAT happens to have collaborator write on the attacker's repo). Acceptable for v1 because the renderer is the user's trust boundary in Electron, but the gate is not actually a defense-in-depth control.
**Exploit/scenario:** No XSS today (preview goes through `<pre>{string}</pre>`, React-escaped). But future panels that render markdown/HTML from any uncontrolled source (e.g., GitHub issue bodies in `GitHubIssue.title`, LMM cycle content) become consent-bypass primitives.
**Fix:** Move consent to a main-process-only flow: have `setSettings` reject `consentAt` from the renderer; expose a separate `SYNC_RECORD_CONSENT` IPC that requires a confirmation `dialog.showMessageBox` (modal, native, can't be spoofed by renderer) and stamps `consentAt` itself.

### [M2] `cloud-sync-pushed.json` and `cloud-sync-settings.json` use fixed `.tmp` filename — same race as Phase-4.5 M2
**Where:** `src/main/cloud-sync.ts:498-503` (`writeJsonAtomic`)
**Issue:** `const tmp = target + '.tmp'`. Concurrent writes (two `writeSettings` from rapid renderer toggles, or `writePushed` racing with `writeSettings`) clobber each other and leave a stale `.tmp` if the process dies mid-write. Same pattern flagged in prior Phase 4.5 M2. Local-only impact: corrupted pushed-index leads to either duplicate uploads (low) or skipped uploads (worse — silent loss of "this file is pending" state, then the file gets aged out of local by compact-controller without ever shipping).
**Fix:** Use `target + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp'` (matches the recommended fix for Phase-4.5 M2 — apply consistently across services).

### [M3] `fs.watch` silently dies on Windows when the watched dir is removed/recreated
**Where:** `src/main/cloud-sync.ts:388-406` (`startWatcher`)
**Issue:** On Windows, `fs.watch` on a directory that is later deleted+recreated emits no event and the watcher becomes inert. compact-controller doesn't delete the vault dir today, but `recursive: false` watches at the dir-handle level. If the user runs `Remove-Item -Recurse $env:USERPROFILE\.claude\compact-controller\vault; New-Item -ItemType Directory ...` (e.g., during a manual cleanup or compact-controller reinstall) the watcher goes dead and **no further auto-syncs fire** until the user toggles enabled off/on or restarts the app. Status panel will continue to show `enabled: true` with no error. The user will believe sync is active when it isn't — opposite of the data-leak risk, but a correctness/silent-failure issue users won't notice until they need a vault that wasn't backed up.
**Fix:** Add an `error`/`close` listener on the FSWatcher that nulls out `this.watcher` and schedules a reconnect attempt (with backoff) every N seconds while `enabled`. Or: poll `listLocalVaults()` on a 60s timer as a safety net.

### [M4] No throttle on `syncNow` beyond `this.syncing` — a 50-vault dump = 50 sequential GitHub API hits
**Where:** `src/main/cloud-sync.ts:266-287, 291-347`
**Issue:** `MAX_FILE_BYTES` caps each file but nothing caps fan-out. After a long restore / first-time setup with backlog, all pending vaults are pushed sequentially. Each push does **two** API calls: one `getContent` (for sha-on-update) and one `createOrUpdateFileContents`. 50 vaults = 100 calls in a tight loop. GitHub's secondary rate limit will engage; depending on the account state it can cooldown the entire PAT for the GitHub panel features as well. No global per-second throttle, no `Retry-After` honoring.
**Fix:** Add a token-bucket (e.g., 1 push per 500ms) in `syncNow`; on 403 with `x-ratelimit-remaining: 0` or `Retry-After`, parse and sleep before continuing.

### [M5] Branch validator allows path separators and `..` segments
**Where:** `src/main/cloud-sync.ts:92-97` (`/^[A-Za-z0-9._\-\/]{1,100}$/`)
**Issue:** The branch regex permits `/` and `.`, so a renderer-controlled branch can be `feature/../../escape`. The GitHub API will normalize/reject most pathological branch names server-side, but this also feeds into `getContent({ ref })` / `createOrUpdateFileContents({ branch })` — those are URL-encoded by Octokit so true escape is unlikely. However a branch like `..` or `../main` is accepted by the regex; on the wire Octokit converts to `ref=..` which GitHub will treat as a literal ref-name and 404 (good). The deeper issue: the renderer can also set branch to a 100-char string of `/`, leading to confusing 404s with no helpful error.
**Fix:** Tighten to git ref-name rules: `/^(?!\.)(?!.*\.\.)(?!.*[/.]$)[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/` and disallow `..` and leading/trailing dots-or-slashes. Or, since today only `main` is used, just enforce `/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/` (no slashes).

### [M6] `verifyRepo` mismatch with `setSettings` validation lets the wizard set fields that re-loading rejects
**Where:** `src/main/cloud-sync.ts:25` (OWNER_RE max 39 chars) vs GitHub max usernames (39 chars) — actually consistent. But `REPO_NAME_RE` allows leading dot (`/^[A-Za-z0-9._-]{1,100}$/` permits `.foo`), while GitHub rejects repo names starting with `.`. `createRepo` would 422 server-side. Minor.
**Issue:** `readSettings` silently coerces invalid persisted values to null/defaults (lines 459-464). If someone edits `cloud-sync-settings.json` by hand to add a single bad char, the next launch clears the entire owner/repo silently. **enabled** is preserved but `getStatus.configured` becomes false, so toggle does nothing — looks like a UI bug.
**Fix:** When `readSettings` rejects a stored value, also force `enabled = false` (since enabled-without-configured should never be persisted in the first place; defense-in-depth against a corrupted store).

### [M7] `verifyRepo` may auto-create a leak: PAT-scope error message echoes scopes back unfiltered
**Where:** `src/main/cloud-sync.ts:359-364`
**Issue:** Error string includes `state.scopes.join(', ')`. GitHub `x-oauth-scopes` headers can in some PAT formats include `admin:org`, `delete_repo`, etc. that the user might not expect surfaced. Lower severity than a typical info-leak but the message bubbles to the SyncPanel `lastError` banner verbatim. If the user screen-shares a debugging session, all scopes flash on screen.
**Fix:** Replace with a generic "needs scope `repo`" message; don't echo the user's other scopes in the banner.

## Low / nits

- **Constructor side-effect ordering:** `getCloudSync()` is called from `setupCloudSync()` only when an IPC handler fires (lazy). However the first IPC (e.g., `SYNC_STATUS` from panel mount) starts the watcher if previously enabled. Acceptable, but means a user who disabled sync, edited settings.json to `enabled: true` by hand, will start a watcher on the very next renderer panel open. Document in a comment.
- **`writeJsonAtomic` mode 0o600** is a no-op on Windows (NTFS ACLs ignore POSIX bits). Settings file is therefore world-readable to other users on a shared Windows account. Not exploitable here (no secrets in `cloud-sync-settings.json`), but worth a comment / consider `icacls` hardening if used for anything sensitive in the future.
- **`previewVault` returns `null` for any error** including "file > 1MB" — UI shows generic "Could not preview X" with no hint. Confusing for users; consider returning an `{error: 'too_large'}` discriminated type.
- **`debounceMs` lower bound 1000ms** means a user toggling settings could trigger a 1-second sync storm. Defaults are fine; the lower bound just feels low.
- **`listLocalVaults` has no bound** — relies on compact-controller's `vault_max_entries` (default 10). If compact-controller config is set to 5000, the panel renders 5000 buttons. Phase-4.5 cycles got a 500-cap; same pattern would help here (slice in main, not just `vaults.slice(0,10)` in renderer — the renderer slice is presentation, the main-process IPC still returns everything).
- **`scheduleSync` immediately on `startWatcher` (line 405)** is good (catches files-in-flight while disabled) but combined with the toggle-on-from-renderer flow it means "enable sync" triggers an upload 5s later with no further user confirmation. Consent already covers this, but a "Push N pending vaults now?" dialog on enable would be friendlier and consent-reinforcing.
- **`pushVault` uses `fs.readFileSync`** — synchronous I/O on the main thread inside an `async` method. For 1MB max, negligible, but inconsistent with the rest of the codebase if elsewhere is `fs/promises`.
- **`remoteKey(name)` uses current `this.settings.deviceName`** but `pushedIndex` persists across device-rename. If the user changes their device name post-setup, all previously-pushed files appear as "not pushed" and re-upload under the new device folder (orphaning the old folder remotely). Add a migration or warn on device-name change.
- **`SyncWizard` `existing` step accepts owner/repo with no client-side regex.** Server (`setSettings`/`verifyRepo`) validates, but the user gets a less-helpful error after a network roundtrip than a clear inline "letters/numbers/dashes only" message.
- **`VaultPreviewModal` "Working dir" renders `preview.cwd`** which is read from JSON — could be very long. The `mono` style has `wordBreak: 'break-all'` so it won't break layout, but no length cap. Low impact.
- **No telemetry/log of what was pushed.** A user who later wonders "did vault-X get uploaded?" has only the green dot in the panel — no audit log. Consider an append-only log file alongside the pushed-index.

## Verified-OK

- **VAULT_NAME_RE + dirname-equals-vault-dir check** in both `pushVault` (cloud-sync.ts:298-301) and `previewVault` (cloud-sync.ts:185-186) correctly defeat `../` traversal and absolute-path injection.
- **`createRepo` validates `repoName` against `REPO_NAME_RE`** (cloud-sync.ts:241-242) before the Octokit call; defense in depth even though GitHub server-side validates.
- **`verifyRepo` refuses public repos** (cloud-sync.ts:260-262) — the primary data-leak guard works.
- **`requireConfig` re-validates `deviceName`** (cloud-sync.ts:377-378) even though `setSettings` already did — defense in depth against corrupted persisted state.
- **`setSettings` enabling-requires-consent** (cloud-sync.ts:115-122) blocks the obvious "renderer toggles enabled with no owner/repo" path; combined with `verifyRepo` ensures repos are at least claimed-private before any push.
- **`MAX_FILE_BYTES = 1MB` hard cap** (cloud-sync.ts:21, enforced at line 309) prevents accidental upload of giant transcripts; compact-controller default of 50KB is well under.
- **`getClientOrNull()` accessor in github-service.ts:198-204** does not leak the token to the renderer; only the Octokit instance, only to other main-process services.
- **IPC channel set** (`SYNC_*` in ipc-channels.ts:43-51) is mirrored exactly by the preload bridge (preload.ts:95-106) and main-side handlers (index.ts:223-241); no orphan channels exposed.
- **`VaultPreviewModal` renders user content via `{preview.transcriptTailExcerpt}` inside `<pre>`** — React text-escaping prevents HTML/script injection from anything that ends up in a transcript tail. Vault `name`, `sessionId`, `cwd` likewise.
- **`fs.watch` filename regex-gated** (cloud-sync.ts:398) — even if the OS reports a junk filename, only `vault-*.json` matches trigger a sync; no traversal via the watcher.
- **Wizard "I understand" checkbox is required** for the Confirm button (`SyncWizard.tsx:208`, `disabled={busy || !consentAck}`). Not a security control (see M1) but UX-wise the gate is in place.
- **`web-contents-created` handler** denies `setWindowOpenHandler` and blocks navigations off the dev/file origins (index.ts:285-301) — limits the blast radius of any renderer-side bug.
- **Sandbox + contextIsolation on** (index.ts:60-64) — renderer cannot reach Node directly.

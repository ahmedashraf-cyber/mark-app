# Sign-in sessions: how long a login lasts

| | |
|---|---|
| Rule | HR-code login ends when the app closes. Email + password ends when the app closes unless "Remember me" was ticked. |
| Code | `src/utils/sessionPolicy.js` (Firebase side), `src/utils/sessionFlags.js` (pure logic), `src/hooks/useAuth.jsx`, `src/pages/LoginPage.jsx`, `src/App.jsx`, `src/utils/sheetRole.js` |
| Verified | Automated against the **real Firebase Auth SDK** (network faked), with true restarts. **Not** yet run on a Windows install: see section 6. |

## 1. Before this change

* `config.js` ran `setPersistence(auth, browserLocalPersistence)` once, un-awaited, for everyone. Every sign-in therefore survived a restart indefinitely, HR-code ones included.
* **HR-code login is not a separate session type.** `LoginPage` looks the code up in the roster, then calls the same `signInWithEmailAndPassword(auth, user.email, user.password)` with the roster's stored password. It is an ordinary Firebase email+password session.
* The HR-code field was never saved (React state only).
* A role cache, `mark_role_cache_v1`, was written on every successful lookup, never expired, was never cleared, and was honoured for **any** role whenever the sheet could not be reached.
* The Google OAuth refresh token for Drive exports (`mark_g_refresh`, `driveExport.js`) is separate and also survived restarts.

## 2. How it works now

1. **Persistence is chosen per sign-in, before the sign-in call** (`signInWithSession`): `browserSessionPersistence` normally, `browserLocalPersistence` only for an email login with the box ticked. Session storage belongs to the app window, so it is gone after a restart, a crash or a force-kill, with no cleanup code that could fail to run. HR-code login always passes `remember: false`.
2. **One small flag** records the choice: `mark_remember` (localStorage) = `{ uid, at }`. No password, no token. The token is Firebase's, in the persistence Firebase chose. The "Remember me" box itself is never stored and always starts unticked.
3. **Startup guard** (`startupGate`, awaited by `useAuth` before it trusts any auth state). At a real app start (no `mark_run` marker in sessionStorage) a restored user is signed out unless the flag names that exact user and is under 30 days old. This is what makes users left signed in by older versions of the app end their session, and it is a second, independent layer behind (1). A reload inside the same window changes nothing.
4. **The role is read from the sheet at every start**, including for a remembered session. A role change takes effect at the next start. A deactivated account is signed out (`endSession`) at that start and the login screen shows: *"Your account has been deactivated. Contact your Batch Manager."*
5. **Sign out** (`endSession`) clears the Firebase session, the remember flag and the saved role. Work data on disk is never touched (nothing calls `localStorage.clear()`).
6. **The minimum-version gate** is unchanged and still runs before a restored session is used: `App.jsx` shows the outdated screen once the role (and the config's minimum version) has been read.
7. **Closing the main window closes the pop-out video window** (`App.jsx`, `onCloseRequested`; it does not cancel the close).

## 3. Decisions, point by point

| # | Brief | Chosen | Why |
|---|---|---|---|
| 1 | session or in-memory persistence by default, local when ticked, set before sign-in | `browserSessionPersistence` / `browserLocalPersistence`, set inside `signInWithSession` before the call | Session storage dies with the window. In-memory would also lose the session on a reload (F5). Note: Firebase also migrates an already signed-in user if persistence is changed afterwards, so the order is not fatal, but it is set first as required. |
| 2 | one small flag | `mark_remember` `{uid, at}` | Binds the choice to the user and carries the timestamp for the 30-day limit. |
| 3 | never cache the role | Re-read at every start. One narrow exception, see "Offline" below | The role is never taken from the cache while the sheet is reachable. |
| 4 | status check at every start | In `useAuth`, on every auth state (including a restored session). Signs out + notice. | Previously a deactivated person signed in and saw the Access-denied page. |
| 5 | version gate before a remembered session is used | Unchanged; tested with the real `App` | `loading` stays true until the role and config are read, then the outdated screen comes before everything else. |
| 6 | handle the Tauri window-close event | **Session ending does not depend on a close handler**: session storage ends the session, and the startup guard covers crash, force-kill and older sessions. A close handler *is* registered, to close the pop-out | An async sign-out on close can race the process exit and does not run on a crash, so it could not be the mechanism. |
| 7 | Google OAuth refresh token | **Kept, untouched** | It is the Drive export credential, not the app login. Removing it would send every reviewer to Google's consent screen on every launch. Tested: after sign-out and restart, exports refresh silently and never open the interactive sign-in. See risk in section 5. |
| 8 | maximum remember period | **Built: 30 days, client-side** (`MAX_REMEMBER_MS`) | Firebase has no server-free way to limit it: the refresh token lives until revoked or the password changes (needs the Admin SDK on a server). The stamp costs a few lines but is a convenience policy, not a security control: someone editing their own local storage can extend it. |

## 4. Offline start of a remembered session

The sheet cannot be reached, so the role cannot be re-read. A collector must still be able to collect.

**Chosen fallback:** the role cache survives only as an offline fallback, and only when **all** of these hold: the saved role is a collector role (`Offline Data Collector`, `... (Part)`), it was verified online within the last **7 days** (`OFFLINE_ROLE_MAX_AGE_MS`), and the sheet is unreachable. It is cleared on sign-out and at any start where no session is kept. Any other saved role is **not** honoured: that person sees *Access denied: Can't reach the sheet to verify your account. Connect to the internet and try again*, now with a **Try again** button (a reload keeps the session) as well as Sign out.

**Risk, plainly:**
* A collector who is deactivated while offline can keep collecting, for at most 7 days or until they next get a connection.
* The cache is plain localStorage, so someone with access to the PC can edit it to extend that window or fake a collector role. A collector can only add data. Anything above collector must be verified, and that is the point of excluding it.
* **Behaviour change:** before, a saved manager/reviewer role was also honoured offline, without any time limit. Managers and reviewers now need a connection to start the app. This is one constant/one function (`offlineRole` in `sheetRole.js`) if it needs to be loosened.

A *non-remembered* user cannot sign in offline at all (Firebase needs the network), so there is nothing to protect there.

## 5. Edge cases

* **Updater restart.** The installer ends the process and the app starts again as a new process. A remembered user continues; a non-remembered user sees the login screen. Judged acceptable: keeping a non-remembered session across it would mean writing the token to persistent storage, which defeats the setting. In-progress work is on disk and is restored after signing back in.
* **Crash / force-kill** is the same as a restart for a non-remembered session: nothing persisted.
* **Pop-out video window** never touches Firebase (it loads only `VideoWindow`), so it keeps no session alive. It *was* able to outlive the main window (created at runtime with no parent, nothing closed it), which is why the close handler was added.
* **One-time sign-out for everyone on first launch after this update.** Everyone is currently signed in locally with no `mark_remember` flag, and "no flag" means "not remembered", so the startup guard signs them out once. They can tick Remember me when signing back in.
* **Google refresh token on a shared PC.** `mark_g_refresh` is per Windows profile, not per MARK user, so a second MARK user on the same profile exports with the first one's Google account until it is replaced. Unchanged by this work. A follow-up could key it by MARK user.
* **Password autofill.** MARK never stores the password. WebView2 has password autosave off by default and the app does not enable it; not verified on an install.
* **In-progress Tag sessions are not tied to a user on disk.** They record `collectorId` but are looked up by video path only (`FieldPage.jsx` `findSessionByPath`), and the pending-upload recovery takes the first one regardless of owner. So work is restored for the same user, as required, and also for anyone who opens the same video, or signs in next, on that PC. Unchanged by this work.

## 6. Tests

**Run (automated):**
* `sessionFlags.test.mjs`: 18 pure-logic checks (decision table, flag storage, fresh start vs reload).
* Real-SDK harness (jsdom + the real `firebase/auth`; only the network is faked; every "restart" is a new process with only `localStorage` restored): 51 checks across your nine tests plus migration, wrong flag owner, 29/31 days, reload, wrong password, unregistered user and five offline cases. And 15 checks through the real `App`: the version gate on a restored session, the offline Access-denied screen with Try again, deactivation, and the pop-out close handler.
* Mutation checks (remove a protection, confirm a test fails): no pre-sign-in persistence (3 fail), no startup guard (4 fail), no deactivation handling (5 fail), sign-out that leaves the flag/cache (2 fail), HR-code remembered (5 fail), old any-role offline fallback (2 fail). Note that "login screen after restart" still passed in the first one: the guard is an independent second layer.

The harness is not in the repo (it needs jsdom, which is not a dependency here); the pure tests are.

**Not verified here (needs a Windows install):**
* That WebView2 discards `sessionStorage` on app exit and after a force-kill (documented browser behaviour; not observed).
* That `onCloseRequested` fires and closes the pop-out in a real window.
* The real updater restart.
* A real offline start.
* The visual layout of the checkbox and notice.

Windows smoke checklist:
- [ ] Untick, sign in, close the app, reopen: login screen.
- [ ] Tick, sign in, close, reopen: straight in; role correct.
- [ ] Tick, set the user inactive in the sheet, reopen: deactivation message on the login screen.
- [ ] Tick, change the role in the sheet, reopen: new permissions.
- [ ] Sign out, reopen: login screen, box unticked.
- [ ] HR-code: close and reopen: login screen.
- [ ] End Task the app (force-kill) while signed in and not remembered, reopen: login screen.
- [ ] Open the Comparison pop-out video, close the main window: the pop-out closes too.
- [ ] A Tag session in progress, sign out, sign in again: the session is still there.
- [ ] A Drive export after a restart: no Google consent screen.
- [ ] First launch after the update from v7.12.24: everyone is asked to sign in once.

# Architecture

A tracking app for two people: **Weekly** accountability habits, **Calories** (food log,
food bank, weight/burn/deficit), and **Training** (workout plans and logs). One page,
three tabs, one shared setup. Both people's phones stay in sync in real time through a
shared sync code; the app also works installed as a PWA and offline.

Live at: https://theembeddedengineer.github.io/Goal-Tracker/

## Stack and constraints

- **No build step.** Native ES modules served exactly as written — no bundler, no npm,
  no transpiler. Deploy is `git push` to `main`; GitHub Pages serves the files.
- **Backend is Firebase**: anonymous auth (`signInAnonymously`) + Firestore. The web
  `apiKey` in `js/core.js` is intentionally public (normal for Firebase — access control
  comes from Firestore rules, not key secrecy). All data is keyed by the couple's
  **sync code**: whoever enters the same code shares the same documents.
- **A service worker** precaches the app shell and serves stale-while-revalidate, so the
  app opens instantly and works offline; a toast offers a refresh when a new deploy is
  detected.

## Directory layout

```
index.html            Markup only (~270 lines) + <script type="module" src="js/app.js">
styles.css            All CSS (theme vars, cards, phone app bar / bottom nav)
manifest.json         PWA manifest (name, icons, standalone display)
sw.js                 Service worker: app-shell precache + stale-while-revalidate
icon-*.png            App icons
js/
├─ core.js            Firebase init, sync state + status dots, feature REGISTRY,
│                     shared utils (dates, charts, confirmWipe)
├─ data.js            Pure data: training plans, exercise-rename table, categories
├─ shared.js          Cross-tab UI: setup card, tab nav + bottom nav, Today card,
│                     glance bar, backup export, device-owner setting
├─ app.js             Boot sequence only
├─ weekly/            ┐
├─ calories/          ├ one folder per tracker — see "Inside a feature folder"
└─ training/          ┘
```

## The two-layer module architecture

### Outer layer: features → shared → core (one-way)

```
                 ┌─────────────────────────────┐
                 │  app.js  (boot order only)  │
                 └──────────────┬──────────────┘
        imports                 │
   ┌──────────────┬─────────────┼──────────────┐
   ▼              ▼             ▼              ▼
weekly/        calories/     training/      shared.js ──► core.js
   │              │             │               ▲            ▲
   └──────────────┴─────────────┴───────────────┘            │
              (features import shared + core)                │
                                            data.js ◄── features only
```

**The registry breaks the would-be cycle.** The shared UI (Today card, glance bar,
person jumps, backup export) needs all three trackers, and every tracker needs shared
helpers — naively that's circular. Instead, `core.js` owns a registry:

```js
register(name, api)   // called once by each feature's index.js
feature(name)         // lookup by shared UI
featureList()         // iterate all
```

Each tracker registers this API:

| Method | Used by |
|---|---|
| `loadData()` | boot |
| `subscribe(code)` | boot + sync-code changes |
| `renderAll()` | registry consumers |
| `jumpToToday(pk)` | Today-card pill taps |
| `setPerson(pk)` | device-owner switch |
| `isDoneToday(pk)` | Today card ✓/— pills |
| `glanceHtml()` | phone app-bar glance line |
| `onSettingsChanged()` | names/settings saves |
| `exportData()` | backup JSON download |

Rules: shared/core never import a feature; features never import each other. New
cross-feature needs = extend the registered API, not a new import.

### Inner layer: inside a feature folder

Every folder has the same shape, strictly layered — **imports only point down**:

```
state.js   ◄──  sync.js  ◄──  UI file(s)  ◄──  index.js
```

- **`state.js`** — the feature's shared mutable state as ONE exported object
  (`state.calEntries`, `state.trActiveDay`, …) so any sibling file may reassign fields;
  plus pure selectors (e.g. `calDayTotals`, `trFindPreviousLog`); plus an exported
  `ui = {}` of **late-bound slots**.
- **`sync.js`** — Firestore subscribe / merge / push for this feature.
- **UI files** — weekly: `ui.js`; calories: `log.js` (daily food logging + autocomplete),
  `metrics.js` (weight/burn/deficit/goals), `bank.js` (food bank card), `insights.js`
  (month calendar, recap, trends); training: `overview.js` (calendar + activities),
  `day.js` (day view, workout logging, progress), `render.js` (tab bars + content
  composition).
- **`index.js`** — composes `renderAll`, registers with the core registry, and wires the
  `ui.*` slots.

**The `ui.*` slots are the folder-local version of the registry**: the few genuinely
upward calls (sync re-rendering after a remote snapshot, a save handler triggering
`renderAll`) go through `ui.renderAll()` etc., assigned in `index.js` after everything
is defined. State used by 2+ files lives on the `state` object; state used by one file
stays a plain `let` in that file.

## Data model

### Firestore (all keyed by sync code)

| Document | Contents |
|---|---|
| `trackers/{code}` | Weekly: `entries` (nested maps person→date→checks), `weeklyThresholds`, `settings` (names + thresholds) |
| `calories/{code}` | `foodBank` (array), `weightLog`/`burnLog` (maps), `goals` + `dailyGoals`, `settings` |
| `calorieEntries/{code}_{YYYY-MM}` | Food-log items **sharded one document per month** so no single doc grows toward Firestore's 1 MiB limit |
| `training/{code}` | `trainingLog` (array per person), `coreLog`, `extraLog`, `stepsCheckLog`, `settings` |

### localStorage

Every synced structure is mirrored locally (`entries`, `calorie_*`, `training_*`) so the
app renders instantly and works offline. Purely device-local settings never sync:
`coupleCode`, `devicePerson` ("this phone belongs to…" — default person on load),
`activeTab`, per-tab last person, and the card-collapse flags.

## Sync model (the part to be most careful with)

- Each feature holds a live `onSnapshot` listener per document. An `applyingRemote` flag
  suppresses push-echo loops while a remote snapshot is being applied.
- **Firestore's `{merge:true}` deep-merges nested maps but replaces arrays wholesale.**
  Two devices saving near-simultaneously can silently clobber each other's additions to
  any array field. Therefore every push of an array field does **merge-before-push**:
  fetch the latest remote copy and union it into local state first —
  `foodBank` merged by German name, food-log items by content hash (no stable ids),
  `trainingLog` by `date|day|variant`. The exception: right after a **delete or
  in-place edit**, pushes pass `{skipMerge:true}` so a stale remote copy can't resurrect
  what was just removed. **Any new array-typed synced field needs the same treatment.**
  (Weekly needs none of this — its synced data is nested maps all the way down.)
- The sync status dot turns green after all four subscriptions have delivered their
  first snapshot (`markSynced` counts to 4).
- One-off data corrections ship as **idempotent self-healing code**: deployed normally,
  they check-and-fix on next load, no-op forever after, and get deleted once verified
  applied (see `TR_EXERCISE_RENAMES` in `js/data.js` — the live, currently-empty
  mechanism for renaming an exercise that already has logged weights, which are keyed
  by exact exercise name).

## Boot sequence (`js/app.js`)

1. Module evaluation order (via imports): `core` → `shared` → each feature folder
   (`state → sync → UI → index`, registering as they load). Top-level code only attaches
   listeners and reads localStorage — no cross-module calls yet.
2. `initShared()` — load names + sync code, populate setup card, auto-expand Setup if no
   sync code exists.
3. `feature(n).loadData()` for all three — render from localStorage immediately.
4. `feature(n).subscribe(code)` — attach Firestore listeners.
5. `showTab(...)` — restore last active tab (`?tab=` URL param wins).
6. Register the service worker; wire the update toast.

## UI shell

Desktop keeps the plain page: title, Setup card, top tab buttons. Phones (≤640px) get an
app shell instead: a fixed top bar (app name, sync dot, ⚙ gear that reveals the
otherwise-hidden Setup card) with a **glance line** — the active tab's key numbers via
`feature(tab).glanceHtml()` — plus a fixed bottom tab bar. The Today card shows both
people's done/pending state for all three trackers via `isDoneToday`; tapping a pill
jumps to that tab/person/date via `jumpToToday`.

## Deploys and caching

- Deploy = commit + push to `main`. GitHub Pages rebuilds take a variable ~30–60s.
- `sw.js` precaches `APP_SHELL` and serves same-origin GETs stale-while-revalidate, so a
  deploy shows up one load late. When the background revalidation of the shell sees a
  changed etag, it messages open pages, which show a "new version — Refresh" toast.
- **When adding/removing any JS/CSS file: update `APP_SHELL` in `sw.js` and bump
  `CACHE_NAME`** so installed PWAs refetch the whole shell atomically.

## Testing

No node/npm — checks are Python-driven:

- **Syntax**: `esprima.parseModule()` over every file in `js/` (all are ES modules).
- **Functional**: Playwright (headless Chromium) drives real flows against a local
  server (`python3 -m http.server 8934`), always using a **throwaway sync code** so real
  data is never touched. Two browser *contexts* on one code simulate the two-device /
  concurrent-write scenarios.
- Verify locally before pushing; after pushing, poll the live URL for a distinctive
  string from the change before calling it deployed.

# SSOT Refactor — Status & Decisions

As of **2026-04-21**.

Context doc for the workbook-as-single-source-of-truth refactor that moved
configuration out of `data/*.json` overlays and into `veryHidden` `_data_*`
sheets inside the user's `.xlsx`. This file is the "if you drop in cold,
read this first" for the refactor.

## The principle

The workbook is the single source of truth. One file, one place to look, no
parallel JSON state to get out of sync. Human-readable sheets are printouts;
the hidden `_data_*` sheets are what the app reads. When any proposed feature
conflicts with the SSOT principle, the principle wins.

## Shape of the change

- **Storage:** per-entity flat tables in `veryHidden` sheets prefixed `_data_`
  (`_data_meta`, `_data_offerings`, `_data_professors`, `_data_rooms`,
  `_data_locked_assignments`, `_data_solver_results`, `_data_tuned_weights`).
  Schema marker `GAME_SCHEDULER_DATA_V2` lives in `_data_meta`.
- **Loader:** `export/excel_reader.py` returns typed exceptions for structural
  failures (not-our-file, schema-too-new) and partitions cell-level bad refs
  into a structured errors list. Never refuses the whole file.
- **Fallback:** `localStorage` snapshot on every successful load. Used when
  `_data_meta` is missing/unreadable.
- **Backups:** every export writes `.backups/<filename>_<ISO>.xlsx`, keeps the
  10 newest.

## Acceptance — what shipped

All merged to `main`:

| Plan item | What shipped | PR |
|---|---|---|
| Kill JSON-overlay Backup/Restore/Commit, About replaces kebab, backup-on-export | `#57` | [#57](https://github.com/profangrybeard/GAME_Scheduler/pull/57) |
| 1.1 Per-entity `_data_*` sheets, `veryHidden`, schema v2 | `#58` | [#58](https://github.com/profangrybeard/GAME_Scheduler/pull/58) |
| 1.2 Structured per-record validation errors (`error` severity) | `#59` | [#59](https://github.com/profangrybeard/GAME_Scheduler/pull/59) |
| 1.3 `localStorage` snapshot fallback for unreadable `_data_*` | `#60` | [#60](https://github.com/profangrybeard/GAME_Scheduler/pull/60) |
| 2.2 About popover: semver + build timestamp + "Show backups folder" reveal | `#61`, `#62` | [#61](https://github.com/profangrybeard/GAME_Scheduler/pull/61), [#62](https://github.com/profangrybeard/GAME_Scheduler/pull/62) |
| 3.1 Data Issues popover (passive, structured) | `#63` | [#63](https://github.com/profangrybeard/GAME_Scheduler/pull/63) |
| 3.3 `warning` severity for stale soft-prefs on kept offerings | `#64` | [#64](https://github.com/profangrybeard/GAME_Scheduler/pull/64) |
| Kill "clip full" metaphor, swap to "at cap" | `#65` | [#65](https://github.com/profangrybeard/GAME_Scheduler/pull/65) |

Plan items 1.4 (backup retention = 10, pruning), 2.1 (kebab → About only),
2.3 (sidebar freshness), and 2.4 (remove Load Example) landed inside the PRs
above.

### PR numbering note

`#64`'s title says "Phase 3.2" but the body — and the plan — cite 3.3. The PR
is 3.3 (severity handling). The numbering slip is cosmetic; the content is
correct.

## Phase 3.2 — consciously skipped

The plan's Phase 3.2 was "in-app fix flow" — click an entry in the Data
Issues panel, open an inline editor, revalidate on save.

**Scope if revived:** ~2–3 days. New `PATCH /api/state/cell` endpoint,
server-side session storage for uploaded workbook bytes, modal editor with
context rows + field-appropriate input, revalidation round-trip, state
transition (`loading → partial → clean`).

**Why it's skipped:**

1. **Competes with SSOT.** In-app editing either (a) writes back to the
   user's `.xlsx` via the File System Access API — fragile, permission-gated,
   browser-dependent — or (b) makes the server session the interim source of
   truth until re-export, which is exactly the overlay flow we just killed.
2. **The SSOT-native flow already works and is clearer.** The Data Issues
   panel lists structured errors with location + reason. Its footnote says
   "Fix these in the workbook and reload to clear them." That's a complete,
   honest UX — and a stronger demo story than a magic editor.
3. **Demo risk.** Four new failure surfaces (new endpoint, session store,
   modal, round-trip) a week before the SCAD AI conference demo (May 1) is
   the wrong trade.

**If revisited post-demo:** consider a lightweight "Copy cell reference"
button on each issue (puts `_data_offerings!C3` on the clipboard so the user
can paste into Excel's Name Box). Pure frontend, single failure mode,
preserves SSOT.

## Demo posture (through May 1)

"Nothing's broken, nothing's new." Freeze features. Spend the window doing
reload + solve + export smoke tests on Eric's real workbook at 1440x900.

What to demo from this refactor, in order:

1. **Workbook is truth.** Load a workbook, show the About popover with
   version + build timestamp + backups reveal.
2. **Honest validation.** Introduce a known-bad cell, reload, show the Data
   Issues panel with severity chip, friendly sheet name, row, column, reason.
3. **Recovery is simple.** Fix in Excel, reload, clean state. No modals, no
   magic, no parallel state.

## Phase 4 — optional, deferred past May 1

Plan's Phase 4 items (formula-driven human sheets, first-run empty state,
schema versioning, rescue flow) are explicitly optional in the plan and are
deferred until after the May 1 conference. Pick up here if Phase 3 proves
the SSOT model holds in the field.

## If you're picking this up cold

- Plan source: `C:\Users\rinds\Downloads\GAME_Scheduler_Implementation_Plan.md`
  (not in repo; user's local copy).
- Loader: [`export/excel_reader.py`](../export/excel_reader.py) — typed
  exceptions + `validate_against_local_data()`.
- Writer: [`export/excel_writer.py`](../export/excel_writer.py) — schema
  marker, backup-on-write, 10-file retention.
- Panel: [`frontend/src/components/DataIssuesPanel.tsx`](../frontend/src/components/DataIssuesPanel.tsx)
  — passive display, sorted by severity → sheet → row.
- API: `POST /api/state/parse` in [`api/server.py`](../api/server.py) returns
  `{state, errors}`.
- Tests: [`tests/test_excel_state_reader.py`](../tests/test_excel_state_reader.py).

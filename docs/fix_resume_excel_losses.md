# Fix: Resume from Excel was losing data

_Date: 2026-04-20_

## Symptom

Chairs reported that re-uploading a previously exported `.xlsx` via **Resume
from Excel** did not restore everything they'd edited in the prior session.
Offerings and solver results came back, but prof/room tweaks appeared to
silently revert to the defaults from `data/*.json`.

## Round-trip audit

The export → parse flow:

1. **Export:** React `POST /api/export(/stream)` with the full payload. Server
   writes a hidden `_state` sheet (`STATE_MARKER = GAME_SCHEDULER_STATE_V1`)
   with a JSON blob holding schema_version / quarter / year / solveMode /
   offerings / professors / rooms / solver_results.
2. **Parse:** React `POST /api/state/parse` → [`export/excel_reader.read_draft_state`](../export/excel_reader.py)
   reads the blob, `validate_against_local_data` drops offerings /
   locked_assignments with unknown ids, returns `{state, warnings}`.
3. **Hydrate:** `handleReloadFile` in [`frontend/src/App.tsx`](../frontend/src/App.tsx)
   applies the state to `SchedulerState`.

### Three gaps found

| Field          | Writer writes? | Reader reads? | Client hydrates? |
|----------------|---------------|---------------|------------------|
| offerings      | yes           | yes           | yes              |
| quarter/year/mode | yes        | yes           | yes              |
| **professors** | yes           | yes           | **no**           |
| **rooms**      | yes           | yes           | **no**           |
| **tunedWeights** | **no**      | n/a           | n/a              |

Writer + reader were fine; the loss was entirely in client hydration for
professors/rooms, plus a separate server-side omission for tunedWeights.

## Repro

`scripts/repro_import_loss.py` writes a minimal `_state` sheet with a modified
prof name + custom `tunedWeights`, then reads it back — proves the Python
layer is fidelity-clean. Resulting `.xlsx` gets copied into
`frontend/public/repro_smoking_gun.xlsx` so the dev server can serve it.

To reproduce live: inject the file into the hidden xlsx `<input type="file">`
via DataTransfer (see prior session transcript for the exact eval). Before
the fix, the Profs tab still showed **Eric Allen** after reload. After the
fix, it shows **SMOKING_GUN_NAME**, and `localStorage.tunedWeights` holds
`{affinity: 99, time: 1, overload: 1}` (remapped from the server's
`time_pref` shape to the Mix's `time` shape).

Re-run regression check:

```bash
PYTHONPATH=. PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe scripts/repro_import_loss.py
cp scripts/repro_smoking_gun.xlsx frontend/public/repro_smoking_gun.xlsx
```

The `.xlsx` outputs are gitignored; the script is the source of truth.

## Fix

**`api/server.py`** — both `/api/export` and `/api/export/stream` now include
`tunedWeights` in `draft_state`:

```python
"tunedWeights":  (req.tunedWeights.model_dump()
                  if req.tunedWeights else None),
```

**`frontend/src/api.ts`** — added `tunedWeights?: {affinity, time_pref,
overload} | null` to `DraftState`.

**`frontend/src/App.tsx` `handleReloadFile`** — when the draft carries
professors / rooms / tunedWeights, apply them:

- `professors` → convert array → Record, write to state and
  `saveProfessors(...)` for localStorage persistence. Missing key means
  "don't touch current deck" (older pre-v1 exports).
- `rooms` → same pattern with `saveRooms(...)`.
- `tunedWeights` → remap `time_pref` → `time`, `setTunedMix` + `saveTunedMix`
  so the Tune modal re-opens with the restored values.

## Why this matters

Prof/room edits live in `localStorage` for the same browser, but the xlsx
is the portability surface: sharing a draft across chairs or devices. Before
this fix, any collaborator who opened a shared xlsx got the sender's
offerings but the *recipient's* local prof deck — silent drift between what
the sender saw and what the recipient worked with.

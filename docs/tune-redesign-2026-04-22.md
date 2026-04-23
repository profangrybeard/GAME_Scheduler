# Tune redesign — 2026-04-22

One session. Dismantled the old Affinity / Time / Overload gear mix and
replaced it with Coverage / Time / Overload. Affinity stays as a fixed
background tie-breaker — always on, never tuned. Modes renamed
`affinity_first` → `cover_first` end-to-end. Also added SO6 (under-contract
fairness floor) and a rotating random seed so ASSEMBLE has "die roll" feel
across successive runs.

Commits: `198afd3`, `db4b196`, `eb8752f`, plus a chaser visual follow-up.

## Context — why this happened

The test dataset was exposing real weighting problems, not bugs. Running
`Affinity-First` against a realistic 30/26 quarter:

- Two professors (Maloney, Imperato — MoMe-only, stretched resources)
  ended up **under** their 4-class contract floor.
- Two other professors ended up **overloaded** above their max_classes.
- `Time-First` accidentally level-loaded everyone — because it was lenient
  enough on Affinity that the solver was free to spread the work.

The diagnosis: Affinity was too strong a signal in the objective. It was
driving load imbalance the solver had no counterweight against. Overload
was penalized, but the mirror case — a prof sitting below their contract
minimum — was invisible to the model. So the solver would "starve" a
stretched prof to feed an affinity-preferred one, and nothing objected.

The user's framing:

> Affinity should be a secondary weight resolved as a Nice to have, it
> should always exist but you do not tune it really ... Coverage is
> weighted. So what does the 3rd axis of the tune need to be?

The missing axis was overload/fairness. Affinity demoted itself from the
tune surface the moment we stopped trying to let chairs tune something
that was structurally causing injustice.

## What changed

### Backend (`config.py`, `solver/objectives.py`, `solver/scheduler.py`)

| Knob | Before | After |
|------|--------|-------|
| `MODE_WEIGHTS["affinity_first"]` | `{affinity:10, time_pref:1, overload:2}` | *(renamed)* `MODE_WEIGHTS["cover_first"]` = `{coverage:10, time_pref:1, overload:1}` |
| `MODE_WEIGHTS["balanced"]` | `{affinity:10, time_pref:4, overload:3}` | `{coverage:5, time_pref:5, overload:3}` |
| `MODE_WEIGHTS["time_pref_first"]` | `{affinity:1, time_pref:10, overload:2}` | `{coverage:3, time_pref:10, overload:2}` |
| `AFFINITY_WEIGHT` | — | **new** fixed constant, not in `MODE_WEIGHTS` |
| `SHOULD_HAVE_DROP_PENALTY` | 35 | 20 |
| `UNDER_CONTRACT_PENALTY` | — | **new** 500 (strong-soft; must dominate affinity swings) |
| `solver.parameters.random_seed` | `42` (fixed) | `int(time.time_ns() & 0x7FFFFFFF)` (rotates per solve) |

SO6 is added to `build_objective` inside the existing per-prof loop. It
shares the `prof_load` IntVar with SO3 (overload) so there's one load
variable per prof, not two. For any prof whose eligibility pool would
let them hit their contract, we add
`under_slack = max(0, contract_min - load)` to the objective with the
UNDER_CONTRACT_PENALTY coefficient.

### Frontend (`SolverMix.ts`, `SolverTuning.tsx`, `SolveProgress.tsx`,
`App.tsx`, `types.ts`, `api.ts`)

- `Mix` interface: `{coverage, time, overload}`
- `PRESETS` keys: `cover_first | balanced | time_pref_first`
- Gear labels + hints rewritten: Coverage describes "how hard we push to
  schedule every should/could-have"; the "What this means" readout splits
  into three independent verdicts (coverage, time, overload) instead of
  the old affinity-vs-time tradeoff.
- `SOLVE_MODE_LABELS` and the top-of-board MODE_LABELS use "Cover" for
  the left wing card.

### ASSEMBLE button chaser

On each click, a gold arc laps the button's perimeter once over 0.9s. Uses
`@property --chase-angle` to animate a conic gradient, with a two-layer
XOR mask keeping only the border ring visible. Reduced-motion collapses
the chase to a brief overall glow instead.

Implementation is a child `<span>` mounted under a `chaseKey` that
increments on every click — so even a double-click re-plays the animation
from zero instead of ignoring the repeat.

## Records of resistance

Things the system pushed back on, and how it got resolved:

1. **Running Python tests with the system `py` launcher failed** — the
   project's FastAPI deps live in `.venv`, not system Python. All test
   runs need `.venv/Scripts/python.exe -m pytest`. CI (Windows runner)
   hits this same wall if venv isn't activated.

2. **Worktree vs. main repo `.git` confusion** — the worktree at
   `.claude/worktrees/admiring-greider-f61320` is sparse (frontend only;
   no `.git` linkage), so git commands executed there fall through to
   the main repo's `.git` at `C:/SCAD/Projects/GAME_Scheduler`. This was
   initially mistaken for "the worktree broke" — it hadn't; the main
   repo was just now checked out to the PR branch.

3. **Python module caching masked live edits** — the user reported "no
   perceivable difference" after the weight changes. The backend
   launcher's Python process was still holding the old `config.py` /
   `solver/objectives.py` modules in memory. Full launcher restart (kill
   the backend, not just the Vite dev server) was required.

4. **Test fixture had hardcoded `affinity_first` mode name** — `pytest
   tests/test_lock_and_solve.py::test_imports` asserted
   `set(config.MODE_WEIGHTS.keys()) == {"affinity_first", ...}`. Caught
   the rename, fixed via `replace_all` across five test files.

5. **First replace_all attempt failed — Edit required Read first**. Read
   tool must run on a file before Edit / replace_all in the same session.
   Added Reads as prerequisites.

6. **Mode name rename had a longer reach than expected**. In addition to
   the obvious test + config touches, `affinity_first` appeared in
   `app.py` (Streamlit shell mode-selector buttons), `solver/model_builder.py`
   docstring, `export/excel_writer.py` sheet-structure comment, and
   `scripts/generate_example_xlsx.py` (which writes example XLSX files
   with the mode baked in). Missing any of these would have broken
   either reload-from-xlsx or the Streamlit surface silently.

7. **`affinity` in `api.ts` line 25 is NOT the tune axis** — that's
   `affinity_level` on a single assignment (SO1's per-prof-per-course
   level 0-3 tag). The tune-axis rename only applies to the `tunedWeights`
   shape. Grep-and-replace without context would have miscorrected this.

## Steps to recreate this refactor

If you need to redo a similar axis rename / add a strong-soft constraint:

### 1. Dataset calibration (optional but recommended)

Rebalance `data/quarterly_offerings.default.json` so the stretched profs
actually have enough sections to hit their contract floor *when the
solver wants them to*. Without real data making contracts tight, SO6
never fires and you can't feel the difference.

Tim's instinct: 14 GAME / 10 MOME / 4 AI / 2 other = 30 sections against
a 26-section contract floor (chair Allen × 2 + six profs × 4). MOME =
10 against 8 contract minimum = meaningful but not cushy.

### 2. Add the strong-soft constraint

In `solver/objectives.py`, inside the per-prof loop that already builds
`prof_load`, add a slack variable and push it into `obj_vars` /
`obj_coefs` with a **large** coefficient. The coefficient must exceed
the worst swing the old weights could produce — UNDER_CONTRACT=500
against AFFINITY=1 and COVERAGE=10 has ~50× headroom, which is enough
that the solver treats "under contract" as near-hard.

Key: share the `prof_load` IntVar between SO3 (overload) and SO6
(under-contract). Two copies → two models of the same prof's load,
which the solver can't reconcile.

### 3. Rename the axis end-to-end

Touch order, so no intermediate state breaks too hard:

1. `config.py` — keys in `MODE_WEIGHTS`, new constants
2. `solver/objectives.py` — import new constants, use new keys
3. `solver/scheduler.py` + `api/server.py` — docstrings, type models
4. Tests (`replace_all` old mode name): test_lock_and_solve,
   test_solve_stream, test_state_endpoints, test_excel_state_roundtrip,
   test_excel_state_reader
5. `app.py` — mode dict + buttons
6. `scripts/generate_example_xlsx.py` — hardcoded mode strings
7. `solver/model_builder.py`, `export/excel_writer.py` — docstring/comment
8. Frontend: SolverMix.ts → SolverTuning.tsx → SolveProgress.tsx →
   App.tsx → types.ts → api.ts (SolverMix first: all other frontend
   files import from it)

### 4. Rotate the random seed

In `solver/scheduler.py`, replace the fixed `random_seed = 42` with
something that actually varies per solve:

```python
solver.parameters.random_seed = int(time.time_ns() & 0x7FFFFFFF)
```

Hard constraints stay enforced; CP-SAT just explores a different branch
each time. This is what gives successive ASSEMBLE presses their
slot-machine feel.

### 5. Verify

```bash
# Backend — all 85 should pass
.venv/Scripts/python.exe -m pytest tests/ -q

# Frontend — tsc + vite build must be clean
cd frontend && npm run build
```

Then full launcher restart (NOT just Vite hot-reload — the Python
process caches imports), hit ASSEMBLE a few times in the workspace, and
confirm:

- Profs sit at or above their contract floor (no more Maloney/Imperato
  starvation)
- Successive runs produce genuinely different assignments
- The Tune card's gear reads "Coverage / Time Pref / Overload"
- Cover-First card at left, Tune middle (with gear), Time-Pref at right

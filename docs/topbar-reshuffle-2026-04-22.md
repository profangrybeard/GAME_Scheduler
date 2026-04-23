# Topbar reshuffle — 2026-04-22

One session. Retired the inverse-theme Resume-from-Excel left rail + bee
mascot, and reshuffled the React workspace topbar + schedule panel header
to name the data flow (ingress → action) in the layout itself.

Shipped as [PR #71](https://github.com/profangrybeard/GAME_Scheduler/pull/71)
(`bb60dbf`). 5 files changed, +305 / -458. UI-only; no solver or API changes.

## Context — why this happened

The previous session ended with a stylized inverse-theme left rail holding
a sideways "Resume from Excel" button and a bee mascot. Editorial on
paper, but the user's own review the morning after:

> Can we ditch the black bar on the left? ... It is not editorial. It
> hides the most important button to get started. Oh, and we can ditch
> the bee. We have a new metaphore.

The "new metaphor" is the laser chaser — a gold arc that laps the primary
button's perimeter on click. That's the kinetic signal the brand needed.
The bee was a placeholder; the chaser is the thing. See
[memory: Editorial design voice](../../.claude/projects/C--SCAD-Projects-GAME-Scheduler/memory/feedback_design_voice.md)
for the codified rule: editorial decoration surfaces the story, it doesn't
bury the first thing a user needs to click.

Once the rail was gone, Resume needed a home. First attempt: topbar-left
alongside the hamburger. That worked, but created a composition problem
— the old panel header had a "FALL ▾ Schedule" inline title, and now the
topbar had a sibling piece of context chrome. Two places claiming to be
the session-level context strip.

The user then reframed the layout:

> 1. We move Quarter Schedule to top row with Course Planner centered.
> 2. We move Resume from Excel Button to the row Assemble is on but
> left justified as if the input for Assemble.

That's the ingress→action mental model made literal in the layout.
Resume is the LEFT side of the schedule header — the "input" that feeds
ASSEMBLE on the RIGHT. Quarter (session context) moves UP next to the
title, where context chrome belongs. The panel title itself disappears
because the quarter selector was the only reason the header had a title
at all.

## What changed

### Topbar — 3-col grid

`.scheduler__topbar` flipped from flex to grid with `1fr auto 1fr`
columns, `align-items: center`. The three zones:

| Zone | Content |
|------|---------|
| `topbar-left` (1fr, justify-self: start) | Hamburger + `FALL ▾ SCHEDULE` eyebrow |
| `topbar-center` (auto, justify-self: center) | `BrandEyebrow` + `Course Planner` h1 |
| `topbar-right` (1fr, justify-self: end) | Export + theme toggle + Data Issues + TopbarMenu |

Quarter selector is `.topbar-quarter` — uppercase eyebrow treatment, pairs
visually with the `SCAD:Prototype` eyebrow above Course Planner. Native
`<select appearance: none>` + absolute-positioned `▾` caret so the
keyboard/screen-reader behavior is preserved.

### Schedule panel header — ingress → action row

The old `<h2 className="panel__title">` with an inline quarter select is
gone. The header is now a flex row with Resume on the left (via a new
`inputSlot` prop on `QuarterSchedule`) and the existing
`.schedule__toolbar` (ASSEMBLE / Empty Calendar / OR / mode chips) on the
right. `justify-content: space-between` + `align-items: center` keeps them
at opposite edges, vertically aligned on Y.

### Component API change: `QuarterSchedule`

- `QUARTER_OPTIONS` is now exported so `App.tsx`'s topbar select reuses
  the same list (no duplicate source of truth).
- `onSetQuarter` prop removed (the topbar owns the handler now).
- `inputSlot?: ReactNode` added. `App.tsx` passes a div containing the
  Resume button, the `Loaded <filename> · <timestamp>` label, and the
  hidden `<input type="file">`.

### Retired CSS

- `.panel__title-select-wrap` / `.panel__title-select` /
  `.panel__title-select:focus-visible` / `.panel__title-select-caret` —
  the inline-title-select machinery. No callers remain.
- `.topbar-resume` container — renamed to `.schedule__input` because it's
  no longer in the topbar.
- `.topbar-resume__loaded` — renamed to `.schedule__input-loaded`.

The `.topbar-btn.topbar-btn--resume` button styles stay (the button class
is unchanged, only its container moved).

### Mobile breakpoint

`@media (max-width: 767px)` overrides `.scheduler__topbar` back to
`flex-direction: column`, unsets `justify-self` on the zones, and puts
`.scheduler__topbar-center` at `order: -1` so the title sits on top.
Without this the 3-col grid would try to fit three zones into a
375px-wide viewport and the centered title would collide with the right
zone.

## Records of resistance

Things the system pushed back on, and how it got resolved:

1. **Preview server in a sparse worktree failed to boot.** The worktree
   at `.claude/worktrees/admiring-greider-f61320` is frontend-only; its
   `node_modules` was missing the `@rolldown/binding-win32-x64-msvc`
   native binding that Vite 8 needs. Fixed by pointing
   `.claude/launch.json` at the main repo's frontend with absolute paths
   (`C:/SCAD/Projects/GAME_Scheduler/frontend/node_modules/vite/bin/vite.js`
   as the runtime arg), not the worktree's.

2. **Vite CLI positional-root confusion.** `--root <path>` is rejected;
   Vite takes the root as a positional argument after `serve`. Final
   working form: `node vite.js serve <absolute-frontend-path> --port 5175
   --strictPort`. `--strictPort` was needed because the user's own
   `npm run dev` was holding 5174.

3. **User reversed direction after seeing the preview.** First asked to
   "center Quarter Schedule and move Export to that row." I implemented
   it, the user previewed it, then said "let me rethink this problem.
   Can we revert those changes please?" Lesson: for layout decisions,
   in-browser preview is cheap; rendering a proposal is more productive
   than discussing it. `git revert --no-edit` (non-destructive, new
   commit) was the right tool — we didn't lose the exploration, just
   undid its application.

4. **"Center on X" vs. "center on Y" miscommunication.** The user said
   "can we center [these four buttons] on X in that row." I read that as
   horizontal centering (`justify-content: center`) and implemented it.
   They corrected: "my bad, i meant centered on y with the former left
   and right justification." They meant vertical centering (which was
   already there via `align-items: center`) while keeping
   `justify-content: space-between`. When the user says "centered"
   without an axis, ask.

5. **The branch couldn't merge to main — stale squash-merge ghosts.**
   The feature branch had 22 commits ahead of main, but `git diff
   main..branch` showed only 5 files changed. That's because the prior
   PR #69 was squash-merged: the branch's original commit SHAs don't
   exist in main, so git's merge-base calculation treats all of them as
   "new." GitHub reported `mergeStateStatus: DIRTY`. Fixed by creating
   a clean branch off `origin/main` in a temporary worktree, using
   `git checkout <stale-branch> -- <file paths>` to pull in only the
   files with content delta, committing as one squash-shaped commit,
   and opening a fresh PR that merged cleanly.

6. **`git diff origin/main..HEAD -- frontend/src` returned empty inside
   the worktree.** Pathspec resolution against a sparse worktree was
   confused — probably expected the path relative to the worktree root,
   not the repo root. `--stat` without pathspec worked; and running from
   the main repo root (`C:/SCAD/Projects/GAME_Scheduler`) with the
   branch name explicit worked. Don't use pathspec inside the sparse
   worktree; use `--stat` or run from the main repo.

7. **`gh pr merge --delete-branch` partial-failed.** The squash-merge to
   main succeeded, but the `--delete-branch` step errored because the
   local branch was checked out by the temporary worktree. The remote
   branch was deleted; the local one needed `git worktree remove` +
   `git branch -d` as a separate step. Always remove the worktree
   before deleting its branch.

## Steps to recreate this layout

If you need to redo a similar topbar restructure (or add a slot-pattern
to a child component):

### 1. Export the shared list from the child

In `QuarterSchedule.tsx`:

```tsx
export const QUARTER_OPTIONS: ReadonlyArray<string> = ["Fall", "Winter", "Spring", "Summer"]
```

Both the child (if it still renders a fallback) and the parent (topbar
select) read from the same source.

### 2. Add the slot prop

```tsx
import { type ReactNode } from "react"

export interface QuarterScheduleProps {
  // ... existing props, minus onSetQuarter ...
  /** Left-side slot in the schedule panel header — the "input" half of
   *  the Resume → Assemble data flow. */
  inputSlot?: ReactNode
}
```

In the panel header JSX, replace the old `<h2>` title with
`{props.inputSlot}`. The `.schedule__toolbar` on the right stays put.

### 3. Restructure the topbar in `App.tsx`

Three zones as siblings under `<header className="scheduler__topbar">`:

```tsx
<div className="scheduler__topbar-left">
  <button className="topbar-hamburger" onClick={openRosterDrawer}>☰</button>
  <span className="topbar-quarter">
    <span className="topbar-quarter__select-wrap">
      <select className="topbar-quarter__select" value={state.quarter}
              onChange={e => setQuarter(e.target.value)}>
        {QUARTER_OPTIONS.map(q => <option key={q} value={q}>{q}</option>)}
      </select>
      <span className="topbar-quarter__caret" aria-hidden="true">▾</span>
    </span>
    {" "}Schedule
  </span>
</div>
<div className="scheduler__topbar-center">
  <div className="scheduler__title-group">
    <BrandEyebrow />
    <h1 className="scheduler__title">Course Planner</h1>
  </div>
</div>
<div className="scheduler__topbar-right">
  {/* Export, theme toggle, DataIssuesPanel, TopbarMenu */}
</div>
```

Pass Resume down as `inputSlot`:

```tsx
<QuarterSchedule
  // ... existing props ...
  inputSlot={
    <div className="schedule__input">
      <button className="topbar-btn topbar-btn--resume" onClick={triggerReloadPicker}>
        Resume from Excel
      </button>
      {reloadMtime !== null && (
        <span className="schedule__input-loaded">{/* ... */}</span>
      )}
      <input ref={fileInputRef} type="file" style={{display: "none"}} {/* ... */} />
    </div>
  }
/>
```

### 4. CSS — grid + zones + selector

```css
.scheduler__topbar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg);
  min-height: 52px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.scheduler__topbar-left   { justify-self: start;  display: flex; align-items: center; gap: var(--space-sm); }
.scheduler__topbar-center { justify-self: center; }
.scheduler__topbar-right  { justify-self: end;    display: flex; align-items: center; gap: var(--space-sm); }
```

Quarter selector uses `appearance: none` on the `<select>` and an
absolute-positioned `▾` caret so native behavior survives. Copy the
pattern from the retired `.panel__title-select-*` rules — same idea,
new class names.

### 5. Mobile override

```css
@media (max-width: 767px) {
  .scheduler__topbar {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-sm);
  }
  .scheduler__topbar-left,
  .scheduler__topbar-right { justify-self: auto; flex-wrap: wrap; }
  .scheduler__topbar-center { justify-self: auto; order: -1; }
}
```

Without `order: -1`, the title appears between the two action zones in
the collapsed column — disorienting because on desktop it's above them.

### 6. Retire stale CSS

Delete `.panel__title-select-wrap`, `.panel__title-select`,
`.panel__title-select:focus-visible`, `.panel__title-select-caret` — no
callers. Rename `.topbar-resume` → `.schedule__input` and
`.topbar-resume__loaded` → `.schedule__input-loaded`. Keep
`.topbar-btn.topbar-btn--resume` (button class unchanged).

### 7. Verify in-browser, not just with build

```bash
cd frontend && npm run build   # tsc + vite must be clean
```

Then preview the actual page. For layout work, screenshots are the
acceptance test:

- Desktop (≥1024px): `FALL ▾ SCHEDULE` reads as eyebrow, `Course Planner`
  is centered under the `SCAD:Prototype` eyebrow, Resume sits left of
  ASSEMBLE in the schedule row.
- Mobile (<768px): topbar stacks, title is above the action zones.

### 8. Push to main when the feature branch has stale squash-merge history

If the branch has 20+ commits ahead of main but only a handful of files
actually differ, `gh pr create` will return `mergeStateStatus: DIRTY`.
The individual commits on the branch aren't reachable from main's
squash-merged commits. Recovery:

```bash
# From the repo root (not a sparse worktree)
git diff origin/main..<branch> --stat     # confirm the actual delta

# Spin up a clean worktree off main
git worktree add -b <new-branch> <path> origin/main
cd <path>

# Pull in only the files that have content delta
git checkout <stale-branch> -- <file1> <file2> ...

# Commit as one squash-shaped commit, push, PR, squash-merge
git commit -m "feat: ..."
git push -u origin <new-branch>
gh pr create --base main ...
gh pr view <n> --json mergeable,mergeStateStatus  # should be CLEAN/MERGEABLE
gh pr merge <n> --squash
git worktree remove <path>
git branch -d <new-branch>
```

The old feature branch stays around with its stale history; don't try
to rebase it back onto main (the conflicts are not real, just SHA
ghosts, and forcing through them risks undoing the squash merge).

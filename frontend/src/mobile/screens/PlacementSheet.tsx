/**
 * Bottom-sheet course picker invoked by tapping an Open slot.
 *
 * Two source modes via the tab toggle at top:
 *   - Roster: unplaced offerings already added to the quarter (the
 *     fast path; chairs usually placed everything on desktop and just
 *     need to slot it on mobile).
 *   - Catalog: any course in the catalog. Picking from here mints a
 *     fresh Offering and places it at the slot — same default fields
 *     desktop uses (priority "should_have", AUTO prof/room).
 *
 * Search filter applies to whichever tab is active.
 */
import { useMemo, useState } from "react"
import type { Course, Offering, Slot, TimeSlot } from "../../types"

const TIME_SLOT_LABEL: Record<TimeSlot, string> = {
  "8:00AM":  "8 AM",
  "11:00AM": "11 AM",
  "2:00PM":  "2 PM",
  "5:00PM":  "5 PM",
}

const DAY_LABEL: Record<number, string> = { 1: "MW", 2: "TTh", 3: "F" }

type Mode = "roster" | "catalog"

interface Props {
  slot: Slot
  offerings: Offering[]
  catalog: Record<string, Course>
  onDismiss: () => void
  onPlaceFromRoster: (offering_id: string) => void
  onPlaceFromCatalog: (catalog_id: string) => void
}

export function PlacementSheet(props: Props) {
  const { slot, offerings, catalog, onDismiss } = props
  const [mode, setMode] = useState<Mode>("roster")
  const [query, setQuery] = useState("")

  const rosterCandidates = useMemo(
    () => offerings.filter(o => o.pinned === null && o.assignment === null),
    [offerings],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (catalog_id: string, title?: string) => {
      if (!q) return true
      if (catalog_id.toLowerCase().includes(q)) return true
      if (title && title.toLowerCase().includes(q)) return true
      return false
    }
    if (mode === "roster") {
      return rosterCandidates
        .filter(o => matches(o.catalog_id, catalog[o.catalog_id]?.name))
        .sort((a, b) => a.catalog_id.localeCompare(b.catalog_id))
        .map(o => ({
          key: o.offering_id,
          catalog_id: o.catalog_id,
          title: catalog[o.catalog_id]?.name ?? "",
          onPick: () => props.onPlaceFromRoster(o.offering_id),
        }))
    }
    return Object.values(catalog)
      .filter(c => matches(c.id, c.name))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(c => ({
        key: c.id,
        catalog_id: c.id,
        title: c.name,
        onPick: () => props.onPlaceFromCatalog(c.id),
      }))
  }, [mode, query, rosterCandidates, catalog, props])

  const slotLabel = `${DAY_LABEL[slot.day_group]} · ${TIME_SLOT_LABEL[slot.time_slot]}`
  const rosterCount = rosterCandidates.length
  const catalogCount = Object.keys(catalog).length

  const emptyText = (() => {
    if (filtered.length > 0) return null
    if (query) return "No matches."
    if (mode === "roster") {
      return "All offerings are placed. Switch to Catalog to add a new section."
    }
    return "Catalog is empty."
  })()

  return (
    <>
      <div
        className="m-sheet__scrim"
        onClick={onDismiss}
        aria-hidden="true"
      />
      <aside
        className="m-sheet"
        role="dialog"
        aria-label={`Place a course at ${slotLabel}`}
      >
        <header className="m-sheet__header">
          <div>
            <div className="m-sheet__eyebrow">Place at</div>
            <h2 className="m-sheet__title">{slotLabel}</h2>
          </div>
          <button
            type="button"
            className="m-sheet__close"
            onClick={onDismiss}
            aria-label="Close placement sheet"
          >
            ×
          </button>
        </header>

        <nav
          className="m-sheet__tabs"
          aria-label="Course source"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "roster"}
            className={
              "m-sheet__tab" +
              (mode === "roster" ? " m-sheet__tab--active" : "")
            }
            onClick={() => setMode("roster")}
          >
            Roster <span className="m-sheet__tab-count">{rosterCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "catalog"}
            className={
              "m-sheet__tab" +
              (mode === "catalog" ? " m-sheet__tab--active" : "")
            }
            onClick={() => setMode("catalog")}
          >
            Catalog <span className="m-sheet__tab-count">{catalogCount}</span>
          </button>
        </nav>

        <div className="m-sheet__search-wrap">
          <input
            type="search"
            className="m-sheet__search"
            placeholder={
              mode === "roster"
                ? "Search unplaced offerings…"
                : "Search the full catalog…"
            }
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        {emptyText ? (
          <div className="m-sheet__empty">{emptyText}</div>
        ) : (
          <ul className="m-sheet__list">
            {filtered.map(item => (
              <li key={item.key}>
                <button
                  type="button"
                  className="m-sheet__item"
                  onClick={item.onPick}
                >
                  <span className="m-sheet__item-id">{item.catalog_id}</span>
                  {item.title && (
                    <span className="m-sheet__item-title">{item.title}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </>
  )
}

/**
 * Bottom-sheet course picker invoked by tapping an Open slot. Lists the
 * unplaced offerings (those without a chair pin or solver assignment),
 * searchable, alphabetical. Tap one to place it at the slot the chair
 * was looking at when they opened the sheet.
 *
 * v1 scope: existing unplaced offerings only. Adding NEW offerings from
 * the catalogue is a separate flow that lands in a later pass — chairs
 * on the run are usually placing courses already added on desktop.
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

interface Props {
  slot: Slot
  offerings: Offering[]
  catalog: Record<string, Course>
  onDismiss: () => void
  onPlace: (offering_id: string) => void
}

export function PlacementSheet(props: Props) {
  const { slot, offerings, catalog, onDismiss, onPlace } = props
  const [query, setQuery] = useState("")

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return offerings
      .filter(o => o.pinned === null && o.assignment === null)
      .filter(o => {
        if (!q) return true
        if (o.catalog_id.toLowerCase().includes(q)) return true
        const title = catalog[o.catalog_id]?.title.toLowerCase() ?? ""
        return title.includes(q)
      })
      .sort((a, b) => a.catalog_id.localeCompare(b.catalog_id))
  }, [offerings, catalog, query])

  const slotLabel = `${DAY_LABEL[slot.day_group]} · ${TIME_SLOT_LABEL[slot.time_slot]}`

  return (
    <>
      <div
        className="m-sheet__scrim"
        onClick={onDismiss}
        aria-hidden="true"
      />
      <aside className="m-sheet" role="dialog" aria-label={`Place a course at ${slotLabel}`}>
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
        <div className="m-sheet__search-wrap">
          <input
            type="search"
            className="m-sheet__search"
            placeholder="Search course ID or name…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        {candidates.length === 0 ? (
          <div className="m-sheet__empty">
            {query
              ? "No matching unplaced offerings."
              : "All offerings are placed. Add more from the desktop catalogue."}
          </div>
        ) : (
          <ul className="m-sheet__list">
            {candidates.map(o => {
              const title = catalog[o.catalog_id]?.title ?? ""
              return (
                <li key={o.offering_id}>
                  <button
                    type="button"
                    className="m-sheet__item"
                    onClick={() => onPlace(o.offering_id)}
                  >
                    <span className="m-sheet__item-id">{o.catalog_id}</span>
                    {title && (
                      <span className="m-sheet__item-title">{title}</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </aside>
    </>
  )
}

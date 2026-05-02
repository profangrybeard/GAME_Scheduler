/**
 * Schedule home screen. The "where am I" surface chairs land on first.
 *
 * Framed as INVENTORY MANAGEMENT, not calendar (see memory:
 * feedback_mobile_is_inventory.md). Each day group (MW / TTh / F) is one
 * inventory of time × room × prof allocations. Chairs swipe between
 * inventories to see what's filled and what's open.
 *
 * v1: render the placed-offerings list per day, grouped by time slot.
 * Day nav is buttons today; swipe gesture lands in a follow-up.
 */
import { useMemo, useRef, useState } from "react"
import { useSchedulerState } from "../../state/SchedulerStateContext"
import type { DayGroup, Offering, TimeSlot } from "../../types"

/** Min horizontal travel before a swipe commits to changing days. Smaller
 *  feels twitchy; larger fights short thumb-strokes. 50px is the iOS
 *  Mail / Photos default and translates well to a 375px viewport. */
const SWIPE_COMMIT_PX = 50
/** Below this, we haven't locked an axis yet — taps and tiny jitters are
 *  ignored. Above it, the dominant axis wins for the rest of the gesture. */
const SWIPE_LOCK_PX = 8

const DAYS: ReadonlyArray<{ label: string; group: DayGroup }> = [
  { label: "MW",  group: 1 },
  { label: "TTh", group: 2 },
  { label: "F",   group: 3 },
]

const TIME_SLOTS: ReadonlyArray<{ value: TimeSlot; label: string }> = [
  { value: "8:00AM",  label: "8 AM" },
  { value: "11:00AM", label: "11 AM" },
  { value: "2:00PM",  label: "2 PM" },
  { value: "5:00PM",  label: "5 PM" },
]

/** Effective slot for an offering: chair pin wins, then solver assignment.
 *  null means not placed. */
function effectiveSlot(o: Offering) {
  return o.pinned ?? o.assignment?.slot ?? null
}

function effectiveProfId(o: Offering): string | null {
  return o.assigned_prof_id ?? o.assignment?.prof_id ?? null
}

function effectiveRoomId(o: Offering): string | null {
  return o.assigned_room_id ?? o.assignment?.room_id ?? null
}

export function ScheduleScreen() {
  const [state] = useSchedulerState()
  const [activeGroup, setActiveGroup] = useState<DayGroup>(1)

  /** Pointer-based horizontal swipe between days. Vertical pan is left to
   *  the browser via touch-action: pan-y on the content section, so this
   *  only ever sees horizontal intent — no manual scroll fighting. */
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const swipeAxis = useRef<"h" | "v" | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return
    swipeStart.current = { x: e.clientX, y: e.clientY }
    swipeAxis.current = null
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!swipeStart.current || swipeAxis.current) return
    const dx = e.clientX - swipeStart.current.x
    const dy = e.clientY - swipeStart.current.y
    if (Math.abs(dx) > SWIPE_LOCK_PX || Math.abs(dy) > SWIPE_LOCK_PX) {
      swipeAxis.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v"
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const start = swipeStart.current
    swipeStart.current = null
    const axis = swipeAxis.current
    swipeAxis.current = null
    if (!start || axis !== "h") return
    const dx = e.clientX - start.x
    if (Math.abs(dx) < SWIPE_COMMIT_PX) return
    setActiveGroup(g => {
      const next = dx < 0 ? g + 1 : g - 1
      if (next < 1 || next > 3) return g
      return next as DayGroup
    })
  }

  const onPointerCancel = () => {
    swipeStart.current = null
    swipeAxis.current = null
  }

  /** All placed offerings for the active day, grouped by time slot. */
  const slotsForDay = useMemo(() => {
    const buckets = new Map<TimeSlot, Offering[]>()
    for (const slot of TIME_SLOTS) buckets.set(slot.value, [])
    for (const offering of state.offerings) {
      const slot = effectiveSlot(offering)
      if (!slot || slot.day_group !== activeGroup) continue
      buckets.get(slot.time_slot)?.push(offering)
    }
    return buckets
  }, [state.offerings, activeGroup])

  const placedCount = useMemo(
    () => state.offerings.filter(o => {
      const slot = effectiveSlot(o)
      return slot != null && slot.day_group === activeGroup
    }).length,
    [state.offerings, activeGroup],
  )

  // Canonical quarter is lowercase ("fall"); capitalize for display.
  const quarterLabel = state.quarter.charAt(0).toUpperCase() + state.quarter.slice(1)

  return (
    <main className="m-schedule">
      <header className="m-schedule__appbar">
        <button type="button" className="m-schedule__quarter">
          {quarterLabel} <span className="m-schedule__quarter-caret" aria-hidden="true">▾</span>
        </button>
        <span className="m-schedule__count" aria-label={`${placedCount} courses on this day`}>
          {placedCount} placed
        </span>
      </header>

      <nav className="m-schedule__days" aria-label="Day group">
        {DAYS.map(day => (
          <button
            key={day.group}
            type="button"
            className={
              "m-schedule__day" +
              (day.group === activeGroup ? " m-schedule__day--active" : "")
            }
            onClick={() => setActiveGroup(day.group)}
          >
            {day.label}
          </button>
        ))}
      </nav>

      <section
        className="m-schedule__content"
        aria-label={`${DAYS.find(d => d.group === activeGroup)?.label} schedule`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {TIME_SLOTS.map(slot => {
          const offerings = slotsForDay.get(slot.value) ?? []
          return (
            <div key={slot.value} className="m-slot">
              <div className="m-slot__header">
                <span className="m-slot__time">{slot.label}</span>
                <span className="m-slot__count">{offerings.length || "—"}</span>
              </div>
              {offerings.length === 0 ? (
                <div className="m-slot__empty">Open</div>
              ) : (
                <ul className="m-slot__list">
                  {offerings.map(o => {
                    const profId = effectiveProfId(o)
                    const roomId = effectiveRoomId(o)
                    const profName = profId ? state.professors[profId]?.name ?? profId : "AUTO"
                    const roomLabel = roomId ? state.rooms[roomId]?.id ?? roomId : "AUTO"
                    return (
                      <li key={o.offering_id} className="m-card">
                        <div className="m-card__id">{o.catalog_id}</div>
                        <div className="m-card__meta">
                          <span className="m-card__prof">{profName}</span>
                          <span className="m-card__sep" aria-hidden="true">·</span>
                          <span className="m-card__room">{roomLabel}</span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </section>
    </main>
  )
}

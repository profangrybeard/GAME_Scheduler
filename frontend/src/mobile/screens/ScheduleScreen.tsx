/**
 * Schedule home screen. The "where am I" surface chairs land on first.
 *
 * Framed as INVENTORY MANAGEMENT, not calendar (see memory:
 * feedback_mobile_is_inventory.md). Each day group (MW / TTh / F) is one
 * inventory of time × room × prof allocations. Chairs swipe between
 * inventories — content tracks the finger 1:1, snaps on release, and
 * rubber-bands at the edges so the boundary is felt rather than learned.
 */
import { useMemo, useRef, useState } from "react"
import { useSchedulerState } from "../../state/SchedulerStateContext"
import type { DayGroup, Offering, TimeSlot } from "../../types"

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

/** Min horizontal travel before a slow swipe commits. iOS Mail / Photos
 *  default; smaller is twitchy on a 375px viewport. */
const SWIPE_DISTANCE_PX = 50
/** Above this px/ms a flick commits regardless of distance — matches
 *  the native "you barely moved but you flicked" feel. */
const SWIPE_VELOCITY_PX_PER_MS = 0.4
/** Below this, axis stays unlocked — taps and tiny jitters don't trigger
 *  a horizontal drag. Bumped from 8 to give Android Chrome more room to
 *  surface horizontal intent before its own gesture detection fires. */
const AXIS_LOCK_PX = 10
/** Multiplier for vertical-axis preference. Without this, a 45° diagonal
 *  swipe locks to vertical (since |dy| edges out |dx| by a hair) and the
 *  pager never sees horizontal intent — common on Android where natural
 *  thumb-arcs aren't perfectly horizontal. 1.5 means dy must dominate dx
 *  by at least 1.5× to lock vertical; otherwise we treat it as horizontal. */
const VERTICAL_LOCK_RATIO = 1.5
/** Edge rubber-band coefficient. <1 means "drag past edge feels heavier." */
const EDGE_DAMPING = 0.3

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
  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  // TEMPORARY: live event HUD for diagnosing why swipe doesn't fire on
  // certain Android devices. Pull this once we've confirmed which event
  // family lands on the user's hardware.
  const [debugEvent, setDebugEvent] = useState<string>("(no events yet)")

  const startRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const axisRef = useRef<"h" | "v" | null>(null)
  /** Which event family claimed this gesture. Pointer-cancel events from
   *  Chrome's scroll-detection will fire mid-drag on Android even while
   *  touch events keep streaming — so cancels from a non-owning family
   *  are ignored. */
  const sourceRef = useRef<"pointer" | "touch" | null>(null)

  /** Bucket every placed offering by (day_group, time_slot) once per state
   *  change. All 3 day pages read from the same map, so swiping doesn't
   *  re-filter on every render. */
  const slotsByDay = useMemo(() => {
    const all = new Map<DayGroup, Map<TimeSlot, Offering[]>>()
    for (const day of DAYS) {
      const buckets = new Map<TimeSlot, Offering[]>()
      for (const ts of TIME_SLOTS) buckets.set(ts.value, [])
      all.set(day.group, buckets)
    }
    for (const offering of state.offerings) {
      const slot = effectiveSlot(offering)
      if (!slot) continue
      all.get(slot.day_group)?.get(slot.time_slot)?.push(offering)
    }
    return all
  }, [state.offerings])

  const placedCount = useMemo(() => {
    let n = 0
    const buckets = slotsByDay.get(activeGroup)
    if (!buckets) return 0
    for (const list of buckets.values()) n += list.length
    return n
  }, [slotsByDay, activeGroup])

  /** Shared gesture core. Both pointer-event and touch-event handlers
   *  call into these so we get the same behaviour from whichever event
   *  family the device actually fires. The first start to land claims
   *  the gesture; later starts (e.g. touchstart firing right after
   *  pointerdown on the same finger) become no-ops. */
  const startGesture = (
    x: number,
    y: number,
    t: number,
    source: "pointer" | "touch",
  ) => {
    if (startRef.current) return
    startRef.current = { x, y, t }
    axisRef.current = null
    sourceRef.current = source
    moveCountRef.current = 0
  }

  const moveCountRef = useRef(0)

  const moveGesture = (x: number, y: number) => {
    const start = startRef.current
    if (!start) {
      setDebugEvent(`move-no-start x=${Math.round(x)} y=${Math.round(y)}`)
      return
    }
    moveCountRef.current += 1
    const dx = Math.round(x - start.x)
    const dy = Math.round(y - start.y)
    if (!axisRef.current) {
      if (Math.abs(dx) <= AXIS_LOCK_PX && Math.abs(dy) <= AXIS_LOCK_PX) {
        setDebugEvent(`move#${moveCountRef.current} dx=${dx} dy=${dy} (deadzone)`)
        return
      }
      axisRef.current =
        Math.abs(dy) > Math.abs(dx) * VERTICAL_LOCK_RATIO ? "v" : "h"
      if (axisRef.current === "h") setIsDragging(true)
    }
    setDebugEvent(`move#${moveCountRef.current} dx=${dx} dy=${dy} axis=${axisRef.current}`)
    if (axisRef.current !== "h") return
    const atStart = activeGroup === 1 && dx > 0
    const atEnd = activeGroup === 3 && dx < 0
    setDragX(atStart || atEnd ? dx * EDGE_DAMPING : dx)
  }

  const endGesture = (x: number, t: number, source: "pointer" | "touch") => {
    if (sourceRef.current !== source) return
    const start = startRef.current
    const axis = axisRef.current
    startRef.current = null
    axisRef.current = null
    sourceRef.current = null
    setIsDragging(false)
    if (!start || axis !== "h") {
      setDragX(0)
      return
    }
    const dx = x - start.x
    const dt = Math.max(1, t - start.t)
    const velocity = dx / dt
    const distanceCommit = Math.abs(dx) >= SWIPE_DISTANCE_PX
    const velocityCommit = Math.abs(velocity) >= SWIPE_VELOCITY_PX_PER_MS
    let next: DayGroup = activeGroup
    if (distanceCommit || velocityCommit) {
      if (dx < 0 && activeGroup < 3) next = (activeGroup + 1) as DayGroup
      else if (dx > 0 && activeGroup > 1) next = (activeGroup - 1) as DayGroup
    }
    setActiveGroup(next)
    setDragX(0)
  }

  const cancelGesture = (source: "pointer" | "touch") => {
    if (sourceRef.current !== source) return
    startRef.current = null
    axisRef.current = null
    sourceRef.current = null
    setIsDragging(false)
    setDragX(0)
  }

  // Pointer-event path. Touch-typed pointer events are handed off to the
  // dedicated touch path because Android Chrome fires pointercancel mid-
  // gesture (it speculatively decides "this is a scroll") even when touch
  // events keep streaming. Letting pointer handlers claim a touch gesture
  // means a stray pointercancel kills our state while touchmoves keep
  // arriving into nothing. So: pointer for mouse/pen, touch for touch.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return
    setDebugEvent(`P-down ${e.pointerType} ${Math.round(e.clientX)},${Math.round(e.clientY)}`)
    if (e.pointerType === "mouse" && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    startGesture(e.clientX, e.clientY, e.timeStamp, "pointer")
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return
    moveGesture(e.clientX, e.clientY)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return
    setDebugEvent(`P-up ${Math.round(e.clientX)},${Math.round(e.clientY)} axis=${axisRef.current ?? "?"}`)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    endGesture(e.clientX, e.timeStamp, "pointer")
  }
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return
    setDebugEvent(`P-cancel src=${sourceRef.current ?? "none"} (${e.pointerType})`)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    cancelGesture("pointer")
  }

  // Touch-event fallback. On some Android browsers (notably Samsung
  // Internet, certain Chrome versions inside the Samsung shell) pointer
  // events get swallowed by gesture detection while touch events still
  // fire. Listening to both ensures the swipe lands no matter which
  // family the device actually produces.
  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const t0 = e.touches[0]
    setDebugEvent(`T-start n=${e.touches.length} ${t0 ? `${Math.round(t0.clientX)},${Math.round(t0.clientY)}` : "??"}`)
    if (e.touches.length !== 1) {
      cancelGesture("touch")
      return
    }
    startGesture(t0.clientX, t0.clientY, e.timeStamp, "touch")
  }
  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    moveGesture(t.clientX, t.clientY)
  }
  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const t = e.changedTouches[0]
    setDebugEvent(`T-end ${t ? `${Math.round(t.clientX)},${Math.round(t.clientY)}` : "??"} axis=${axisRef.current ?? "?"}`)
    if (!t) {
      cancelGesture("touch")
      return
    }
    endGesture(t.clientX, e.timeStamp, "touch")
  }
  const onTouchCancel = () => {
    setDebugEvent(`T-cancel src=${sourceRef.current ?? "none"}`)
    cancelGesture("touch")
  }

  // Canonical quarter is lowercase ("fall"); capitalize for display.
  const quarterLabel = state.quarter.charAt(0).toUpperCase() + state.quarter.slice(1)
  const baseOffsetPct = -(activeGroup - 1) * 100

  return (
    <main className="m-schedule">
      <div className="m-debug-hud" aria-hidden="true">{debugEvent}</div>
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

      <div
        className="m-schedule__pager"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        <div
          className="m-schedule__track"
          style={{
            transform: `translateX(calc(${baseOffsetPct}% + ${dragX}px))`,
            transition: isDragging
              ? "none"
              : "transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)",
          }}
        >
          {DAYS.map(day => (
            <DayPage
              key={day.group}
              dayLabel={day.label}
              buckets={slotsByDay.get(day.group)!}
              professors={state.professors}
              rooms={state.rooms}
            />
          ))}
        </div>
      </div>
    </main>
  )
}

function DayPage(props: {
  dayLabel: string
  buckets: Map<TimeSlot, Offering[]>
  professors: Record<string, { name: string }>
  rooms: Record<string, { id: string }>
}) {
  return (
    <section
      className="m-schedule__page"
      aria-label={`${props.dayLabel} schedule`}
    >
      {TIME_SLOTS.map(slot => {
        const offerings = props.buckets.get(slot.value) ?? []
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
                  const profName = profId ? props.professors[profId]?.name ?? profId : "AUTO"
                  const roomLabel = roomId ? props.rooms[roomId]?.id ?? roomId : "AUTO"
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
  )
}

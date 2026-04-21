/**
 * Mobile read-only view of a single published schedule.
 *
 * Intentionally duplicates (rather than reuses) the desktop QuarterSchedule
 * render path. The desktop grid is ~500 lines of drag/drop + tap-to-place +
 * toolbar logic that we don't want to conditionally unwire. A lean mobile
 * component is simpler, safer, and lets the mobile look diverge (vertical
 * day-group stacking, bigger type) without desktop regressions.
 *
 * If/when the desktop grid gets extracted into a pure <ScheduleGrid /> we
 * can collapse this down to a thin wrapper.
 */
import { useState } from "react"
import { MobileBrandEyebrow } from "./MobileBrandEyebrow"
import { MobileThemeToggle } from "./MobileThemeToggle"
import type { DayGroup, Offering, TimeSlot } from "../types"
import type { PublishedSchedule } from "./publishedFixtures"

interface PublishedScheduleViewProps {
  schedule: PublishedSchedule
  onBack: () => void
}

const DAY_GROUPS: ReadonlyArray<{ key: DayGroup; label: string; full: string }> = [
  { key: 1, label: "MW",  full: "Mon / Wed" },
  { key: 2, label: "TTh", full: "Tue / Thu" },
  { key: 3, label: "F",   full: "Fri" },
]

const TIME_SLOTS: ReadonlyArray<TimeSlot> = ["8:00AM", "11:00AM", "2:00PM", "5:00PM"]

function formatPublished(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    month:  "short",
    day:    "numeric",
    year:   "numeric",
  })
}

/** Same mailto template as the invite card on the index, duplicated here
 *  as a tiny helper to avoid a shared util for three lines. Reminder-chip
 *  in the schedule view so users who landed directly on a deep link still
 *  have a one-tap way to carry the URL over to desktop. */
function buildMailtoHref(url: string): string {
  const body = `Open on a larger screen for the full workspace:\n\n${url}\n`
  return (
    "mailto:?subject=" + encodeURIComponent("GAME Scheduler — open on desktop") +
    "&body=" + encodeURIComponent(body)
  )
}

export function PublishedScheduleView(props: PublishedScheduleViewProps) {
  const { schedule } = props
  const [dayGroup, setDayGroup] = useState<DayGroup>(1)
  /** null = "All" — every card shown at full strength. Any other value dims
   *  cards whose assigned prof doesn't match, instead of hiding them, so
   *  the layout (and neighbor context) stays intact. */
  const [activeProfId, setActiveProfId] = useState<string | null>(null)
  const { offerings, professors, rooms, catalog } = schedule.snapshot

  // Bucket offerings by (day_group, time_slot) using their assignment. Only
  // assigned offerings render in the grid; pins+unassigned stay hidden on
  // mobile since there's no meaningful way to convey "unplaced" in a
  // read-only view.
  const byCell = new Map<string, Offering[]>()
  for (const o of offerings) {
    if (!o.assignment) continue
    const key = `${o.assignment.slot.day_group}|${o.assignment.slot.time_slot}`
    const bucket = byCell.get(key) ?? []
    bucket.push(o)
    byCell.set(key, bucket)
  }

  // Distinct prof IDs actually referenced in this snapshot's assignments,
  // sorted by display name. We show a chip per prof (+ an "All" chip) so
  // the user can scan one person's week at a time.
  const profIdsInUse = Array.from(
    new Set(offerings.filter(o => o.assignment).map(o => o.assignment!.prof_id)),
  ).sort((a, b) => (professors[a]?.name ?? a).localeCompare(professors[b]?.name ?? b))

  return (
    <main className="mobile-schedule">
      <header className="mobile-schedule__header">
        <div className="mobile-schedule__top-row">
          <button
            type="button"
            className="mobile-schedule__back"
            onClick={props.onBack}
            aria-label="Back to schedules"
          >
            <span aria-hidden="true">←</span> Schedules
          </button>
          <MobileThemeToggle />
        </div>
        <div className="mobile-schedule__title-group">
          <MobileBrandEyebrow />
          <h1 className="mobile-schedule__title">
            {schedule.quarter} {schedule.year}
          </h1>
          <div className="mobile-schedule__meta">
            v{schedule.version} · {formatPublished(schedule.publishedAt)} · {schedule.author}
          </div>
          <a
            className="mobile-schedule__email-chip"
            href={buildMailtoHref(typeof window !== "undefined" ? window.location.href : "")}
          >
            <span aria-hidden="true">✉</span>
            <span>Email this link</span>
          </a>
        </div>
      </header>

      <div className="mobile-schedule__day-toggle" role="tablist" aria-label="Day group">
        {DAY_GROUPS.map(g => (
          <button
            key={g.key}
            type="button"
            role="tab"
            aria-selected={dayGroup === g.key}
            className={
              "mobile-schedule__day-btn" +
              (dayGroup === g.key ? " mobile-schedule__day-btn--active" : "")
            }
            onClick={() => setDayGroup(g.key)}
          >
            {g.label}
          </button>
        ))}
      </div>

      {profIdsInUse.length > 1 && (
        <div
          className="mobile-schedule__prof-filter"
          role="tablist"
          aria-label="Filter by professor"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeProfId === null}
            className={
              "mobile-prof-chip" +
              (activeProfId === null ? " mobile-prof-chip--active" : "")
            }
            onClick={() => setActiveProfId(null)}
          >
            All
          </button>
          {profIdsInUse.map(pid => {
            const active = activeProfId === pid
            return (
              <button
                key={pid}
                type="button"
                role="tab"
                aria-selected={active}
                className={
                  "mobile-prof-chip" +
                  (active ? " mobile-prof-chip--active" : "")
                }
                onClick={() => setActiveProfId(active ? null : pid)}
              >
                {professors[pid]?.name ?? pid}
              </button>
            )
          })}
        </div>
      )}

      <section className="mobile-schedule__slots" aria-label={
        DAY_GROUPS.find(g => g.key === dayGroup)?.full ?? ""
      }>
        {TIME_SLOTS.map(ts => {
          const cards = byCell.get(`${dayGroup}|${ts}`) ?? []
          return (
            <article key={ts} className="mobile-slot">
              <h2 className="mobile-slot__time">{ts}</h2>
              {cards.length === 0 ? (
                <div className="mobile-slot__empty">—</div>
              ) : (
                <ul className="mobile-slot__cards" role="list">
                  {cards.map(o => {
                    const course = catalog[o.catalog_id]
                    const prof   = o.assignment ? professors[o.assignment.prof_id] : null
                    const room   = o.assignment ? rooms[o.assignment.room_id]       : null
                    const dept   = course?.department ?? "game"
                    const dimmed = activeProfId !== null && o.assignment?.prof_id !== activeProfId
                    return (
                      <li
                        key={o.offering_id}
                        className={
                          "mobile-card dept--" + dept +
                          (dimmed ? " mobile-card--dim" : "")
                        }
                      >
                        <div className="mobile-card__id">{o.catalog_id}</div>
                        <div className="mobile-card__name">{course?.name ?? "—"}</div>
                        <div className="mobile-card__meta">
                          <span className="mobile-card__prof">
                            {prof?.name ?? "Unassigned"}
                          </span>
                          {room && (
                            <span className="mobile-card__room">
                              {room.name.split("–")[0].trim().replace("Room ", "")}
                            </span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </article>
          )
        })}
      </section>
    </main>
  )
}

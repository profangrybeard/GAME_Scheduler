/**
 * Schedule home screen. The "where am I" surface chairs land on first.
 * Skeleton state — structure only, no data wiring yet. Data lift from
 * App.tsx happens in the next pass once the layout is locked in.
 */
import { useState } from "react"

const DAYS = ["MW", "TTh", "F"] as const
type Day = (typeof DAYS)[number]

export function ScheduleScreen() {
  const [activeDay, setActiveDay] = useState<Day>("MW")

  return (
    <main className="m-schedule">
      <header className="m-schedule__appbar">
        <button type="button" className="m-schedule__quarter">
          Fall <span className="m-schedule__quarter-caret" aria-hidden="true">▾</span>
        </button>
      </header>

      <nav className="m-schedule__days" aria-label="Day group">
        {DAYS.map(day => (
          <button
            key={day}
            type="button"
            className={
              "m-schedule__day" +
              (day === activeDay ? " m-schedule__day--active" : "")
            }
            onClick={() => setActiveDay(day)}
          >
            {day}
          </button>
        ))}
      </nav>

      <section className="m-schedule__content" aria-label={`${activeDay} schedule`}>
        <p className="m-schedule__empty">No courses scheduled.</p>
      </section>
    </main>
  )
}

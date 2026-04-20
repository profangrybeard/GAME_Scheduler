/**
 * Mobile landing: list of published schedules for the current academic year,
 * grouped by quarter. Fall / Winter / Spring / Summer each get a section;
 * quarters with no versions published render an empty-state row.
 *
 * The desktop workspace is completely hidden under 768px — this is the only
 * thing mobile users see. Read-only by design; no Generate, no editing.
 */
import { groupByQuarter, type PublishedSchedule, type Quarter } from "./publishedFixtures"

interface PublishedIndexProps {
  onOpen: (id: string) => void
}

function formatPublished(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    month: "short",
    day:   "numeric",
    year:  "numeric",
  })
}

function quarterLabel(quarter: Quarter, year: number): string {
  return `${quarter} ${year}`
}

export function PublishedIndex(props: PublishedIndexProps) {
  const groups = groupByQuarter()

  // All schedules in this mock are from the same academic year. Once the
  // real API lands we'll accept academic-year as a prop / URL segment.
  const academicYear = "2025–2026"

  return (
    <main className="mobile-index">
      <header className="mobile-index__header">
        <h1 className="mobile-index__title">Schedules</h1>
        <div className="mobile-index__subtitle">Academic year {academicYear}</div>
      </header>

      <ul className="mobile-index__list" role="list">
        {groups.map(group => (
          <li key={group.quarter} className="mobile-index__group">
            <h2 className="mobile-index__group-title">
              {quarterLabel(group.quarter, group.year)}
            </h2>

            {group.versions.length === 0 ? (
              <div className="mobile-index__empty">No schedule published yet</div>
            ) : (
              <ul className="mobile-index__versions" role="list">
                {group.versions.map((v, i) => (
                  <VersionRow
                    key={v.id}
                    snapshot={v}
                    isLatest={i === 0}
                    onOpen={props.onOpen}
                  />
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <footer className="mobile-index__footer">
        <p>Editing is available on desktop. Open on a larger screen to tune and publish new versions.</p>
      </footer>
    </main>
  )
}

interface VersionRowProps {
  snapshot: PublishedSchedule
  isLatest: boolean
  onOpen: (id: string) => void
}

function VersionRow(props: VersionRowProps) {
  const { snapshot, isLatest } = props
  const placed = snapshot.snapshot.offerings.filter(o => o.assignment !== null).length
  return (
    <li className="mobile-index__version">
      <button
        type="button"
        className="mobile-index__version-btn"
        onClick={() => props.onOpen(snapshot.id)}
      >
        <span className="mobile-index__version-label">
          v{snapshot.version}
          {isLatest && <span className="mobile-index__latest-tag">Latest</span>}
        </span>
        <span className="mobile-index__version-meta">
          Published {formatPublished(snapshot.publishedAt)} · {snapshot.author}
        </span>
        <span className="mobile-index__version-stats">
          {placed} {placed === 1 ? "course" : "courses"} placed
        </span>
      </button>
    </li>
  )
}

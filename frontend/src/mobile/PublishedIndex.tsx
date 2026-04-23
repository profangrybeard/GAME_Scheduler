/**
 * Mobile landing: list of published schedules for the current academic year,
 * grouped by quarter. Fall / Winter / Spring / Summer each get a section;
 * quarters with no versions published render an empty-state row.
 *
 * The desktop workspace is completely hidden under 768px — this is the only
 * thing mobile users see. Read-only by design; no Generate, no editing.
 */
import { useState } from "react"
import { MobileBrandEyebrow } from "./MobileBrandEyebrow"
import { MobileThemeToggle } from "./MobileThemeToggle"
import {
  academicYearLabel,
  groupByQuarter,
  type PublishedSchedule,
  type Quarter,
} from "./publishedFixtures"

interface PublishedIndexProps {
  onOpen: (id: string) => void
}

/** Hand-off card shown above the schedule list. Frames the mobile view as a
 *  deliberate "reading" mode and gives the user a one-tap way to carry the
 *  URL over to a desktop browser — either via the clipboard or a prefilled
 *  email. Without this, the landing reads as a dead-end (published list +
 *  quiet footer); with it, continuing on mobile feels like a choice. */
function UpstreamInvite() {
  const [copied, setCopied] = useState(false)

  const url = typeof window !== "undefined" ? window.location.href : ""

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard permission denied or unsupported — fall through silently.
      // The email action is always available as a secondary path.
    }
  }

  const mailBody = `Open on a larger screen for the full workspace:\n\n${url}\n`
  const mailHref =
    "mailto:?subject=" + encodeURIComponent("GAME Scheduler — open on desktop") +
    "&body=" + encodeURIComponent(mailBody)

  return (
    <aside className="mobile-invite" aria-label="Open on desktop">
      <div className="mobile-invite__eyebrow">Reading view</div>
      <h2 className="mobile-invite__headline">The workspace lives on desktop.</h2>
      <p className="mobile-invite__body">
        Here you can read the published schedules. Tuning, solving, and publishing
        new versions happen on a larger screen.
      </p>
      <div className="mobile-invite__actions">
        <button
          type="button"
          className="mobile-invite__btn mobile-invite__btn--primary"
          onClick={onCopy}
          aria-live="polite"
        >
          {copied ? "Link copied" : "Copy link"}
        </button>
        <a
          className="mobile-invite__btn mobile-invite__btn--secondary"
          href={mailHref}
        >
          Email it to me
        </a>
      </div>
    </aside>
  )
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

  // Derived from the schedules in scope, so adding a new year of data
  // lights up the label automatically. When the real API replaces the
  // fixtures the same helper keeps working against whatever list it gets.
  const academicYear = academicYearLabel()

  return (
    <main className="mobile-index">
      <header className="mobile-index__header">
        <div className="mobile-index__title-group">
          <MobileBrandEyebrow />
          <h1 className="mobile-index__title">Schedules</h1>
          <div className="mobile-index__subtitle">Academic year {academicYear}</div>
        </div>
        <MobileThemeToggle />
      </header>

      <UpstreamInvite />

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

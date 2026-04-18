import { useContext } from "react"
import { PORTRAIT_BY_PROF_ID, PROF_COLORS, profInitials } from "../data"
import { PortraitContext } from "./PortraitContext"
import { ProfessorContext } from "./ProfessorContext"

/**
 * Professor avatar — renders in priority order:
 *   1. User-uploaded portrait override (data URL from localStorage)
 *   2. On-disk portrait at data/portraits/<prof_id>.<ext> (via import.meta.glob)
 *   3. Colored initials circle (PROF_COLORS[prof_id])
 *   4. Neutral silhouette (AUTO / no prof assigned)
 *
 * Chair status (gold ★ badge) is resolved from ProfessorContext so every
 * call site — roster, schedule grid, detail panel hero — shows the badge
 * consistently the moment `is_chair` flips. Do NOT stamp a badge at the
 * call site; add prof-level decoration here instead.
 */

export interface ProfAvatarProps {
  profId: string | null // null = AUTO
  name?: string | null
  size?: number
  className?: string
  title?: string
}

export function ProfAvatar({
  profId,
  name,
  size = 28,
  className = "",
  title,
}: ProfAvatarProps) {
  const overrides = useContext(PortraitContext)
  const professors = useContext(ProfessorContext)
  const label = title ?? name ?? profId ?? "AUTO"
  const style = { width: size, height: size }
  const isChair = profId ? professors[profId]?.is_chair === true : false

  // Wrap any inner element with the chair badge. Keeps className on the
  // outer wrapper so call-site layout classes (grid-area, flex-shrink)
  // continue to target the root node.
  const wrapWithBadge = (inner: React.ReactNode) => (
    <span
      className={`avatar-wrap ${className}`.trim()}
      style={style}
      title={label}
    >
      {inner}
      <span className="avatar__chair-badge" aria-label="Chair" title="Chair">
        ★
      </span>
    </span>
  )

  if (!profId) {
    // AUTO — silhouette placeholder. Never a chair.
    const iconSize = Math.max(10, size - 8)
    return (
      <span
        className={`avatar avatar--auto ${className}`.trim()}
        style={style}
        title={label}
      >
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
        </svg>
      </span>
    )
  }

  const portraitUrl = overrides[profId] ?? PORTRAIT_BY_PROF_ID[profId]
  if (portraitUrl) {
    const img = (
      <img
        src={portraitUrl}
        alt={label}
        title={isChair ? undefined : label}
        className={isChair ? "avatar avatar--photo" : `avatar avatar--photo ${className}`.trim()}
        style={style}
      />
    )
    return isChair ? wrapWithBadge(img) : img
  }

  const color = PROF_COLORS[profId] ?? "#6b7280"
  const initials = profInitials(name ?? profId)
  const fontSize = Math.max(9, Math.floor(size * 0.42))
  const initialsEl = (
    <span
      className={isChair ? "avatar avatar--initials" : `avatar avatar--initials ${className}`.trim()}
      style={{ ...style, background: color, fontSize }}
      title={isChair ? undefined : label}
    >
      {initials}
    </span>
  )
  return isChair ? wrapWithBadge(initialsEl) : initialsEl
}

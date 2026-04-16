import { useContext } from "react"
import { PORTRAIT_BY_PROF_ID, PROF_COLORS, profInitials } from "../data"
import { PortraitContext } from "./PortraitContext"

/**
 * Professor avatar — renders in priority order:
 *   1. User-uploaded portrait override (data URL from localStorage)
 *   2. On-disk portrait at data/portraits/<prof_id>.<ext> (via import.meta.glob)
 *   3. Colored initials circle (PROF_COLORS[prof_id])
 *   4. Neutral silhouette (AUTO / no prof assigned)
 *
 * Portrait overrides come from PortraitContext (set by App.tsx). Context
 * lives in ./PortraitContext so this file only exports components
 * (satisfies react-refresh/only-export-components).
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
  // Hook must be called unconditionally at the top — no branches before it.
  const overrides = useContext(PortraitContext)
  const label = title ?? name ?? profId ?? "AUTO"
  const style = { width: size, height: size }

  if (!profId) {
    // AUTO — silhouette placeholder
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
    return (
      <img
        src={portraitUrl}
        alt={label}
        title={label}
        className={`avatar avatar--photo ${className}`.trim()}
        style={style}
      />
    )
  }

  const color = PROF_COLORS[profId] ?? "#6b7280"
  const initials = profInitials(name ?? profId)
  const fontSize = Math.max(9, Math.floor(size * 0.42))
  return (
    <span
      className={`avatar avatar--initials ${className}`.trim()}
      style={{ ...style, background: color, fontSize }}
      title={label}
    >
      {initials}
    </span>
  )
}

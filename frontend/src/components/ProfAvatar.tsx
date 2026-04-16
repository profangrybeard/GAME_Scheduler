import { PORTRAIT_BY_PROF_ID, PROF_COLORS, profInitials } from "../data"

/**
 * Professor avatar — renders in priority order:
 *   1. Uploaded portrait at data/portraits/<prof_id>.<ext> (via import.meta.glob)
 *   2. Colored initials circle (PROF_COLORS[prof_id])
 *   3. Neutral silhouette (AUTO / no prof assigned)
 *
 * Size default 28px. On The Quarter Schedule cards we use 20px; in Class
 * panel hero we use 56px.
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

  const portraitUrl = PORTRAIT_BY_PROF_ID[profId]
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

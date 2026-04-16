/**
 * VersionBadge — shows the git short SHA baked into the build.
 *
 * The SHA and build timestamp are injected by vite.config.ts `define` at
 * build time. On every push to main, GitHub Pages runs a fresh build, so this
 * badge flips to the new SHA automatically — no manual bump needed.
 *
 * Click to open the commit on GitHub. Hover to see the full build timestamp.
 */

const COMMIT_URL = "https://github.com/profangrybeard/GAME_Scheduler/commit/"

function formatBuildTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString()
  } catch {
    return iso
  }
}

export function VersionBadge() {
  const sha = __APP_VERSION__
  const builtAt = formatBuildTime(__BUILD_TIME__)
  const isDev = import.meta.env.DEV
  const title = isDev
    ? `Dev build · ${sha} · started ${builtAt}`
    : `Deployed build · ${sha} · built ${builtAt}`

  return (
    <a
      className="version-badge"
      href={sha === "unknown" ? undefined : `${COMMIT_URL}${sha}`}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      aria-label={title}
    >
      {isDev && <span className="version-badge__mode">dev</span>}
      <span className="version-badge__sha">{sha}</span>
    </a>
  )
}

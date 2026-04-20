import { useEffect, useState } from "react"

/** Matches the portrait breakpoint defined in CLAUDE.md (< 768px). The mobile
 *  experience is a read-only published-schedule viewer, an entirely separate
 *  tree from the desktop workspace — so this hook gates at the App root, not
 *  inside individual components. */
const MOBILE_QUERY = "(max-width: 767px)"

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia(MOBILE_QUERY).matches
  })

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  return isMobile
}

import { useEffect, useState } from "react"

/** Matches the portrait breakpoint defined in CLAUDE.md (< 768px). Path C of
 *  the mobile rebuild: phones get a separate, purpose-built tree (MobileApp)
 *  designed for chairs on the run — full feature parity with desktop, but
 *  mobile-native interaction patterns. main.tsx mounts one tree or the other
 *  based on this hook so neither tree carries baggage from the other. */
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

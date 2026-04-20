/**
 * Root gate that routes between the desktop workspace and the mobile
 * read-only viewer. Splitting this above App.tsx keeps the desktop tree
 * from instantiating ~40 useState hooks + loading the full catalog into
 * memory when the user is on their phone (and vice versa).
 *
 * The breakpoint is the same < 768px one CLAUDE.md defines, driven by a
 * matchMedia listener so rotating to landscape swaps trees live without a
 * reload. React will unmount one side and mount the other cleanly since
 * they share no state.
 */
import App from "./App"
import { useIsMobile } from "./hooks/useIsMobile"
import { MobileViewer } from "./mobile/MobileViewer"

export default function AppRoot() {
  const isMobile = useIsMobile()
  return isMobile ? <MobileViewer /> : <App />
}

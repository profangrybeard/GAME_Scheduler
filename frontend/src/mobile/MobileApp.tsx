/**
 * Root of the mobile-native experience. Path C from the rebuild: full
 * feature parity with desktop, but redesigned around chairs on the run
 * — time-pressured, interruption-heavy, between-meetings use.
 *
 * State will be lifted from App.tsx incrementally as mobile screens
 * need it (Option β from the architecture decision: forked trees with
 * shared state via lifted hooks, lifted in slices). For now the schedule
 * grid is the single home screen; everything else gets surfaced
 * contextually as the design takes shape.
 */
import "./mobile.css"
import { ScheduleScreen } from "./screens/ScheduleScreen"

export function MobileApp() {
  return (
    <div className="m-app">
      <ScheduleScreen />
    </div>
  )
}

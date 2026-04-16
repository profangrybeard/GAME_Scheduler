import { createContext } from "react"

/**
 * PortraitContext — provides user-uploaded portrait overrides keyed by prof_id.
 *
 * Values are data URLs (FileReader result). The App persists these to
 * localStorage; ProfAvatar reads them before falling back to the Vite glob
 * map, colored initials, or the AUTO silhouette.
 *
 * Kept in its own file so ProfAvatar.tsx only exports components (satisfies
 * react-refresh/only-export-components).
 */
export const PortraitContext = createContext<Record<string, string>>({})

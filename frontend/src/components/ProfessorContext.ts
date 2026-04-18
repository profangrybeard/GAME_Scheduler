import { createContext } from "react"
import type { Professor } from "../types"

/**
 * ProfessorContext — the merged professor map (canonical JSON + local edits).
 *
 * Provided once at the App root so shared presentational primitives like
 * ProfAvatar can derive prof-level UI (chair badge, etc.) without every
 * caller remembering to thread the data through. Single source of truth:
 * flip `is_chair` in the card, the badge updates everywhere.
 */
export const ProfessorContext = createContext<Record<string, Professor>>({})

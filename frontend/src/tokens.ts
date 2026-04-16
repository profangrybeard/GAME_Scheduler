/**
 * Design tokens — placeholder values for Session 8.
 *
 * These are intentionally neutral. The Session 11 "Juice" pass replaces them
 * with the final SCAD academic-dashboard palette, type scale, and motion.
 * CSS variables of the same names live in index.css for styling; this file
 * exists so components can reach token values at the TypeScript level
 * (inline styles, chart libs, etc.) without re-declaring constants.
 */

export const color = {
  bg: "#0F1012",
  surface: "#1A1B1F",
  surfaceHover: "#22232A",
  border: "#2A2B33",
  text: "#E8E8ED",
  textMuted: "#9CA3AF",
  textFaint: "#6B7280",
  accent: "#818CF8",
  success: "#34D399",
  warn: "#FBBF24",
  danger: "#F87171",
} as const

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
} as const

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
} as const

export const type = {
  familySans:
    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  familyMono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  sizeXs: "0.72rem",
  sizeSm: "0.85rem",
  sizeMd: "1rem",
  sizeLg: "1.15rem",
  sizeXl: "1.45rem",
  weightRegular: 400,
  weightMedium: 500,
  weightBold: 700,
} as const

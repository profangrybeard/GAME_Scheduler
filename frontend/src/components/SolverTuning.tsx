import { useCallback, useEffect, useMemo, useRef, useState } from "react"

/**
 * UI prototype: per-department weight tuning with a gear metaphor.
 *
 * NOT WIRED to the solver yet — this is purely the interaction sketch.
 * Three gears total to 100; dragging one redistributes the others
 * proportionally with elastic friction (no hard clamp). Presets snap
 * to the canonical mode mixes from config.MODE_WEIGHTS.
 *
 * Once the feel is signed off, we'll wire dept storage (Path B) +
 * pass weights into the solver request.
 */

type DeptKey = "game" | "motion_media" | "ai"

const DEPTS: Array<{ key: DeptKey; label: string; tone: string }> = [
  { key: "game",         label: "Game",         tone: "var(--dept-game)" },
  { key: "motion_media", label: "Motion Media", tone: "var(--dept-mome)" },
  { key: "ai",           label: "AI",           tone: "var(--dept-ai)" },
]

type GearKey = "affinity" | "time" | "overload"

interface Mix {
  affinity: number
  time:     number
  overload: number
}

const MIN_FLOOR = 5    // no dial can go below this
const TOTAL     = 100

// Mirror config.MODE_WEIGHTS, expressed as percent of 100.
// affinity_first  10/1/2   = 13   ->  77 / 8  / 15
// time_pref_first 1/10/2   = 13   ->  8  / 77 / 15
// balanced        10/4/3   = 17   ->  59 / 23 / 18
const PRESETS: Record<string, Mix> = {
  affinity_first:  { affinity: 77, time: 8,  overload: 15 },
  time_pref_first: { affinity: 8,  time: 77, overload: 15 },
  balanced:        { affinity: 59, time: 23, overload: 18 },
}

const PRESET_LABELS: Record<string, string> = {
  affinity_first:  "Affinity-First",
  time_pref_first: "Time-First",
  balanced:        "Balanced",
}

const GEAR_LABELS: Record<GearKey, string> = {
  affinity: "Affinity",
  time:     "Time Pref",
  overload: "Overload",
}

const GEAR_HINTS: Record<GearKey, string> = {
  affinity: "How much expertise matches matter",
  time:     "How much prof time-of-day matters",
  overload: "How much we punish overloading a prof",
}

/** Friction model: dragging beyond the available budget gets harder, doesn't
 *  hard-stop. The other two dials shrink to MIN_FLOOR; surplus drag becomes
 *  rubber-band tension that snaps back on release. */
function applyDrag(prev: Mix, key: GearKey, rawTarget: number): { mix: Mix; tension: number } {
  const others: GearKey[] = (["affinity", "time", "overload"] as GearKey[]).filter(k => k !== key)
  const sumOthers = others.reduce((s, k) => s + prev[k], 0)
  const minOthers = MIN_FLOOR * others.length
  const maxAbsorbable = TOTAL - minOthers

  const target = Math.max(MIN_FLOOR, rawTarget)

  if (target <= maxAbsorbable) {
    const next: Mix = { ...prev }
    next[key] = target
    const remaining = TOTAL - target
    if (sumOthers > 0) {
      others.forEach(k => {
        next[k] = Math.max(MIN_FLOOR, (prev[k] / sumOthers) * remaining)
      })
      const drift = TOTAL - others.reduce((s, k) => s + next[k], 0) - next[key]
      if (Math.abs(drift) > 0.001) {
        const giver = others.reduce((max, k) => next[k] > next[max] ? k : max, others[0])
        next[giver] += drift
      }
    } else {
      others.forEach(k => { next[k] = MIN_FLOOR })
    }
    return { mix: next, tension: 0 }
  }

  const overshoot = target - maxAbsorbable
  const elasticGain = overshoot * 0.30
  const visualValue = Math.min(maxAbsorbable + elasticGain, maxAbsorbable + 12)
  const next: Mix = { ...prev }
  next[key] = visualValue
  others.forEach(k => { next[k] = MIN_FLOOR })
  return { mix: next, tension: Math.min(1, overshoot / 30) }
}

/** Snap to integers totaling exactly 100. Largest gets the residual. */
function commit(mix: Mix): Mix {
  const total = mix.affinity + mix.time + mix.overload
  const scale = TOTAL / total
  const scaled: Mix = {
    affinity: Math.round(mix.affinity * scale),
    time:     Math.round(mix.time * scale),
    overload: Math.round(mix.overload * scale),
  }
  const sum = scaled.affinity + scaled.time + scaled.overload
  if (sum !== TOTAL) {
    const drift = TOTAL - sum
    const biggest: GearKey =
      scaled.affinity >= scaled.time && scaled.affinity >= scaled.overload ? "affinity" :
      scaled.time >= scaled.overload ? "time" : "overload"
    scaled[biggest] += drift
  }
  return scaled
}

/** Generate the "what this means" copy from the live mix. */
function describeMix(mix: Mix): string {
  const w_aff  = mix.affinity * 0.17
  const w_time = mix.time     * 0.17
  const prefAtBad  = w_aff * 1 + w_time * 5
  const eligAtGood = w_aff * 3 + w_time * 0
  const margin     = eligAtGood - prefAtBad
  const overWeight = mix.overload

  const expertVerdict =
    margin > 6  ? "Experts win comfortably, even when the slot is bad."
    : margin > 1 ? "Experts win the close calls — including bad time slots."
    : margin > -1 ? "Roughly tied — neither expertise nor time-fit dominates."
    : margin > -6 ? "Schedule fit usually wins; experts only beat random profs at preferred slots."
    : "Schedule fit dominates — the right prof in the wrong slot is unwelcome."

  const overVerdict =
    overWeight >= 30 ? "Overloading a prof feels expensive."
    : overWeight >= 15 ? "Mild resistance to overloading."
    : "Overloading is barely penalized — expect a few profs to carry heavy quarters."

  return `${expertVerdict} ${overVerdict}`
}

interface Props {
  open:    boolean
  onClose: () => void
}

export function SolverTuning(props: Props) {
  const { open, onClose } = props
  const [dept, setDept] = useState<DeptKey>("game")
  const [byDept, setByDept] = useState<Record<DeptKey, Mix>>({
    game:         { ...PRESETS.balanced },
    motion_media: { ...PRESETS.time_pref_first },
    ai:           { ...PRESETS.affinity_first },
  })
  const [tension, setTension] = useState<Record<GearKey, number>>({ affinity: 0, time: 0, overload: 0 })
  const [draggingKey, setDraggingKey] = useState<GearKey | null>(null)

  const mix = byDept[dept]
  const setMix = useCallback((nextMix: Mix) => {
    setByDept(prev => ({ ...prev, [dept]: nextMix }))
  }, [dept])

  const dragRef = useRef<{ key: GearKey; startY: number; startMix: Mix } | null>(null)

  const onPointerDown = useCallback((key: GearKey) => (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = { key, startY: e.clientY, startMix: { ...mix } }
    setDraggingKey(key)
  }, [mix])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const dy = drag.startY - e.clientY
    const delta = dy * 0.4
    const rawTarget = drag.startMix[drag.key] + delta
    const { mix: nextMix, tension: t } = applyDrag(drag.startMix, drag.key, rawTarget)
    setMix(nextMix)
    setTension(prev => ({ ...prev, [drag.key]: t }))
  }, [setMix])

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    setDraggingKey(null)
    setTension({ affinity: 0, time: 0, overload: 0 })
    setMix(commit(mix))
  }, [mix, setMix])

  const applyPreset = useCallback((presetKey: string) => {
    setMix({ ...PRESETS[presetKey] })
  }, [setMix])

  const currentPreset = useMemo(() => {
    return Object.entries(PRESETS).find(([, p]) =>
      p.affinity === mix.affinity && p.time === mix.time && p.overload === mix.overload
    )?.[0] ?? null
  }, [mix])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  const deptTone = DEPTS.find(d => d.key === dept)?.tone ?? "var(--accent)"

  return (
    <div className="solver-tune__scrim" onClick={onClose}>
      <div
        className="solver-tune"
        onClick={e => e.stopPropagation()}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ "--dept-tone": deptTone } as React.CSSProperties}
      >
        <header className="solver-tune__head">
          <div>
            <h2 className="solver-tune__title">Solver Tuning</h2>
            <p className="solver-tune__sub">Shape the solver's opinions for this department.</p>
          </div>
          <button type="button" className="solver-tune__close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="solver-tune__dept-row" role="tablist" aria-label="Department">
          {DEPTS.map(d => (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={dept === d.key}
              className={"solver-tune__dept" + (dept === d.key ? " solver-tune__dept--active" : "")}
              onClick={() => setDept(d.key)}
              style={{ "--this-tone": d.tone } as React.CSSProperties}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="solver-tune__gears">
          {(["affinity", "time", "overload"] as GearKey[]).map(key => {
            const value = mix[key]
            const t = tension[key]
            const dragging = draggingKey === key
            const size = 60 + (value / 100) * 80
            const strain = t > 0 ? 1 + t * 0.08 : 1
            return (
              <div
                key={key}
                className={"solver-tune__gear" + (dragging ? " solver-tune__gear--dragging" : "") + (t > 0.01 ? " solver-tune__gear--strain" : "")}
              >
                <button
                  type="button"
                  className="solver-tune__gear-grab"
                  onPointerDown={onPointerDown(key)}
                  aria-label={`${GEAR_LABELS[key]} weight ${Math.round(value)}`}
                  style={{
                    width: size,
                    height: size,
                    transform: `scale(${strain})`,
                  }}
                >
                  <Gear value={value} dragging={dragging} tension={t} />
                </button>
                <div className="solver-tune__gear-meta">
                  <span className="solver-tune__gear-label">{GEAR_LABELS[key]}</span>
                  <span className="solver-tune__gear-value">{Math.round(value)}</span>
                  <span className="solver-tune__gear-hint">{GEAR_HINTS[key]}</span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="solver-tune__presets">
          <span className="solver-tune__presets-label">Snap to:</span>
          {Object.entries(PRESET_LABELS).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={"solver-tune__preset" + (currentPreset === key ? " solver-tune__preset--active" : "")}
              onClick={() => applyPreset(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="solver-tune__readout">
          <div className="solver-tune__readout-head">What this means</div>
          <p className="solver-tune__readout-body">{describeMix(mix)}</p>
        </div>

        <footer className="solver-tune__foot">
          <button type="button" className="solver-tune__btn solver-tune__btn--ghost" onClick={() => applyPreset("balanced")}>
            ↺ Reset to Balanced
          </button>
          <button type="button" className="solver-tune__btn solver-tune__btn--primary" onClick={onClose}>
            Try it on current schedule
          </button>
        </footer>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// Inline SVG gear. Tooth count scales with the gear's display size so that
// the *arc length per tooth* stays the same across all three — i.e. the
// teeth could actually interdigitate if you slid the gears together. Each
// slot is split 50/50 into tooth and gap, the standard meshing geometry.
// --------------------------------------------------------------------------
function Gear(props: { value: number; dragging: boolean; tension: number }) {
  // Mirror the parent's sizing so we can pick a tooth count that yields
  // a constant visual pitch (~12px arc per tooth) regardless of gear size.
  const size      = 60 + (props.value / 100) * 80
  const r_outer   = 48
  const r_inner   = 41   // shallower valleys: fits a finer-pitched tooth
  const r_body    = 36
  const r_hub     = 12

  const TARGET_PITCH_PX = 18  // chunkier teeth than before
  const pitch_vb        = (TARGET_PITCH_PX * 100) / size
  const circumference   = 2 * Math.PI * r_outer
  const teeth           = Math.max(8, Math.round(circumference / pitch_vb))

  // Trapezoidal teeth — base wider than top so the sides angle inward.
  // Real involute gears taper this way; matters here because it reads as
  // "machined" rather than "stamped".
  const base_frac = 0.50
  const top_frac  = 0.36

  const points: string[] = []
  const slot = (Math.PI * 2) / teeth
  for (let i = 0; i < teeth; i++) {
    const a_center = i * slot - Math.PI / 2 + slot / 2
    const a_baseL  = a_center - (slot * base_frac) / 2
    const a_topL   = a_center - (slot * top_frac)  / 2
    const a_topR   = a_center + (slot * top_frac)  / 2
    const a_baseR  = a_center + (slot * base_frac) / 2
    points.push(`${50 + Math.cos(a_baseL) * r_inner},${50 + Math.sin(a_baseL) * r_inner}`)
    points.push(`${50 + Math.cos(a_topL)  * r_outer},${50 + Math.sin(a_topL)  * r_outer}`)
    points.push(`${50 + Math.cos(a_topR)  * r_outer},${50 + Math.sin(a_topR)  * r_outer}`)
    points.push(`${50 + Math.cos(a_baseR) * r_inner},${50 + Math.sin(a_baseR) * r_inner}`)
  }

  return (
    <svg
      viewBox="0 0 100 100"
      className={"solver-tune__gear-svg" + (props.dragging ? " solver-tune__gear-svg--spin" : "")}
      style={{
        filter: props.tension > 0.01
          ? `drop-shadow(0 0 ${4 + props.tension * 12}px var(--danger))`
          : undefined,
      }}
    >
      {/* Solid body disk that sits beneath the teeth ring — gives the gear weight. */}
      <circle cx="50" cy="50" r={r_body}
        fill="color-mix(in srgb, var(--dept-tone) 80%, black)"
        opacity="0.85" />
      {/* The cog teeth ring */}
      <polygon
        points={points.join(" ")}
        fill="var(--dept-tone)"
        stroke="var(--text)"
        strokeWidth="1.2"
        opacity="0.92"
      />
      {/* Hub ring — looks like the gear is mounted on a shaft */}
      <circle cx="50" cy="50" r={r_hub}
        fill="var(--bg)"
        stroke="var(--text)"
        strokeWidth="1.5" />
      {/* Center pin */}
      <circle cx="50" cy="50" r="2.5" fill="var(--text)" />
    </svg>
  )
}

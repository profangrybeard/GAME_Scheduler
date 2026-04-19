"""Ad-hoc weights sanity check — no solver needed, pure penalty math."""
AFFINITY_PENALTIES  = {0: 0, 1: 1, 2: 3}
TIME_PREF_PENALTIES = {"preferred": 0, "acceptable": 2, "not_preferred": 5}
MODE_WEIGHTS = {
    "affinity_first":    {"affinity": 10, "time_pref": 1, "overload": 2},
    "time_pref_first":   {"affinity": 1,  "time_pref": 10, "overload": 2},
    "balanced":          {"affinity": 5,  "time_pref": 5,  "overload": 3},
}

print("=" * 72)
print("RAW PENALTY ASYMMETRY")
print("=" * 72)
print(f"AFFINITY_PENALTIES  (eligible)     : {AFFINITY_PENALTIES}")
print(f"TIME_PREF_PENALTIES                : {TIME_PREF_PENALTIES}")
print(f"MODE_WEIGHTS                       : {MODE_WEIGHTS}")
print()
print("Max per-assignment penalty (eligible prof, not_preferred slot):")
print("  aff_pen max = 3   (eligible, not in preferred list)")
print("  time_pen max = 5  (not_preferred slot)")
print()
print("  mode              aff_hit  time_hit  total   time_share")
for mode, w in MODE_WEIGHTS.items():
    aff  = w["affinity"] * 3
    time = w["time_pref"] * 5
    total = aff + time
    print(f"  {mode:16s}  {aff:7d}  {time:8d}  {total:5d}   {time/total*100:4.0f}%")
print()
print("-> In 'balanced' mode (5/5), time_pref already contributes 62% of the")
print("   max penalty. The equal-weights label is misleading — the raw time")
print("   penalty ceiling (5) is 67% higher than the affinity ceiling (3).")
print()

print("=" * 72)
print("TRADE-OFF: preferred-prof @ bad time  vs  eligible-prof @ good time")
print("=" * 72)
print("  pref-prof   : aff_pen=1, time_pen=5  (your expert at a 5pm slot)")
print("  elig-prof   : aff_pen=3, time_pen=0  (random eligible at 8am)")
print()
print("  mode              A=pref@bad  B=elig@good  winner")
for mode, w in MODE_WEIGHTS.items():
    a = w["affinity"]*1 + w["time_pref"]*5
    b = w["affinity"]*3 + w["time_pref"]*0
    winner = "pref-prof" if a < b else "elig-prof" if b < a else "TIE"
    print(f"  {mode:16s}  {a:10d}  {b:11d}  {winner}")
print()
print("-> 'balanced' picks the random eligible prof over the expert — that's")
print("   the signature of time_pref_first, not balanced.")
print()

print("=" * 72)
print("TRADE-OFF: preferred-prof @ acceptable  vs  eligible-prof @ preferred")
print("=" * 72)
print("  pref-prof : aff_pen=1, time_pen=2  (expert at a 2pm slot, morning prof)")
print("  elig-prof : aff_pen=3, time_pen=0  (random at 8am)")
print()
print("  mode              A=pref@ok   B=elig@good  winner")
for mode, w in MODE_WEIGHTS.items():
    a = w["affinity"]*1 + w["time_pref"]*2
    b = w["affinity"]*3 + w["time_pref"]*0
    winner = "pref-prof" if a < b else "elig-prof" if b < a else "TIE"
    print(f"  {mode:16s}  {a:10d}  {b:11d}  {winner}")
print()

print("=" * 72)
print("WHAT WOULD RATIO-FAIR BALANCED WEIGHTS LOOK LIKE?")
print("=" * 72)
print("Goal: equal max penalty from both dimensions.")
print("  aff_max = w_aff * 3,  time_max = w_time * 5")
print("  Equal iff  w_aff / w_time  =  5 / 3  ~  1.67")
print()
print("Candidates:")
options = [
    ("balanced (current)      ", 5, 5),
    ("balanced (simple 5/3)   ", 5, 3),
    ("balanced (scaled 10/6)  ", 10, 6),
    ("balanced (keep-sum 6/4) ", 6, 4),  # sum 10, same as current, but 60/40 not 50/50
]
for label, wa, wt in options:
    aff_max  = wa * 3
    time_max = wt * 5
    total    = aff_max + time_max
    # Re-check the pref@bad vs elig@good trade-off
    a = wa*1 + wt*5
    b = wa*3 + wt*0
    tradeoff = "pref-prof" if a < b else "elig-prof" if b < a else "TIE"
    print(f"  {label}  w_aff={wa} w_time={wt}  aff_ceil={aff_max:3d}  time_ceil={time_max:3d}  time_share={time_max/total*100:4.0f}%   tradeoff winner: {tradeoff}")

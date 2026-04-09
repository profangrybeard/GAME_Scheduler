# SCAD Game Department Course Scheduler

A tool that automatically builds three draft course schedules for any quarter, balancing professor preferences, room requirements, and teaching loads. You give it a list of courses to offer — it gives you three options to choose from, exported as a color-coded Excel workbook.

---

## Prerequisites

- **Python 3.10 or newer** — download from [python.org](https://www.python.org/downloads/)
- **pip** — comes with Python

That's it. No database, no server, no IT required.

---

## First Run — From Clone to Schedule

**1. Get the project**

```bash
git clone <repo-url>
cd GAME_Scheduler
```

**2. Install dependencies** (one time only)

```bash
pip install -r requirements.txt
```

This installs the solver (OR-Tools), Excel writer (openpyxl), web scraper (BeautifulSoup), and a few other small libraries.

**3. Generate the schedule**

```bash
python main.py --quarter fall
```

That's the whole command. The tool will:
- Pull the latest course list from the SCAD catalog website
- Validate all data files
- Run the optimizer three times with different priorities
- Write the results to `output/schedule_fall_2026.xlsx`

Open the Excel file and you'll see four sheets: a Summary and one sheet per schedule option.

> **No internet?** Add `--offline` to skip the live scrape and use the existing catalog data:
> ```bash
> python main.py --quarter fall --offline
> ```

---

## Updating Data Between Quarters

### Changing which courses to offer

Edit `data/quarterly_offerings.json`. This is the only file you need to change between quarters.

Each entry looks like this:

```json
{
  "catalog_id": "GAME_256",
  "priority": "must_have",
  "sections": 1,
  "override_enrollment_cap": null,
  "override_room_type": null,
  "override_preferred_professors": null,
  "notes": "Core game design — always offered"
}
```

| Field | What it means |
|---|---|
| `catalog_id` | The course ID from the SCAD catalog (e.g. `GAME_256`, `MOME_105`) |
| `priority` | `must_have` — solver must schedule this; `should_have` — schedule if possible; `could_have` — only if room allows |
| `sections` | How many sections to run (1 or 2). Use 2 for high-demand courses |
| `override_enrollment_cap` | Override the default cap for this offering only. `null` uses the catalog default |
| `override_room_type` | Force a specific room type (`itgm_suite`, `pc_lab`, `mac_lab`, `standard`). `null` uses the course default |
| `override_preferred_professors` | Suggest a specific professor for this offering (e.g. `["prof_dodson"]`). The solver will strongly prefer them but can use others if needed. `null` uses the catalog preference list |
| `notes` | Free text for your own reference. Ignored by the solver |

Also update the `quarter` and `year` at the top of the file:

```json
{
  "quarter": "winter",
  "year": 2027,
  "offerings": [ ... ]
}
```

### Updating professor availability

Edit `data/professors.json`. Each professor has an `available_quarters` field:

```json
"available_quarters": ["fall", "winter", "spring"]
```

Remove a quarter if a professor is on leave. The solver will not assign them during quarters they're unavailable.

---

## How to Read the Output

Open `output/schedule_fall_2026.xlsx` (filename reflects the quarter and year).

### The Summary sheet

Shows all three options side-by-side:

| Column | Meaning |
|---|---|
| Mode | Which priority the solver used (see below) |
| Status | `OPTIMAL` = best possible solution found; `FEASIBLE` = a valid solution (may not be perfect) |
| Penalty Score | Lower is better. Reflects how many compromises were made |
| Placed | How many course sections were successfully scheduled |
| Unscheduled | Sections the solver couldn't fit in. `must_have` sections should always be 0 |

### The three schedule options

Each sheet is a different version of the schedule, optimized for a different priority:

| Sheet | What it prioritizes |
|---|---|
| **Affinity First** | Assigns professors to courses where their expertise is the best match. May accept less-preferred time slots to get the right professor |
| **Time Pref First** | Puts professors in their preferred time slots (morning vs. afternoon). May use a less-specialized professor to hit the right time |
| **Balanced** | Splits the difference — reasonable prof-course matches at reasonable times |

Pick the sheet that best fits your priorities for the quarter, or mix-and-match rows between sheets when presenting options to faculty.

### Color coding

| Color | Meaning |
|---|---|
| **Blue row** | Game department course |
| **Purple row** | Motion Media department course |
| **Green row** | AI department course |
| **Yellow cell** (Affinity column) | Professor is in the preferred list for this course — good match |
| **Orange cell** (Time Pref column) | This time slot is outside the professor's preferred hours |

A schedule with mostly yellow Affinity cells and no orange Time Pref cells is as good as it gets.

---

## Troubleshooting

### "Validation errors found. Fix them before scheduling."

Run validation directly to see what's wrong:

```bash
python -m ingest.validate
```

Common causes:
- A `catalog_id` in `quarterly_offerings.json` doesn't match any course in the catalog — check for typos (e.g. `GAME256` vs `GAME_256`)
- A professor ID in `override_preferred_professors` doesn't exist — check `data/professors.json` for the correct ID (e.g. `prof_dodson`)
- The `quarter` field in `quarterly_offerings.json` doesn't match what you passed to `--quarter`

### "INFEASIBLE" in the Status column

The solver couldn't find any valid schedule for that mode. Most likely cause: a `must_have` course has no eligible professors or no compatible room.

Check:
1. Does the course have any professors whose `teaching_departments` includes the course's department?
2. Does the course's `required_room_type` match at least one room in `data/rooms.json`?
3. Is at least one eligible professor available this quarter?

If you're stuck, run `python -m ingest.validate` — it will flag courses with no preferred professors, which is often a sign the eligibility filters are too restrictive.

### Scraper fails or shows "FALLBACK"

The live scrape of catalog.scad.edu failed (network issue or the catalog website changed). The tool automatically falls back to the built-in course list, which is based on the 2025-2026 catalog. This is fine — the schedule will still run.

To always skip the scrape:
```bash
python main.py --quarter fall --offline
```

### Excel file won't open / looks garbled

Make sure you have Excel or LibreOffice Calc installed. The `.xlsx` file is written fresh each run — if it's open in Excel when you re-run the scheduler, close it first or the write will fail.

---

## Repo Structure

```
GAME_Scheduler/
├── main.py                     Entry point — run this to generate a schedule
├── config.py                   All constants: time slots, penalties, weight vectors
├── requirements.txt            Python dependencies
│
├── data/
│   ├── quarterly_offerings.json   EDIT THIS each quarter — courses to schedule
│   ├── course_catalog.json        Auto-generated by the scraper (do not edit)
│   ├── professors.json            Professor profiles and availability
│   └── rooms.json                 Room inventory with capacities and equipment
│
├── schemas/                    JSON validation schemas (do not edit)
│
├── ingest/
│   ├── catalog_scraper.py      Fetches courses from catalog.scad.edu
│   ├── catalog_defaults.py     Infers room types, tags, and prof preferences
│   └── validate.py             Checks all data files for errors before solving
│
├── solver/
│   ├── model_builder.py        Builds the constraint programming model
│   ├── constraints.py          Hard rules (no double-booking, load caps, etc.)
│   ├── objectives.py           Soft preferences turned into penalty scores
│   └── scheduler.py            Runs the solver three times and collects results
│
├── export/
│   └── excel_writer.py         Formats results into the 4-sheet Excel workbook
│
└── output/                     Generated schedules land here (gitignored)
```

---

## Quick Reference

| Task | Command |
|---|---|
| Generate schedule (with live scrape) | `python main.py --quarter fall` |
| Generate schedule (offline) | `python main.py --quarter fall --offline` |
| Validate data only | `python -m ingest.validate` |
| Refresh catalog only | `python -m ingest.catalog_scraper` |
| Valid quarters | `fall`, `winter`, `spring`, `summer` |

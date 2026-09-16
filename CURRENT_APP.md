# DTR Manager — Project Description

## What this is

DTR Manager is a single-purpose, browser-based attendance terminal and ID
issuance tool for a small organisation. It is built as plain HTML, CSS, and
JavaScript on top of a local Bootstrap 5 copy — no build step, no framework,
no bundler. The project name in the design spec is `JS_Portable_DTR_LAN`,
which points at the intended deployment: a portable folder served over a
local network, so a shared device (a tablet or kiosk PC at the office
entrance) can run the attendance terminal while an administrator uses the
admin panel from another machine on the same LAN.

The core idea is that an employee's identity is carried by a printed CR80
ID card with a QR code on it. The terminal reads that QR code to record a
clock-in or clock-out. The admin panel is where those employees and their
IDs are created, previewed, printed, disabled, and where a monthly Daily
Time Record (DTR) form is produced.

## The two interfaces

### 1. Home / Attendance Terminal (`index.html`)

The terminal is deliberately minimal — a wall-mounted or kiosk-style screen
with almost nothing to misclick.

- A live clock (time and full date), reduced in size from the original design.
- A camera preview frame for the employee to face while scanning.
- A large circular "log attendance" button.
- A single circular Admin button in the top area, which is the only way into
  the admin panel.

Pressing the log-attendance button opens a **Clock Action modal**. The modal
is intentionally restrictive:

- Two choices only: **Clock In** and **Clock Out**. Neither is pre-selected.
- The backdrop click and the ESC key are both disabled. The modal can only
  be dismissed by the X button, or by pressing **Okay** with a real selection.
- Pressing Okay with nothing selected shows a warning and keeps the modal open.
- Pressing Okay with a valid choice starts a visible 3-second countdown, then
  the modal closes on its own.
- After it closes, a status banner appears under the camera that alternates
  between *"Ready to Clock In — show your QR code to the camera."* (or Clock
  Out) and *"Try again — No QR code detected."* until the user opens the
  modal again.

A separate "Reminders" modal fires on first load, prompting the user to
choose the right action and to check that their face is visible.

### 2. Admin Panel (`admin.html`)

The admin panel is a single scrollable page with four working areas.

**Overview statistics** — four cards: total Employees, Active IDs, Disabled
IDs, and Punches today. Active and Disabled are live counts derived from the
employee list.

**Company details** — a text field that renames the header on the ID card
(defaults to "DTR Manager", also rewrites the card footer to *"Property of
…"*), and a logo upload that replaces the default circular icon in the ID
header.

**Employee details** — the data-entry form that drives everything else:

- Photo upload with a live thumbnail.
- ID number, position, first name (max 17), middle initial (max 2), last name
  (max 14), department, and an optional QR payload note.
- Emergency contact: full name (max 28, letters only) and a contact number
  restricted to digits, `+`, `(`, `)`, `-`, and `/`.
- Input is uppercased as you type; name fields strip digits and symbols;
  the phone field strips everything outside its allowed character set.

The whole form is **live-previewed**. Every keystroke updates the ID card
render beside it — name, position, ID, department, emergency contact lines,
and (once an ID number exists) the QR code. There is no separate "preview"
step; the preview *is* the form's mirror.

**Generated IDs** — a searchable table of every employee created in this
session, with columns for ID, Name, Position, Status, and Actions. Search
matches against ID, name, position, or department. Each row offers **Edit**
(loads the record back into the form) and **Disable/Enable** (toggles the
employee's status and updates the statistics).

**Daily Time Record (DTR)** — a section for producing the monthly form:
search by employee ID, pick a month with a native month picker, then
**Print DTR** (opens a print-ready A4 page) or **Export Blank DTR** (the same
layout with no employee filled in). A **Backup and Reset** button opens a
modal offering Backup (CSV download), Backup & Reset (download then clear),
or Reset (clear without downloading).

## The ID card

The card is rendered at true CR80 dimensions — 85.6 mm × 54 mm — in the
browser, with a print stylesheet that maps `@page` to the same size so a
single card prints at real scale without resizing.

Layout: a gradient header band (logo + company name + "Employee ID"), a body
row containing a 24 mm square photo, a text block (surname on line one, given
name and initial on line two, position, ID and department as a definition
list, then a two-line emergency contact block in a deliberately smaller type
size), and a 24 mm QR code. A footer strip carries the company name.

Two print paths exist: **Print ID** uses the browser's print dialog against
the card's own print stylesheet; **Print QR** opens a blank window containing
only the QR image, for label printers or for printing codes on their own.

## The QR payload

When an ID is generated, the QR encodes a JSON object containing the ID
number, first name, middle initial, last name, a composed full name,
position, department, an optional note, and — when provided — the emergency
contact. The same payload is rendered in both the ID card's QR slot and the
separate QR Preview box beneath it.

## Design and accessibility posture

The visual language is Material-flavoured but not Material-framework: a
defined token set in `:root` covering colour, elevation, radius, and motion
duration; Roboto as the primary face; uppercase button labels with wide
letter-spacing; restrained elevation instead of borders.

Accessibility is treated as a build-time concern rather than a retrofit:
semantic elements (`header`, `main`, `section`, `article`, `form`, `table`),
labelled form controls, `aria-live` regions on the clock and the scan hint,
`role="radiogroup"` on the clock action choices, visible focus rings,
`prefers-reduced-motion` handling, and print rules that hide all chrome.

## Technology

| Layer | Choice |
|---|---|
| Markup / styling / logic | HTML, CSS, vanilla JavaScript (IIFE, no modules) |
| CSS framework | Bootstrap 5, vendored locally as `assets/css/bootstrap.css` |
| JS framework | None |
| Bootstrap JS | CDN bundle (includes Popper) |
| Icons | Font Awesome 6 (CDN) |
| QR generation | `qrcodejs` (CDN) |
| Fonts | Google Fonts — Roboto, DM Sans, Tinos |
| Data persistence | None — in-memory only |

A `jquery-4.0.0.js` file exists in the project but is not referenced by any
page.

---

## Current state — what is real and what is a shell

This distinction matters, because the interface is considerably more
finished than the behaviour behind it.

| Feature | State |
|---|---|
| Clock In / Clock Out selection modal, countdown, dismissal rules | **Working** |
| ID card rendering, live preview, print layout | **Working** |
| Employee photo and company logo upload | **Working** (held as data URLs in memory) |
| QR code generation and display | **Working** |
| Employee roster: create, edit, disable, search | **Working** |
| CSV export of the employee roster | **Working** |
| Blank DTR and per-employee DTR print layout | **Working** (layout only) |
| Camera preview | **Shell** — the `<video>` element exists, but no `getUserMedia` call is made and no stream is attached, so the frame renders empty |
| QR code scanning / detection | **Not built** — the "Try again — No QR code detected" message is driven by an 8-second timeout, not by a real read |
| Attendance logging | **Not built** — nothing is recorded when a clock action is confirmed |
| DTR data | **Not built** — every DTR prints 31 blank rows; no time entries are ever stored |
| "Punches today" statistic | **Shell** — the card renders, but no code ever increments it |
| Persistence | **Not built** — all state lives in a JavaScript array and is lost on refresh |
| Server / database / LAN sync | **Not built** |

The honest one-line summary: **the UI, the ID issuance workflow, and the
document layouts are complete; the scanning, attendance recording, and
storage layers are the remaining work.**

---

## What the project is trying to become

Reading the interface and the `JS_Portable_DTR_LAN` project name together,
the target end state is:

1. A single folder dropped onto a machine on the office LAN.
2. One screen (Home) acting as the kiosk: employee walks up, picks Clock In
   or Clock Out, holds their ID card's QR code to the camera.
3. The QR is decoded, matched against the roster, and the arrival or
   departure time is recorded against that employee for the current day.
4. One screen (Admin) where the administrator creates employees, prints
   their ID cards, monitors who is active, and at month-end prints each
   employee's DTR — now populated with real arrival and departure times
   instead of blank rows.
5. A backup path that exports the data and clears it at the start of a new
   period, with the CSV as the portable archive format.

The design decisions already in place — the monthly-by-design DTR layout,
the CSV backup rather than a proprietary format, the vendored Bootstrap and
CDN-only dependencies, the static file structure — all point toward a tool
that stays portable and readable by ordinary office software rather than one
that requires an install or a server to inspect its data.

---

## Known gaps and open decisions

- **QR decoding library.** `qrcodejs` generates codes but cannot read them.
  Reading requires `jsQR`, `html5-qrcode`, or the native `BarcodeDetector`
  API. The scan loop is already structured to accept a real detection event;
  it needs the decoder wired into it.
- **Storage.** Nothing survives a refresh. `localStorage` would cover a
  single kiosk; a LAN-shared store (IndexedDB plus sync, or a small backend)
  would be needed for the multi-machine case.
- **Attendance record shape.** Not yet decided — the DTR's seven columns
  (Date, two Arrival/Departure pairs, Undertime Hours, Undertime Minutes)
  imply a morning/afternoon split with computed undertime, which means the
  recording step needs to know which pair a given punch belongs to.
- **Emergency contact in the QR payload.** Included when filled in, but the
  payload schema is not yet validated by a consumer, since no consumer exists.
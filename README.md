# DTR Manager: Portable DTR System

[![Website](https://img.shields.io/badge/website-offline-02aaff?style=for-the-badge&logo=githubpages)](https://paoradox.github.io/)
[![Built with](https://img.shields.io/badge/built_with-HTML%2FCSS%2FJS-02aaff?style=for-the-badge&logo=html5)](https://developer.mozilla.org/)

A multi-device, LAN-based Daily Time Record (DTR) Manager built with Node.js, Express, SQLite, Socket.IO, Bootstrap 5, and Electron.

This project is designed for local attendance tracking over a LAN. One host computer runs the server, and other devices on the same Wi-Fi/Ethernet network can open the attendance terminal or admin panel through a browser.

## Features

- Employee ID and QR generation
- CR80-style employee ID preview and print layout
- QR-based Clock In / Clock Out attendance
- Backend punch validation:
  - first punch must be `Clock In`
  - rejects duplicate consecutive actions
  - maximum 2 Clock In and 2 Clock Out records per employee per day
- Admin panel for employee records
- Generated IDs table with pagination
- Daily Time Record export using the Excel DTR template
- Export blank DTR template
- Export all employees' monthly DTR files
- Attendance Corrections:
  - load employee attendance by month
  - add attendance record
  - edit attendance date, time, and action
  - delete attendance record
  - backend validation prevents invalid punch order
- Backup and reset tools:
  - Backup IDs & DTR
  - Reset DTR only
  - Backup & Reset All
  - Reset All
- ZIP backup support with employee roster, DTR logs, and employee photos
- Electron launcher with LAN URLs, page shortcuts, and changeable port

## Application Pages

| Page | Purpose | Login required? |
| --- | --- | --- |
| `index.html` | Public scanning page — Clock-In, Clock-Out | No |
| `admin.html` | Employee management, ID and attendance resets | Yes (admin) |

## Tech Stack

- **Frontend:** Plain HTML/CSS/JavaScript, Bootstrap 5 — no framework, no build step
- **Backend:** Node.js, Express, Socket.IO
- **Database:** SQLite via Node's built-in `node:sqlite` module (no native dependencies to compile)
- **Auth:** password hashing
- **Desktop wrapper:** Electron

## Project Structure

```text
JS-Portable-DTR-LAN/
├─ launcher/              ← DTRManager.exe + Electron's own runtime files (built, not hand-written)
├─ electron/              ← the launcher's source (main.js, preload.js, control window)
├─ server/                ← Express + Socket.IO + SQLite backend
│  ├─ db/                 ← schema + database connection
│  └─ index.js
├─ frontend/              ← the actual web pages
│  ├─ assets/js/          ← app.js, api.js
│  ├─ preview             ← preview screenshots of the system
│  ├─ index.html
│  ├─ admin.html
├─ database/
│  └─ data.db             ← created automatically on first launch
├─ electron-settings.json ← created automatically (saved port)
├─ package.json
└─ package-lock.json
```

## Preview

Here are some screenshots from the system, showcasing its interface and key features:

| Launch Server & Setup Login | Scanning & Responsive Display | Admin Controls | ID & QR Generation | DTR Export |
|----------------|-------------|---------------|---------------|---------------|
| ![Launch Server & Setup Login](frontend/preview/Launch%20Server%20%26%20Setup%20Login.png) | ![Scanning & Responsive Display](frontend/preview/Scanning%20%26%20Responsive%20Display.png) | ![Admin Controls](frontend/preview/Admin%20Controls.png) | ![ID & QR Generation](frontend/preview/ID%20%26%20QR%20Generation.png) | ![DTR Export](frontend/preview/DTR%20Export.png) |

## Running the Application

### Option 1 — Plain server (any OS, no desktop app)

```bash
npm install
npm start
```

Then open `http://localhost:3000/index.html` (or `/admin.html`) in a browser. Other devices on the same network can reach it at `http://<this-machine's-LAN-IP>:3000/...`.

### Option 2 — Desktop app, dev mode

```bash
npm install
npm run electron
```

Opens the same server inside an Electron control window, showing your LAN connection URLs and shortcuts to the Display/Admin pages, without needing to build anything.

### Option 3 — Built windows desktop app (`DTRManager.exe`)

Prerequisites: Node.js 22.5.0 or newer (`node -v` to check).

```powershell
npm install
npm run dist
New-Item -ItemType Directory -Force -Path launcher
Move-Item dist\win-unpacked\* launcher\
```

Then double-click `launcher\DTRManager.exe`. This produces the layout shown in [Project Structure](#project-structure) above.

**Editing `server/` or `frontend/` after building never requires a rebuild** — the exe reads them live from disk. You only need to run `npm run dist` again if you change files inside `electron/` itself.

See [BUILD.md](./BUILD.md) for full build details, port configuration, and distributing the app to another machine.

## Resetting the Database

If you've lost admin credentials, want a completely clean slate, or don't have a SQLite browser tool to inspect `data.db` directly, the simplest fix is deleting and letting it recreate itself:

1. Close the app (or stop `npm start`/the Electron app) completely.
2. Delete these three files from `database/`:
   - `data.db`
   - `data.db-shm`
   - `data.db-wal`
3. Restart the app. A fresh, empty database is created automatically, and you'll be prompted to create a new admin account on first launch (the same first-run setup screen you saw the very first time).

This wipes all users, queue history, and the audit log — there's no partial/selective reset via file deletion. If you only need to fix one forgotten password rather than start over completely, see the direct-database-edit method in this repo's project history/documentation instead.

## When to Rebuild

| Changed file/folder | Rebuild required? |
|---|---|
| `frontend/` | No. Relaunch the app. |
| `server/` | No. Relaunch the app. |
| `database/` | No. Relaunch the app. |
| `electron/main.js` | Yes. Run `npm run dist`. |
| `electron/preload.js` | Yes. Run `npm run dist`. |
| `electron/renderer/*` | Yes. Run `npm run dist`. |
| `package.json` dependencies | Run `npm install`; rebuild only if Electron files changed. |

## Attendance Flow

1. Admin creates an employee ID and QR code.
2. Employee opens the attendance terminal.
3. Employee selects Clock In or Clock Out.
4. Employee scans the QR code.
5. The backend validates the punch sequence.
6. The punch is saved to SQLite.

Daily punch order is:

~~~text
1. Clock In
2. Clock Out
3. Clock In
4. Clock Out
~~~

Invalid examples:

~~~text
Clock Out as first punch
Clock In twice in a row
Clock Out twice in a row
More than 4 punches in one day
~~~

## Attendance Corrections

The Admin Panel includes Attendance Corrections.

Admins can:

- load records by Employee ID and month
- add an attendance record
- edit date, time, and action
- delete a record

The backend validates corrected records so the final daily sequence remains valid.

## DTR Export

The app uses:

~~~text
frontend/template/Blank_DTR_Template.xlsx
~~~

DTR template mapping:

| Cell / Range | Purpose |
|---|---|
| `D8` | Employee full name |
| `D11` | `For the month of` |
| `F11` | Month and year |
| `D17:D47` | A.M. Arrival |
| `E17:E47` | A.M. Departure |
| `F17:F47` | P.M. Arrival |
| `G17:G47` | P.M. Departure |
| `D55` | Employee full name |

The template formulas should remain in the Excel file.

## Backup and Reset

Backup and reset actions are available in the Admin Panel.

| Action | Description |
|---|---|
| Backup IDs & DTR | Downloads employee roster, attendance logs, and photos as a ZIP file. |
| Reset DTR | Clears attendance records only. Employee records are kept. |
| Backup & Reset All | Downloads a backup, then clears employee and attendance records. |
| Reset All | Clears employee and attendance records without backup. |

Backup ZIP contains files such as:

~~~text
Employee IDs.xlsx
DTR Time Logs.xlsx
photos/
~~~

## Distributing to Another Machine

Copy the whole project folder, including:

~~~text
server/
frontend/
electron/
launcher/
node_modules/
package.json
package-lock.json
~~~

Include `database/` if you want to keep existing records.

Leave `database/` out if you want a fresh database on the new machine.

The target machine must have compatible Node.js installed because the Electron launcher starts the real server with external Node.

## Troubleshooting

### QR scanner library failed to load

The app should use the local route:

~~~text
/vendor/jsQR.js
~~~

Make sure dependencies were installed:

~~~powershell
npm install
~~~

### Time looks wrong after scanning

The app stores punch times as local time. If older records were created before the local-time fix, correct them through Attendance Corrections.

### Port is already in use

Use the launcher port field to change the port.

Default port:

~~~text
3000
~~~

If unavailable, the launcher can use another available port.

### Electron launcher opens but app does not load

Check that these folders are still present relative to the launcher:

~~~text
server/
frontend/
node_modules/
~~~

The launcher searches upward for `server/index.js`.

## Security Notes

This app is intended for trusted local network use.

Implemented protections include:

- backend punch validation
- SQLite prepared statements
- admin password requirement for destructive reset actions
- basic input validation
- local database storage
- no cloud service requirement

Recommended operational practices:

- use only on a trusted LAN
- do not expose the server directly to the public internet
- keep regular backups
- protect access to the host computer
- keep Node.js updated 

## License

Apache License 2.0

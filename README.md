# JS-Portable-DTR-LAN

Portable LAN-based Daily Time Record (DTR) Manager built with Node.js, Express, SQLite, Socket.IO, Bootstrap 5, and Electron.

This project is designed for local attendance tracking over a LAN. One host computer runs the server, and other devices on the same Wi-Fi/Ethernet network can open the attendance terminal or admin panel through a browser.

Repository: [https://github.com/paoradox/JS-Portable-DTR-LAN](https://github.com/paoradox/JS-Portable-DTR-LAN)

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

## Tech Stack

- HTML
- CSS
- JavaScript
- Bootstrap 5
- Node.js
- Express
- Socket.IO
- SQLite via `node:sqlite`
- ExcelJS
- Archiver
- Electron
- electron-builder

## Project Structure

~~~text
JS-Portable-DTR-LAN/
├─ electron/
│  ├─ main.js
│  ├─ preload.js
│  └─ renderer/
│     ├─ control.html
│     └─ control.js
├─ server/
│  ├─ index.js
│  └─ db/
│     └─ index.js
├─ frontend/
│  ├─ index.html
│  ├─ admin.html
│  ├─ assets/
│  │  ├─ css/
│  │  ├─ js/
│  │  └─ img/
│  └─ template/
│     └─ Blank_DTR_Template.xlsx
├─ database/
│  └─ data.db
├─ BUILD.md
├─ AI_CODE++.md
├─ package.json
└─ package-lock.json
~~~

## Prerequisites

Install Node.js with support for `node:sqlite`.

This project depends on Node's built-in SQLite module, so the target machine must use a compatible Node.js version.

Check your Node version:

~~~powershell
node -v
~~~

Install dependencies:

~~~powershell
npm install
~~~

## Running the App

### Plain Server Mode

Runs the Express server directly:

~~~powershell
npm start
~~~

Then open:

~~~text
http://localhost:3000
~~~

Admin panel:

~~~text
http://localhost:3000/admin.html
~~~

### Electron Dev Mode

Runs the same server through the Electron launcher:

~~~powershell
npm run electron
~~~

The launcher window shows:

- current port
- local URL
- LAN URLs
- shortcut buttons
- port changer

## Building the Portable Launcher

Before building, run syntax checks:

~~~powershell
node --check server\index.js
node --check frontend\assets\js\api.js
node --check frontend\assets\js\app.js
node --check electron\main.js
node --check electron\preload.js
node --check electron\renderer\control.js
~~~

Test Electron:

~~~powershell
npm run electron
~~~

Build:

~~~powershell
npm run dist
~~~

The build output is created in:

~~~text
dist\win-unpacked\
~~~

Recommended: move the build output into a `launcher/` folder:

~~~powershell
New-Item -ItemType Directory -Force -Path launcher
Move-Item dist\win-unpacked\* launcher\
~~~

Run the built launcher:

~~~text
launcher\DTRManager.exe
~~~

For more detail, see:

~~~text
BUILD.md
~~~

## Portable App Layout

Recommended final layout:

~~~text
JS-Portable-DTR-LAN/
├─ launcher/
│  ├─ DTRManager.exe
│  ├─ resources/
│  ├─ locales/
│  └─ Electron runtime files
├─ electron/
├─ server/
├─ frontend/
├─ database/
├─ node_modules/
├─ app-settings.json
├─ package.json
└─ package-lock.json
~~~

The launcher does not contain a private copy of the app. It finds the real project folder by searching upward for `server/index.js`.

That means ordinary app changes do not require rebuilding.

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

## Available Commands

| Command | Description |
|---|---|
| `npm start` | Start the Express server directly. |
| `npm run dev` | Start the Express server directly. |
| `npm run electron` | Start the app through Electron. |
| `npm run dist` | Build the Electron launcher folder. |

## Main Pages

| Page | URL |
|---|---|
| Attendance Terminal | `http://localhost:3000/index.html` |
| Admin Panel | `http://localhost:3000/admin.html` |

The launcher also shows LAN URLs for other devices on the same network.

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

## Resetting the Database

### Reset From the App

Use the Admin Panel:

~~~text
Backup & Reset
~~~

Available reset options:

- Reset DTR
- Backup & Reset All
- Reset All

### Manual Reset

Stop the server/app first.

Then delete:

~~~text
database\data.db
~~~

Start the app again:

~~~powershell
npm start
~~~

The database file is recreated automatically.

Use manual reset only when you intentionally want a fresh database.

## Local Data

The SQLite database is stored here:

~~~text
database\data.db
~~~

Launcher settings are stored here:

~~~text
app-settings.json
~~~

`app-settings.json` is created automatically after first launch and stores the selected port.

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

No license specified.

## Author

Repository owner: [paoradox](https://github.com/paoradox)

Project repository:

[https://github.com/paoradox/JS-Portable-DTR-LAN](https://github.com/paoradox/JS-Portable-DTR-LAN)

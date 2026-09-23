# Building DTRManager.exe

This project can run three different ways. Pick whichever fits what
you're doing:

| Mode | Command | What it is |
|---|---|---|
| Plain server | `npm start` | Runs in a terminal, no Electron launcher. Good for quick testing. |
| Desktop app, dev mode | `npm run electron` | Same server, inside the Electron control window. Good for testing the desktop experience without building anything. |
| Desktop app, built | `DTRManager.exe` | What you actually run day to day on the host machine. |

Every mode runs the exact same `server/` and `frontend/` code. Nothing
is duplicated or reimplemented between them.

## How this app is laid out

`DTRManager.exe` does **not** contain its own private copy of your
server or frontend code. It is a small launcher that finds and reads
`server/` and `frontend/` by searching upward from wherever it is
actually running.

Recommended layout:

~~~text
JS-Portable-DTR-LAN/
├─ launcher/                <- everything Electron-specific lives here
│  ├─ DTRManager.exe
│  ├─ resources/            <- Electron runtime files
│  ├─ locales/              <- Electron runtime files
│  └─ *.dll / *.pak / ...    <- Electron runtime files
│
├─ electron/                <- launcher source code
│  ├─ main.js
│  ├─ preload.js
│  └─ renderer/
│     ├─ control.html
│     └─ control.js
├─ server/                  <- Express + Socket.IO + SQLite backend
├─ frontend/                <- web app pages and assets
│  ├─ index.html            <- attendance terminal
│  ├─ admin.html            <- admin panel
│  ├─ assets/
│  └─ template/
├─ database/
│  └─ data.db               <- created automatically on first launch
├─ node_modules/            <- runtime npm dependencies
├─ app-settings.json        <- created automatically, stores saved port
├─ package.json
└─ package-lock.json
~~~

Editing anything in `server/` or `frontend/` takes effect the next time
you launch `DTRManager.exe`. You only need to rebuild if you change:

~~~text
electron/main.js
electron/preload.js
electron/renderer/control.html
electron/renderer/control.js
~~~

## Prerequisites

- Node.js compatible with `node:sqlite`
- Run once from the project root:

~~~powershell
npm install
~~~

Important: this project uses `node:sqlite`, so the target machine must
have a compatible Node.js installation available because the Electron
launcher starts the real server with external Node.

## Test before building

From the project root:

~~~powershell
node --check server\index.js
node --check frontend\assets\js\api.js
node --check frontend\assets\js\app.js
node --check electron\main.js
node --check electron\preload.js
node --check electron\renderer\control.js
npm run electron
~~~

Confirm that the launcher opens and the pages work before building.

## Building DTRManager.exe

From the project root:

~~~powershell
npm run dist
~~~

This produces:

~~~text
dist\win-unpacked\
~~~

Move the contents into a `launcher/` subfolder:

~~~powershell
New-Item -ItemType Directory -Force -Path launcher
Move-Item dist\win-unpacked\* launcher\
~~~

You can delete the now-empty `dist/` folder afterward.

## Running it

Double-click:

~~~text
launcher\DTRManager.exe
~~~

The control window opens with:

- Current port
- LAN URL(s) for other devices
- Shortcut buttons for the Attendance Terminal and Admin Panel
- Copy/Open buttons for URLs
- Port change field

The launcher window is intentionally compact:

~~~text
480 × 420
~~~

It uses the same minimal launcher style as the Queue LAN project.

## Changing the port

Two ways:

- From the launcher: enter a new port and click **Change port**.
- Manually: edit `app-settings.json` and restart the app.

If the saved/default port `3000` is already in use, the launcher tries
the next available ports.

## Rebuilding after code changes

| You changed... | Rebuild needed? |
|---|---|
| Anything in `frontend/` | No. Relaunch `launcher\DTRManager.exe`. |
| Anything in `server/` | No. Relaunch `launcher\DTRManager.exe`. |
| `electron/main.js` | Yes. Run `npm run dist` again. |
| `electron/preload.js` | Yes. Run `npm run dist` again. |
| `electron/renderer/*` | Yes. Run `npm run dist` again. |
| `package.json` dependencies | Run `npm install`; rebuild only if Electron files changed too. |

## Distributing to another machine

Copy the entire project folder, including:

~~~text
server/
frontend/
electron/
launcher/
node_modules/
package.json
package-lock.json
~~~

Include `database/` if you want to carry existing attendance data. Leave
it out if you want the new machine to start fresh.

There is no installer and nothing to register with Windows. It runs by
double-clicking:

~~~text
launcher\DTRManager.exe
~~~

## Notes

- Do not use the NSIS `"portable"` target for this project. It can extract
  to a temporary folder and may cause local data loss.
- Use the `"dir"` target from `electron-builder`.
- The launcher is a shell only. The actual app remains editable in
  `server/` and `frontend/`.
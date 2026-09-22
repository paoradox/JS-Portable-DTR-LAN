'use strict';

const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

let currentServer = null;
let currentPort = null;
let controlWindow = null;
const shortcutWindows = {};

const DEFAULT_PORT = 3000;
const SHORTCUTS = [
  { key: 'home', label: 'Open Attendance Terminal', path: '/index.html' },
  { key: 'admin', label: 'Open Admin Panel', path: '/admin.html' }
];

function findProjectRoot(startDir) {
  let dir = startDir;

  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'server', 'index.js'))) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return startDir;
}

function getProjectRoot() {
  const startDir = app.isPackaged
    ? path.dirname(process.execPath)
    : path.join(__dirname, '..');

  return findProjectRoot(startDir);
}

const PROJECT_ROOT = getProjectRoot();
const SETTINGS_PATH = path.join(PROJECT_ROOT, 'app-settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (err) {
    return {};
  }
}

function saveSettings(nextSettings) {
  const current = loadSettings();
  const merged = Object.assign({}, current, nextSettings || {});
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

function getNodeCommand() {
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

function isPortFree(port) {
  return new Promise(function (resolve) {
    const tester = net.createServer();

    tester.once('error', function () {
      resolve(false);
    });

    tester.once('listening', function () {
      tester.close(function () {
        resolve(true);
      });
    });

    tester.listen(port, '127.0.0.1');
  });
}

async function findFreePort(preferredPort, maxAttempts) {
  for (let i = 0; i <= maxAttempts; i += 1) {
    const port = preferredPort + i;
    const free = await isPortFree(port);

    if (free) return port;
  }

  throw new Error('No free port found.');
}

function waitForServer(port, timeoutMs) {
  const startedAt = Date.now();

  return new Promise(function (resolve, reject) {
    function attempt() {
      const socket = net.connect(port, '127.0.0.1');

      socket.once('connect', function () {
        socket.end();
        resolve();
      });

      socket.once('error', function () {
        socket.destroy();

        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error('Server did not start on port ' + port + '.'));
          return;
        }

        setTimeout(attempt, 150);
      });
    }

    attempt();
  });
}

async function startServerOnPort(port) {
  const child = spawn(getNodeCommand(), ['server/index.js'], {
    cwd: PROJECT_ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(port)
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  child.stdout.on('data', function (chunk) {
    console.log(String(chunk).trim());
  });

  child.stderr.on('data', function (chunk) {
    console.error(String(chunk).trim());
  });

  child.once('exit', function (code) {
    if (currentServer === child) {
      currentServer = null;
      currentPort = null;
    }

    console.log('DTR server exited with code ' + code);
  });

  await waitForServer(port, 8000);

  return child;
}

async function startServer() {
  const settings = loadSettings();
  const preferredPort = Number(settings.port || DEFAULT_PORT);
  const port = await findFreePort(preferredPort, 20);

  currentServer = await startServerOnPort(port);
  currentPort = port;

  saveSettings({ port: port });

  return {
    port: port,
    server: currentServer
  };
}

async function changePort(requestedPort) {
  const port = parseInt(requestedPort, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      ok: false,
      error: 'Enter a port number between 1 and 65535.'
    };
  }

  const free = await isPortFree(port);
  if (!free) {
    return {
      ok: false,
      error: 'Port ' + port + ' is already in use.'
    };
  }

  const previousServer = currentServer;

  try {
    const nextServer = await startServerOnPort(port);

    currentServer = nextServer;
    currentPort = port;
    saveSettings({ port: port });

    if (previousServer) {
      previousServer.kill();
    }

    Object.keys(shortcutWindows).forEach(function (key) {
      const win = shortcutWindows[key];
      const shortcut = SHORTCUTS.find(function (item) {
        return item.key === key;
      });

      if (win && !win.isDestroyed() && shortcut) {
        win.loadURL('http://localhost:' + port + shortcut.path);
      }
    });

    return {
      ok: true,
      port: port
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'Could not change port.'
    };
  }
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  Object.keys(interfaces).forEach(function (name) {
    (interfaces[name] || []).forEach(function (iface) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    });
  });

  return addresses;
}

function connectionInfo() {
  const port = currentPort;
  const addresses = getLanAddresses();

  return {
    port: port,
    localUrl: port ? 'http://localhost:' + port : '',
    urls: port ? addresses.map(function (addr) {
      return 'http://' + addr + ':' + port;
    }) : [],
    shortcuts: SHORTCUTS.map(function (item) {
      return {
        key: item.key,
        label: item.label
      };
    })
  };
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 480,
    height: 420,
    resizable: false,
    title: 'DTR Manager Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  controlWindow.setMenuBarVisibility(false);
  controlWindow.loadFile(path.join(__dirname, 'renderer', 'control.html'));

  controlWindow.on('closed', function () {
    controlWindow = null;
  });
}

function openShortcut(key) {
  const shortcut = SHORTCUTS.find(function (item) {
    return item.key === key;
  });

  if (!shortcut || !currentPort) return;

  if (shortcutWindows[key] && !shortcutWindows[key].isDestroyed()) {
    shortcutWindows[key].focus();
    return;
  }

  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: shortcut.label
  });

  win.loadURL('http://localhost:' + currentPort + shortcut.path);

  win.on('closed', function () {
    delete shortcutWindows[key];
  });

  shortcutWindows[key] = win;
}

ipcMain.handle('get-connection-info', function () {
  return connectionInfo();
});

ipcMain.handle('copy-url', function (event, url) {
  clipboard.writeText(url);
  return true;
});

ipcMain.handle('open-shortcut', function (event, key) {
  openShortcut(key);
  return true;
});

ipcMain.handle('open-external-url', function (event, url) {
  shell.openExternal(url);
  return true;
});

ipcMain.handle('change-port', function (event, port) {
  return changePort(port);
});

app.whenReady().then(function () {
  startServer()
    .then(createControlWindow)
    .catch(function (err) {
      console.error(err);
      app.quit();
    });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createControlWindow();
    }
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', function () {
  if (currentServer) {
    currentServer.kill();
  }
});
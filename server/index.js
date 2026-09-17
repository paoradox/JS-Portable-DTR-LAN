'use strict';

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { db, DB_PATH } = require('./db');

const DEFAULT_PORT = 3000;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

function normalizePort(value) {
  const port = parseInt(value, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return DEFAULT_PORT;
  }

  return port;
}

function cleanText(value) {
  return String(value == null ? '' : value).trim();
}

function cleanOptionalText(value) {
  const text = cleanText(value);
  return text || null;
}

function toEmployeeRow(employee) {
  return {
    id: cleanText(employee.id).toUpperCase(),
    firstName: cleanText(employee.firstName).toUpperCase(),
    middleInitial: cleanOptionalText(employee.middleInitial)
      ? cleanText(employee.middleInitial).toUpperCase()
      : '',
    lastName: cleanText(employee.lastName).toUpperCase(),
    position: cleanOptionalText(employee.position)
      ? cleanText(employee.position).toUpperCase()
      : '',
    department: cleanOptionalText(employee.department)
      ? cleanText(employee.department).toUpperCase()
      : '',
    notes: cleanOptionalText(employee.notes)
      ? cleanText(employee.notes).toUpperCase()
      : '',
    ecName: cleanOptionalText(employee.ecName)
      ? cleanText(employee.ecName).toUpperCase()
      : '',
    ecPhone: cleanText(employee.ecPhone),
    photo: cleanText(employee.photo),
    disabled: employee.disabled ? 1 : 0
  };
}

function fromEmployeeRow(row) {
  return {
    id: row.id,
    firstName: row.firstName,
    middleInitial: row.middleInitial || '',
    lastName: row.lastName,
    position: row.position || '',
    department: row.department || '',
    notes: row.notes || '',
    ecName: row.ecName || '',
    ecPhone: row.ecPhone || '',
    photo: row.photo || '',
    disabled: Boolean(row.disabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function getEmployees() {
  const rows = db.prepare(`
    SELECT
      id,
      first_name AS firstName,
      middle_initial AS middleInitial,
      last_name AS lastName,
      position,
      department,
      notes,
      emergency_name AS ecName,
      emergency_phone AS ecPhone,
      photo_data_url AS photo,
      disabled,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM employees
    ORDER BY last_name ASC, first_name ASC, id ASC
  `).all();

  return rows.map(fromEmployeeRow);
}

function getEmployeeById(id) {
  const row = db.prepare(`
    SELECT
      id,
      first_name AS firstName,
      middle_initial AS middleInitial,
      last_name AS lastName,
      position,
      department,
      notes,
      emergency_name AS ecName,
      emergency_phone AS ecPhone,
      photo_data_url AS photo,
      disabled,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM employees
    WHERE id = ?
  `).get(cleanText(id).toUpperCase());

  return row ? fromEmployeeRow(row) : null;
}

function saveEmployee(employee) {
  const row = toEmployeeRow(employee);

  if (!row.id) {
    const err = new Error('Employee ID is required.');
    err.statusCode = 400;
    throw err;
  }

  if (!row.firstName || !row.lastName) {
    const err = new Error('First name and last name are required.');
    err.statusCode = 400;
    throw err;
  }

  db.prepare(`
    INSERT INTO employees (
      id,
      first_name,
      middle_initial,
      last_name,
      position,
      department,
      notes,
      emergency_name,
      emergency_phone,
      photo_data_url,
      disabled,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      first_name = excluded.first_name,
      middle_initial = excluded.middle_initial,
      last_name = excluded.last_name,
      position = excluded.position,
      department = excluded.department,
      notes = excluded.notes,
      emergency_name = excluded.emergency_name,
      emergency_phone = excluded.emergency_phone,
      photo_data_url = excluded.photo_data_url,
      disabled = excluded.disabled,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    row.id,
    row.firstName,
    row.middleInitial,
    row.lastName,
    row.position,
    row.department,
    row.notes,
    row.ecName,
    row.ecPhone,
    row.photo,
    row.disabled
  );

  return getEmployeeById(row.id);
}

function setEmployeeDisabled(id, disabled) {
  const employeeId = cleanText(id).toUpperCase();
  const existing = getEmployeeById(employeeId);

  if (!existing) {
    const err = new Error('Employee not found.');
    err.statusCode = 404;
    throw err;
  }

  db.prepare(`
    UPDATE employees
    SET disabled = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(disabled ? 1 : 0, employeeId);

  if (disabled) {
    db.prepare(`
      INSERT INTO punches (employee_id, action)
      VALUES (?, 'Clock Out')
    `).run(employeeId);
  }

  return getEmployeeById(employeeId);
}

function getSetting(key, fallback) {
  const row = db.prepare(`
    SELECT value
    FROM app_settings
    WHERE key = ?
  `).get(key);

  if (!row) return fallback;

  try {
    return JSON.parse(row.value);
  } catch (err) {
    return fallback;
  }
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, JSON.stringify(value));

  return value;
}

function getAdminAccount() {
  const row = db.prepare(`
    SELECT username, salt, password_hash AS passwordHash
    FROM admin_accounts
    WHERE id = 1
  `).get();

  return row || null;
}

function saveAdminAccount(account) {
  const username = cleanText(account.username);
  const salt = cleanText(account.salt);
  const passwordHash = cleanText(account.passwordHash);

  if (!username || !salt || !passwordHash) {
    const err = new Error('Username, salt, and password hash are required.');
    err.statusCode = 400;
    throw err;
  }

  db.prepare(`
    INSERT INTO admin_accounts (id, username, salt, password_hash, updated_at)
    VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      salt = excluded.salt,
      password_hash = excluded.password_hash,
      updated_at = CURRENT_TIMESTAMP
  `).run(username, salt, passwordHash);

  return getAdminAccount();
}

function recordPunch(employeeId, action) {
  const id = cleanText(employeeId).toUpperCase();
  const cleanAction = cleanText(action);

  if (cleanAction !== 'Clock In' && cleanAction !== 'Clock Out') {
    const err = new Error('Punch action must be Clock In or Clock Out.');
    err.statusCode = 400;
    throw err;
  }

  const employee = getEmployeeById(id);

  if (!employee) {
    const err = new Error('Employee not found.');
    err.statusCode = 404;
    throw err;
  }

  if (employee.disabled) {
    const err = new Error('Employee ID is disabled.');
    err.statusCode = 403;
    throw err;
  }

  const result = db.prepare(`
    INSERT INTO punches (employee_id, action)
    VALUES (?, ?)
  `).run(id, cleanAction);

  return db.prepare(`
    SELECT
      id,
      employee_id AS employeeId,
      action,
      punched_at AS punchedAt
    FROM punches
    WHERE id = ?
  `).get(result.lastInsertRowid);
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return year + '-' + month + '-' + day;
}

function getTodayPunches() {
  return db.prepare(`
    SELECT
      id,
      employee_id AS employeeId,
      action,
      punched_at AS punchedAt
    FROM punches
    WHERE date(punched_at, 'localtime') = date('now', 'localtime')
    ORDER BY punched_at ASC, id ASC
  `).all();
}

function countOnSiteToday() {
  const punches = getTodayPunches();
  const latestByEmployee = new Map();

  punches.forEach(function (punch) {
    latestByEmployee.set(punch.employeeId, punch.action);
  });

  let total = 0;

  latestByEmployee.forEach(function (action, employeeId) {
    const employee = getEmployeeById(employeeId);

    if (employee && !employee.disabled && action === 'Clock In') {
      total += 1;
    }
  });

  return total;
}

function getStats() {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN disabled = 0 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN disabled = 1 THEN 1 ELSE 0 END) AS disabled
    FROM employees
  `).get();

  return {
    employees: row.total || 0,
    activeIds: row.active || 0,
    disabledIds: row.disabled || 0,
    onSite: countOnSiteToday(),
    today: getTodayKey()
  };
}

function createApp(ioRef) {
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  function broadcastDataChanged(type, payload) {
    if (ioRef.io) {
      ioRef.io.emit('data-changed', {
        type: type,
        payload: payload || {}
      });
    }
  }

  app.get('/api/health', function (req, res) {
    res.json({
      ok: true,
      app: 'DTR Manager',
      database: DB_PATH
    });
  });

  app.get('/api/bootstrap', function (req, res) {
    res.json({
      employees: getEmployees(),
      stats: getStats(),
      reminder: getSetting('reminder', null),
      adminAccount: getAdminAccount()
    });
  });

  app.get('/api/stats', function (req, res) {
    res.json(getStats());
  });

  app.get('/api/settings/:key', function (req, res) {
    res.json({
      key: req.params.key,
      value: getSetting(req.params.key, null)
    });
  });

  app.put('/api/settings/:key', function (req, res) {
    const value = setSetting(req.params.key, req.body.value);

    broadcastDataChanged('settings', {
      key: req.params.key
    });

    res.json({
      key: req.params.key,
      value: value
    });
  });

  app.get('/api/admin-account', function (req, res) {
    res.json({
      account: getAdminAccount()
    });
  });

  app.put('/api/admin-account', function (req, res) {
    const account = saveAdminAccount(req.body || {});

    broadcastDataChanged('admin-account', {});

    res.json({
      account: account
    });
  });

  app.get('/api/employees', function (req, res) {
    res.json({
      employees: getEmployees()
    });
  });

  app.put('/api/employees/:id', function (req, res) {
    const employee = saveEmployee({
      ...(req.body || {}),
      id: req.params.id
    });

    broadcastDataChanged('employees', {
      id: employee.id
    });

    res.json({
      employee: employee,
      employees: getEmployees(),
      stats: getStats()
    });
  });

  app.patch('/api/employees/:id/status', function (req, res) {
    const employee = setEmployeeDisabled(req.params.id, Boolean(req.body.disabled));

    broadcastDataChanged('employees', {
      id: employee.id
    });

    res.json({
      employee: employee,
      employees: getEmployees(),
      stats: getStats()
    });
  });

  app.post('/api/punches', function (req, res) {
    const punch = recordPunch(req.body.employeeId, req.body.action);

    broadcastDataChanged('punches', {
      employeeId: punch.employeeId
    });

    res.status(201).json({
      punch: punch,
      stats: getStats()
    });
  });

  app.get('/api/punches/today', function (req, res) {
    res.json({
      punches: getTodayPunches(),
      stats: getStats()
    });
  });

  app.use(express.static(FRONTEND_DIR));

  app.get('/', function (req, res) {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });

  app.use(function (req, res) {
    res.status(404).json({
      error: 'Not found.'
    });
  });

  app.use(function (err, req, res, next) {
    const statusCode = err.statusCode || 500;

    if (statusCode >= 500) {
      console.error(err);
    }

    res.status(statusCode).json({
      error: err.message || 'Server error.'
    });
  });

  return app;
}

function start(portValue) {
  const port = normalizePort(portValue);

  return new Promise(function (resolve, reject) {
    const ioRef = { io: null };
    const app = createApp(ioRef);
    const httpServer = http.createServer(app);
    const io = new Server(httpServer);

    ioRef.io = io;

    io.on('connection', function (socket) {
      socket.emit('server-ready', {
        ok: true,
        port: port
      });
    });

    httpServer.once('error', reject);

    httpServer.listen(port, function () {
      resolve({
        port: port,
        server: httpServer,
        io: io
      });
    });
  });
}

module.exports = {
  start
};

if (require.main === module) {
  start(process.env.PORT || DEFAULT_PORT)
    .then(function (result) {
      console.log('DTR Manager server running at http://localhost:' + result.port);
    })
    .catch(function (err) {
      console.error(err);
      process.exit(1);
    });
}
'use strict';

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { db, DB_PATH } = require('./db');
const ExcelJS = require('exceljs');
const { ZipArchive } = require('archiver');
const crypto = require('crypto');

const DEFAULT_PORT = 3000;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const TEMPLATE_PATH = path.join(FRONTEND_DIR, 'template', 'Blank_DTR_Template.xlsx');

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

function isValidEmployeeId(value) {
  return /^[A-Z0-9][A-Z0-9_-]{1,31}$/i.test(cleanText(value));
}

function rejectBadEmployeeId(id) {
  if (!isValidEmployeeId(id)) {
    const err = new Error('Employee ID format is invalid.');
    err.statusCode = 400;
    throw err;
  }
}

function makeRateLimiter(windowMs, max, message) {
  return rateLimit({
    windowMs: windowMs,
    max: max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: message || 'Too many requests. Please try again later.'
    }
  });
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
    rejectBadEmployeeId(row.id);
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
  rejectBadEmployeeId(employeeId);
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

function hashAdminPassword(password, salt) {
  return crypto
    .createHash('sha256')
    .update(String(salt || '') + '::' + String(password || ''))
    .digest('hex');
}

function requireAdminPassword(body) {
  const password = cleanText(body && body.adminPassword);
  const account = getAdminAccount();

  if (!password) {
    const err = new Error('Administrator password is required.');
    err.statusCode = 401;
    throw err;
  }

  if (!account) {
    const err = new Error('No admin account found.');
    err.statusCode = 403;
    throw err;
  }

  const hash = hashAdminPassword(password, account.salt);
  if (hash !== account.passwordHash) {
    const err = new Error('Incorrect password.');
    err.statusCode = 403;
    throw err;
  }
}

function getTodayPunchesForEmployee(employeeId) {
  return db.prepare(`
    SELECT
      id,
      employee_id AS employeeId,
      action,
      punched_at AS punchedAt
    FROM punches
    WHERE employee_id = ?
AND substr(punched_at, 1, 10) = date('now', 'localtime')
    ORDER BY punched_at ASC, id ASC
  `).all(cleanText(employeeId).toUpperCase());
}

function validatePunchSequence(employeeId, action) {
  const punches = getTodayPunchesForEmployee(employeeId);
  const latest = punches.length ? punches[punches.length - 1] : null;
  const clockInCount = punches.filter(function (punch) {
    return punch.action === 'Clock In';
  }).length;
  const clockOutCount = punches.filter(function (punch) {
    return punch.action === 'Clock Out';
  }).length;

  function reject(message) {
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  }

  if (!punches.length && action === 'Clock Out') {
    reject('First punch today must be Clock In.');
  }

  if (latest && latest.action === action) {
    if (action === 'Clock In') {
      reject('Already clocked in. Please choose Clock Out next.');
    }

    reject('Already clocked out. Please choose Clock In next.');
  }

  if (punches.length >= 4) {
    reject('Daily punch limit reached.');
  }

  if (action === 'Clock In' && clockInCount >= 2) {
    reject('Maximum Clock In records reached for today.');
  }

  if (action === 'Clock Out' && clockOutCount >= 2) {
    reject('Maximum Clock Out records reached for today.');
  }
}

function recordPunch(employeeId, action) {
  const id = cleanText(employeeId).toUpperCase();
  rejectBadEmployeeId(id);
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

  validatePunchSequence(id, cleanAction);

  const result = db.prepare(`
    INSERT INTO punches (employee_id, action, punched_at)
    VALUES (?, ?, datetime('now', 'localtime'))
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
    WHERE substr(punched_at, 1, 10) = date('now', 'localtime')
    ORDER BY punched_at ASC, id ASC
  `).all();
}

function isValidMonth(value) {
  return /^\d{4}-\d{2}$/.test(cleanText(value));
}

function getMonthlyPunches(month, employeeId) {
  const cleanMonth = cleanText(month);

  if (!isValidMonth(cleanMonth)) {
    const err = new Error('Month must use YYYY-MM format.');
    err.statusCode = 400;
    throw err;
  }

  const params = [cleanMonth];
  let employeeFilter = '';

  if (employeeId) {
    employeeFilter = 'AND employee_id = ?';
    params.push(cleanText(employeeId).toUpperCase());
  }

  return db.prepare(`
    SELECT
      id,
      employee_id AS employeeId,
      action,
      punched_at AS punchedAt,
    substr(punched_at, 1, 10) AS punchDate,
    substr(punched_at, 12, 8) AS punchTime
    FROM punches
    WHERE substr(punched_at, 1, 7) = ?
      ${employeeFilter}
    ORDER BY employee_id ASC, punched_at ASC, id ASC
  `).all(...params);
}

function isValidPunchDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(cleanText(value));
}

function getPunchById(id) {
  return db.prepare(`
    SELECT
      id,
      employee_id AS employeeId,
      action,
      punched_at AS punchedAt,
      substr(punched_at, 1, 10) AS punchDate,
      substr(punched_at, 12, 8) AS punchTime
    FROM punches
    WHERE id = ?
  `).get(Number(id));
}

function getPunchesForEmployeeDate(employeeId, punchDate) {
  return db.prepare(`
    SELECT
      id,
      employee_id AS employeeId,
      action,
      punched_at AS punchedAt
    FROM punches
    WHERE employee_id = ?
      AND substr(punched_at, 1, 10) = ?
    ORDER BY punched_at ASC, id ASC
  `).all(cleanText(employeeId).toUpperCase(), cleanText(punchDate));
}

function validateCorrectedPunchDay(employeeId, punchDate) {
  const punches = getPunchesForEmployeeDate(employeeId, punchDate);

  function reject(message) {
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  }

  if (punches.length > 4) {
    reject('Daily punch limit reached.');
  }

  const expected = ['Clock In', 'Clock Out', 'Clock In', 'Clock Out'];

  for (let i = 0; i < punches.length; i++) {
    if (punches[i].action !== expected[i]) {
      if (i === 0) {
        reject('First punch of the day must be Clock In.');
      }

      if (expected[i] === 'Clock Out') {
        reject('Clock Out must come after Clock In.');
      }

      reject('Clock In must come after Clock Out.');
    }

    if (i > 0 && punches[i].punchedAt <= punches[i - 1].punchedAt) {
      reject('Punch times must be in chronological order.');
    }
  }
}

function addCorrectedPunch(employeeId, action, punchedAtLocal) {
  const cleanEmployeeId = cleanText(employeeId).toUpperCase();
  rejectBadEmployeeId(cleanEmployeeId);
  const cleanAction = cleanText(action);
  const cleanDateTime = cleanText(punchedAtLocal);

  if (!cleanEmployeeId) {
    const err = new Error('Employee ID is required.');
    err.statusCode = 400;
    throw err;
  }

  if (cleanAction !== 'Clock In' && cleanAction !== 'Clock Out') {
    const err = new Error('Punch action must be Clock In or Clock Out.');
    err.statusCode = 400;
    throw err;
  }

  if (!isValidPunchDateTime(cleanDateTime)) {
    const err = new Error('Punch date and time must be valid.');
    err.statusCode = 400;
    throw err;
  }

  const employee = getEmployeeById(cleanEmployeeId);
  if (!employee) {
    const err = new Error('Employee not found.');
    err.statusCode = 404;
    throw err;
  }

  const sqliteDateTime = cleanDateTime.replace('T', ' ') + ':00';

  const result = db.prepare(`
    INSERT INTO punches (employee_id, action, punched_at)
    VALUES (?, ?, ?)
  `).run(cleanEmployeeId, cleanAction, sqliteDateTime);

  const punchId = result.lastInsertRowid;

  try {
    const added = getPunchById(punchId);
    validateCorrectedPunchDay(added.employeeId, added.punchDate);
    return added;
  } catch (err) {
    db.prepare(`
      DELETE FROM punches
      WHERE id = ?
    `).run(punchId);

    throw err;
  }
}

function updatePunch(id, action, punchedAtLocal) {
  const punchId = Number(id);
  const cleanAction = cleanText(action);
  const cleanDateTime = cleanText(punchedAtLocal);

  if (!Number.isInteger(punchId) || punchId <= 0) {
    const err = new Error('Invalid punch record.');
    err.statusCode = 400;
    throw err;
  }

  if (cleanAction !== 'Clock In' && cleanAction !== 'Clock Out') {
    const err = new Error('Punch action must be Clock In or Clock Out.');
    err.statusCode = 400;
    throw err;
  }

  if (!isValidPunchDateTime(cleanDateTime)) {
    const err = new Error('Punch date and time must be valid.');
    err.statusCode = 400;
    throw err;
  }

  const existing = getPunchById(punchId);
  if (!existing) {
    const err = new Error('Punch record not found.');
    err.statusCode = 404;
    throw err;
  }

  const sqliteDateTime = cleanDateTime.replace('T', ' ') + ':00';

  try {
    db.prepare(`
      UPDATE punches
      SET action = ?, punched_at = ?
      WHERE id = ?
    `).run(cleanAction, sqliteDateTime, punchId);

    const updated = getPunchById(punchId);

    validateCorrectedPunchDay(updated.employeeId, updated.punchDate);

    if (existing.punchDate !== updated.punchDate) {
      validateCorrectedPunchDay(existing.employeeId, existing.punchDate);
    }

    return updated;
  } catch (err) {
    db.prepare(`
      UPDATE punches
      SET action = ?, punched_at = ?
      WHERE id = ?
    `).run(existing.action, existing.punchedAt, punchId);

    throw err;
  }
}

function deletePunch(id) {
  const punchId = Number(id);

  if (!Number.isInteger(punchId) || punchId <= 0) {
    const err = new Error('Invalid punch record.');
    err.statusCode = 400;
    throw err;
  }

  const existing = getPunchById(punchId);
  if (!existing) {
    const err = new Error('Punch record not found.');
    err.statusCode = 404;
    throw err;
  }

  db.prepare(`
    DELETE FROM punches
    WHERE id = ?
  `).run(punchId);

  try {
    validateCorrectedPunchDay(existing.employeeId, existing.punchDate);
    return existing;
  } catch (err) {
    db.prepare(`
      INSERT INTO punches (id, employee_id, action, punched_at)
      VALUES (?, ?, ?, ?)
    `).run(existing.id, existing.employeeId, existing.action, existing.punchedAt);

    throw err;
  }
}

function groupMonthlyPunchesByEmployee(month) {
  const employees = getEmployees();
  const punches = getMonthlyPunches(month, '');

  const punchesByEmployee = {};
  punches.forEach(function (punch) {
    if (!punchesByEmployee[punch.employeeId]) {
      punchesByEmployee[punch.employeeId] = [];
    }

    punchesByEmployee[punch.employeeId].push(punch);
  });

  return employees.map(function (employee) {
    return {
      employee: employee,
      punches: punchesByEmployee[employee.id] || []
    };
  });
}

function formatEmployeeName(employee) {
  const middle = employee.middleInitial
    ? cleanText(employee.middleInitial).replace(/\.+$/, '') + '.'
    : '';

  return [employee.firstName, middle, employee.lastName]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function monthLabel(month) {
  const [year, monthNumber] = cleanText(month).split('-').map(Number);
  const date = new Date(year, monthNumber - 1, 1);

  return date.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric'
  });
}

function timeToExcelValue(punchedAt) {
  const timePart = cleanText(punchedAt).split(' ')[1] || '';
  const parts = timePart.split(':').map(Number);

  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
    return null;
  }

  const hours = parts[0];
  const minutes = parts[1];
  const seconds = Number.isFinite(parts[2]) ? parts[2] : 0;

  return (hours * 3600 + minutes * 60 + seconds) / 86400;
}

function dayFromPunch(punch) {
  const datePart = cleanText(punch.punchedAt).split(' ')[0];
  const day = Number(datePart.split('-')[2]);

  return Number.isFinite(day) ? day : 0;
}

function buildDtrDayMap(punches) {
  const byDay = {};

  punches.forEach(function (punch) {
    const day = dayFromPunch(punch);
    if (!day) return;

    if (!byDay[day]) {
      byDay[day] = {
        clockIns: [],
        clockOuts: []
      };
    }

    if (punch.action === 'Clock In') {
      byDay[day].clockIns.push(punch);
    }

    if (punch.action === 'Clock Out') {
      byDay[day].clockOuts.push(punch);
    }
  });

  return byDay;
}

function fillDtrWorksheet(worksheet, employee, month, punches) {
  const fullName = employee ? formatEmployeeName(employee) : '';
  const label = month ? monthLabel(month) : '';
  const byDay = buildDtrDayMap(punches || []);

  worksheet.getCell('D8').value = fullName;
  worksheet.getCell('D11').value = 'For the month of';
  worksheet.getCell('F11').value = label;
  worksheet.getCell('D55').value = fullName;

  for (let day = 1; day <= 31; day += 1) {
    const rowNumber = 16 + day;
    const dayPunches = byDay[day] || { clockIns: [], clockOuts: [] };

    const values = [
      dayPunches.clockIns[0] ? timeToExcelValue(dayPunches.clockIns[0].punchedAt) : null,
      dayPunches.clockOuts[0] ? timeToExcelValue(dayPunches.clockOuts[0].punchedAt) : null,
      dayPunches.clockIns[1] ? timeToExcelValue(dayPunches.clockIns[1].punchedAt) : null,
      dayPunches.clockOuts[1] ? timeToExcelValue(dayPunches.clockOuts[1].punchedAt) : null
    ];

    ['D', 'E', 'F', 'G'].forEach(function (col, index) {
      const cell = worksheet.getCell(col + rowNumber);
      cell.value = values[index];
      cell.numFmt = 'hh:mm';
    });
  }
}

function safeSheetName(value, fallback) {
  return cleanText(value || fallback)
    .replace(/[\\/?*[\]:]/g, '-')
    .slice(0, 31) || fallback;
}

async function buildSingleDtrWorkbook(employee, month, punches) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);

  const worksheet = workbook.worksheets[0];
  worksheet.name = safeSheetName(employee ? employee.id : 'Blank DTR', 'DTR');

  fillDtrWorksheet(worksheet, employee, month, punches || []);

  workbook.calcProperties.fullCalcOnLoad = true;

  return workbook;
}

async function buildSingleDtrBuffer(employee, month, punches) {
  const workbook = await buildSingleDtrWorkbook(employee, month, punches);
  return workbook.xlsx.writeBuffer();
}

function safeFileName(value) {
  return cleanText(value)
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}

async function sendAllEmployeesDtrZip(res, month) {
  const records = groupMonthlyPunchesByEmployee(month);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="All_Employees_DTR_' + month + '.zip"'
  );

  const archive = new ZipArchive({
    zlib: { level: 9 }
  });

  archive.on('error', function (err) {
    throw err;
  });

  archive.pipe(res);

  for (const record of records) {
    const employeeId = safeFileName(record.employee.id || 'Employee');
    const buffer = await buildSingleDtrBuffer(record.employee, month, record.punches);

    archive.append(Buffer.from(buffer), {
      name: employeeId + '_DTR_' + month + '.xlsx'
    });
  }
  await archive.finalize();
}

async function sendWorkbook(res, workbook, filename) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="' + filename.replace(/"/g, '') + '"'
  );

  await workbook.xlsx.write(res);
  res.end();
}

function csvCell(value) {
  if (value == null) return '';

  const text = String(value);

  if (/[",\r\n]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }

  return text;
}

function getAllPunches() {
  return db.prepare(`
    SELECT
      p.id,
      p.employee_id AS employeeId,
      p.action,
      p.punched_at AS punchedAt,
      e.first_name AS firstName,
      e.middle_initial AS middleInitial,
      e.last_name AS lastName,
      e.position,
      e.department
    FROM punches p
    LEFT JOIN employees e ON e.id = p.employee_id
    ORDER BY p.punched_at ASC, p.id ASC
  `).all();
}

function buildBackupCsv() {
  const employees = getEmployees();
  const punches = getAllPunches();

  const lines = [];

  lines.push(['DTR Manager Backup'].map(csvCell).join(','));
  lines.push(['Generated At', new Date().toISOString()].map(csvCell).join(','));
  lines.push([]);

  lines.push(['Employees'].map(csvCell).join(','));
  lines.push([
    'Employee ID',
    'First Name',
    'Middle Initial',
    'Last Name',
    'Full Name',
    'Position',
    'Department',
    'QR Notes',
    'Emergency Contact Name',
    'Emergency Contact Phone',
    'Status',
    'Has Photo',
    'Created At',
    'Updated At'
  ].map(csvCell).join(','));

  employees.forEach(function (employee) {
    lines.push([
      employee.id,
      employee.firstName,
      employee.middleInitial,
      employee.lastName,
      formatEmployeeName(employee),
      employee.position,
      employee.department,
      employee.notes,
      employee.ecName,
      employee.ecPhone,
      employee.disabled ? 'Disabled' : 'Active',
      employee.photo ? 'Yes' : 'No',
      employee.createdAt,
      employee.updatedAt
    ].map(csvCell).join(','));
  });

  lines.push([]);
  lines.push(['Attendance Punches'].map(csvCell).join(','));
  lines.push([
    'Punch ID',
    'Employee ID',
    'Full Name',
    'Position',
    'Department',
    'Action',
    'Punched At'
  ].map(csvCell).join(','));

  punches.forEach(function (punch) {
    lines.push([
      punch.id,
      punch.employeeId,
      formatEmployeeName({
        firstName: punch.firstName || '',
        middleInitial: punch.middleInitial || '',
        lastName: punch.lastName || ''
      }),
      punch.position || '',
      punch.department || '',
      punch.action,
      punch.punchedAt
    ].map(csvCell).join(','));
  });

  return lines.join('\r\n');
}

async function buildBackupWorkbook() {
  const employees = getEmployees();
  const punches = getAllPunches();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DTR Manager';
  workbook.created = new Date();

  const employeeSheet = workbook.addWorksheet('Employee IDs');
  employeeSheet.columns = [
    { header: 'Employee ID', key: 'id', width: 18 },
    { header: 'First Name', key: 'firstName', width: 22 },
    { header: 'Middle Initial', key: 'middleInitial', width: 16 },
    { header: 'Last Name', key: 'lastName', width: 22 },
    { header: 'Full Name', key: 'fullName', width: 34 },
    { header: 'Position', key: 'position', width: 24 },
    { header: 'Department', key: 'department', width: 24 },
    { header: 'QR Notes', key: 'notes', width: 28 },
    { header: 'Emergency Contact Name', key: 'ecName', width: 32 },
    { header: 'Emergency Contact Phone', key: 'ecPhone', width: 22 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Has Photo', key: 'hasPhoto', width: 12 },
    { header: 'Created At', key: 'createdAt', width: 22 },
    { header: 'Updated At', key: 'updatedAt', width: 22 }
  ];

  employees.forEach(function (employee) {
    employeeSheet.addRow({
      id: employee.id,
      firstName: employee.firstName,
      middleInitial: employee.middleInitial,
      lastName: employee.lastName,
      fullName: formatEmployeeName(employee),
      position: employee.position,
      department: employee.department,
      notes: employee.notes,
      ecName: employee.ecName,
      ecPhone: employee.ecPhone,
      status: employee.disabled ? 'Disabled' : 'Active',
      hasPhoto: employee.photo ? 'Yes' : 'No',
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt
    });
  });

  const punchSheet = workbook.addWorksheet('DTR Time Logs');
  punchSheet.columns = [
    { header: 'Punch ID', key: 'id', width: 12 },
    { header: 'Employee ID', key: 'employeeId', width: 18 },
    { header: 'Full Name', key: 'fullName', width: 34 },
    { header: 'Position', key: 'position', width: 24 },
    { header: 'Department', key: 'department', width: 24 },
    { header: 'Action', key: 'action', width: 14 },
    { header: 'Punched At', key: 'punchedAt', width: 22 }
  ];

  punches.forEach(function (punch) {
    punchSheet.addRow({
      id: punch.id,
      employeeId: punch.employeeId,
      fullName: formatEmployeeName({
        firstName: punch.firstName || '',
        middleInitial: punch.middleInitial || '',
        lastName: punch.lastName || ''
      }),
      position: punch.position || '',
      department: punch.department || '',
      action: punch.action,
      punchedAt: punch.punchedAt
    });
  });

  [employeeSheet, punchSheet].forEach(function (sheet) {
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    sheet.eachRow(function (row) {
      row.eachCell(function (cell) {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });
  });

  return workbook;
}

function photoExtensionFromDataUrl(dataUrl) {
  var match = cleanText(dataUrl).match(/^data:image\/([a-zA-Z0-9.+-]+);base64,/);

  if (!match) return 'jpg';

  var type = match[1].toLowerCase();

  if (type === 'jpeg') return 'jpg';
  if (type === 'svg+xml') return 'svg';

  return type;
}

function photoBufferFromDataUrl(dataUrl) {
  var text = cleanText(dataUrl);
  var commaIndex = text.indexOf(',');

  if (commaIndex < 0) return null;

  return Buffer.from(text.slice(commaIndex + 1), 'base64');
}

async function buildEmployeeIdsWorkbook() {
  const employees = getEmployees();
  const workbook = new ExcelJS.Workbook();

  workbook.creator = 'DTR Manager';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Employee IDs');
  sheet.columns = [
    { header: 'Employee ID', key: 'id', width: 18 },
    { header: 'First Name', key: 'firstName', width: 22 },
    { header: 'Middle Initial', key: 'middleInitial', width: 16 },
    { header: 'Last Name', key: 'lastName', width: 22 },
    { header: 'Full Name', key: 'fullName', width: 34 },
    { header: 'Position', key: 'position', width: 24 },
    { header: 'Department', key: 'department', width: 24 },
    { header: 'QR Notes', key: 'notes', width: 28 },
    { header: 'Emergency Contact Name', key: 'ecName', width: 32 },
    { header: 'Emergency Contact Phone', key: 'ecPhone', width: 22 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Has Photo', key: 'hasPhoto', width: 12 },
    { header: 'Photo File', key: 'photoFile', width: 28 },
    { header: 'Created At', key: 'createdAt', width: 22 },
    { header: 'Updated At', key: 'updatedAt', width: 22 }
  ];

  employees.forEach(function (employee) {
    var photoFile = '';

    if (employee.photo) {
      photoFile = 'photos/' + safeFileName(employee.id) + '.' + photoExtensionFromDataUrl(employee.photo);
    }

    sheet.addRow({
      id: employee.id,
      firstName: employee.firstName,
      middleInitial: employee.middleInitial,
      lastName: employee.lastName,
      fullName: formatEmployeeName(employee),
      position: employee.position,
      department: employee.department,
      notes: employee.notes,
      ecName: employee.ecName,
      ecPhone: employee.ecPhone,
      status: employee.disabled ? 'Disabled' : 'Active',
      hasPhoto: employee.photo ? 'Yes' : 'No',
      photoFile: photoFile,
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt
    });
  });

  styleBackupSheet(sheet);

  return workbook;
}

async function buildDtrTimeLogsWorkbook() {
  const punches = getAllPunches();
  const workbook = new ExcelJS.Workbook();

  workbook.creator = 'DTR Manager';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('DTR Time Logs');
  sheet.columns = [
    { header: 'Punch ID', key: 'id', width: 12 },
    { header: 'Employee ID', key: 'employeeId', width: 18 },
    { header: 'Full Name', key: 'fullName', width: 34 },
    { header: 'Position', key: 'position', width: 24 },
    { header: 'Department', key: 'department', width: 24 },
    { header: 'Action', key: 'action', width: 14 },
    { header: 'Punched At', key: 'punchedAt', width: 22 }
  ];

  punches.forEach(function (punch) {
    sheet.addRow({
      id: punch.id,
      employeeId: punch.employeeId,
      fullName: formatEmployeeName({
        firstName: punch.firstName || '',
        middleInitial: punch.middleInitial || '',
        lastName: punch.lastName || ''
      }),
      position: punch.position || '',
      department: punch.department || '',
      action: punch.action,
      punchedAt: punch.punchedAt
    });
  });

  styleBackupSheet(sheet);

  return workbook;
}

function styleBackupSheet(sheet) {
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  sheet.eachRow(function (row) {
    row.eachCell(function (cell) {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.alignment = {
        vertical: 'top',
        wrapText: false
      };
    });
  });
}

async function workbookToBuffer(workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function sendBackupZip(res) {
  const employees = getEmployees();
  const employeeWorkbook = await buildEmployeeIdsWorkbook();
  const logsWorkbook = await buildDtrTimeLogsWorkbook();

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="DTR_Backup_' + getTodayKey() + '.zip"'
  );

  const archive = new ZipArchive({
    zlib: { level: 9 }
  });

  archive.on('error', function (err) {
    throw err;
  });

  archive.pipe(res);

  archive.append(await workbookToBuffer(employeeWorkbook), {
    name: 'Employee IDs.xlsx'
  });

  archive.append(await workbookToBuffer(logsWorkbook), {
    name: 'DTR Time Logs.xlsx'
  });

  employees.forEach(function (employee) {
    if (!employee.photo) return;

    var photoBuffer = photoBufferFromDataUrl(employee.photo);
    if (!photoBuffer) return;

    var ext = photoExtensionFromDataUrl(employee.photo);

    archive.append(photoBuffer, {
      name: 'photos/' + safeFileName(employee.id) + '.' + ext
    });
  });

  await archive.finalize();
}

function clearDtrRecords() {
  db.exec(`
    DELETE FROM punches;
  `);
}

function clearAllRecords() {
  db.exec(`
    DELETE FROM punches;
    DELETE FROM employees;
  `);
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

  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
        "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
        "font-src": ["'self'", "https://cdnjs.cloudflare.com"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'", "ws:", "wss:"]
      }
    }
  }));

  app.use(express.json({
    limit: '3mb'
  }));

  const apiLimiter = makeRateLimiter(60 * 1000, 180, 'Too many API requests. Please wait a moment.');
  const writeLimiter = makeRateLimiter(60 * 1000, 60, 'Too many write requests. Please wait a moment.');

  app.use('/api/', apiLimiter);

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

  app.put('/api/settings/:key', writeLimiter, function (req, res) {
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

  app.put('/api/admin-account', writeLimiter, function (req, res) {
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

  app.put('/api/employees/:id', writeLimiter, function (req, res) {
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

  app.patch('/api/employees/:id/status', writeLimiter, function (req, res) {
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

  app.post('/api/punches', writeLimiter, function (req, res) {
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

    app.get('/api/punches/monthly', function (req, res) {
    res.json({
      month: cleanText(req.query.month),
      employeeId: cleanText(req.query.employeeId).toUpperCase(),
      punches: getMonthlyPunches(req.query.month, req.query.employeeId)
    });
  });

    app.post('/api/punches/correction', writeLimiter, function (req, res) {
    const punch = addCorrectedPunch(req.body.employeeId, req.body.action, req.body.punchedAt);

    broadcastDataChanged('punches-corrected', {
      employeeId: punch.employeeId
    });

    res.status(201).json({
      punch: punch,
      stats: getStats()
    });
  });

  app.patch('/api/punches/:id', writeLimiter, function (req, res) {
    const punch = updatePunch(req.params.id, req.body.action, req.body.punchedAt);

    broadcastDataChanged('punches-corrected', {
      employeeId: punch.employeeId
    });

    res.json({
      punch: punch,
      stats: getStats()
    });
  });

  app.delete('/api/punches/:id', writeLimiter, function (req, res) {
    const punch = deletePunch(req.params.id);

    broadcastDataChanged('punches-corrected', {
      employeeId: punch.employeeId
    });

    res.json({
      ok: true,
      punch: punch,
      stats: getStats()
    });
  });

  app.get('/api/dtr/monthly', function (req, res) {
    res.json({
      month: cleanText(req.query.month),
      records: groupMonthlyPunchesByEmployee(req.query.month)
    });
  });

    app.get('/api/dtr/blank-template', function (req, res) {
    res.download(TEMPLATE_PATH, 'Blank_DTR_Template.xlsx');
  });

  app.get('/api/dtr/export', async function (req, res, next) {
    try {
      const month = cleanText(req.query.month);
      const employeeId = cleanText(req.query.employeeId).toUpperCase();

      if (!isValidMonth(month)) {
        const err = new Error('Month must use YYYY-MM format.');
        err.statusCode = 400;
        throw err;
      }

      const employee = getEmployeeById(employeeId);
      if (!employee) {
        const err = new Error('Employee not found.');
        err.statusCode = 404;
        throw err;
      }

      const punches = getMonthlyPunches(month, employeeId);
      const workbook = await buildSingleDtrWorkbook(employee, month, punches);

      await sendWorkbook(res, workbook, employeeId + '_DTR_' + month + '.xlsx');
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/dtr/export-all', async function (req, res, next) {
    try {
      const month = cleanText(req.query.month);

      if (!isValidMonth(month)) {
        const err = new Error('Month must use YYYY-MM format.');
        err.statusCode = 400;
        throw err;
      }

      await sendAllEmployeesDtrZip(res, month);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/backup.zip', async function (req, res, next) {
    try {
      await sendBackupZip(res);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/reset-dtr', writeLimiter, function (req, res) {
    requireAdminPassword(req.body);

    clearDtrRecords();

    broadcastDataChanged('reset-dtr', {});

    res.json({
      ok: true,
      employees: getEmployees(),
      stats: getStats()
    });
  });

  app.post('/api/reset-all', writeLimiter, function (req, res) {
    requireAdminPassword(req.body);

    clearAllRecords();

    broadcastDataChanged('reset-all', {});

    res.json({
      ok: true,
      employees: getEmployees(),
      stats: getStats()
    });
  });

  app.get('/vendor/jsQR.js', function (req, res) {
    res.sendFile(path.join(__dirname, '..', 'node_modules', 'jsqr', 'dist', 'jsQR.js'));
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
      error: statusCode >= 500 ? 'Server error.' : (err.message || 'Request failed.')
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
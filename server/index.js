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

function createApp() {
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', function (req, res) {
    res.json({
      ok: true,
      app: 'DTR Manager',
      database: DB_PATH
    });
  });

  app.get('/api/employees', function (req, res) {
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

    res.json({
      employees: rows.map(function (row) {
        return {
          ...row,
          disabled: Boolean(row.disabled)
        };
      })
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
    console.error(err);

    res.status(500).json({
      error: 'Server error.'
    });
  });

  return app;
}

function start(portValue) {
  const port = normalizePort(portValue);

  return new Promise(function (resolve, reject) {
    const app = createApp();
    const httpServer = http.createServer(app);
    const io = new Server(httpServer);

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
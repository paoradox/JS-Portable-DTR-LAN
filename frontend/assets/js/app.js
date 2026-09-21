/* =========================================================
   DTR Manager — bundled application JavaScript
   - Camera + QR scanning (jsQR)
   - Clock In / Clock Out flow with countdown and scan loop
   - Disabled employees are rejected at scan time
   - Punch log in localStorage → powers the "On-Site" statistic
   - Admin auth (setup / login), session ends on back navigation
   - Reset Password modal
   - Password-protected Backup & Reset modal
   - Live ID preview, employee CRUD, printing, CSV backup
   - DTR template: centered company header, two-line certification,
     Employee / In Charge signature labels
   ========================================================= */
(function () {
  'use strict';

  /* ---------- Constants ---------- */
  var STORAGE_KEYS = {
    adminAccount: 'dtr.admin.account',
    adminSession: 'dtr.admin.session',
    reminder:     'dtr.reminder.text',
    punches:      'dtr.punches',
    disabledIds:  'dtr.disabledIds'
  };

  var DEFAULT_REMINDER =
    'Remember to select the correct clock action (Clock In or Clock Out) ' +
    'before logging your attendance. Verify that the camera preview shows ' +
    'your QR code clearly.';

  /* ---------- Utils ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

  function formatMonthLabel(yyyymm) {
    if (!yyyymm || yyyymm.indexOf('-') === -1) return '';
    var parts = yyyymm.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (!y || !m || m < 1 || m > 12) return '';
    return MONTH_NAMES[m - 1] + ' ' + y;
  }

  function datestamp() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ---------- Password hashing ---------- */
  function randomSalt() {
    var arr = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    var s = '';
    for (var i = 0; i < arr.length; i++) s += ('0' + arr[i].toString(16)).slice(-2);
    return s;
  }

  function sha256Hex(text) {
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.reject(new Error('Web Crypto is not available in this browser.'));
    }
    var enc = new TextEncoder().encode(text);
    return window.crypto.subtle.digest('SHA-256', enc).then(function (buf) {
      var bytes = new Uint8Array(buf);
      var out = '';
      for (var i = 0; i < bytes.length; i++) out += ('0' + bytes[i].toString(16)).slice(-2);
      return out;
    });
  }

  function hashPassword(password, salt) {
    return sha256Hex(salt + '::' + password);
  }

  /* ---------- Local + API-backed state helpers ---------- */
  var appState = {
    apiReady: !!window.dtrApi,
    bootstrapLoaded: false,
    bootstrapPromise: null,
    adminAccount: null,
    reminder: null,
    employees: [],
    stats: null
  };

  function readJson(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function readSession(key, fallback) {
    try {
      var raw = window.sessionStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function writeSession(key, value) {
    try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function clearSession(key) {
    try { window.sessionStorage.removeItem(key); } catch (e) {}
  }

  function normalizeEmployee(emp) {
    emp = emp || {};

    return {
      id: String(emp.id || '').toUpperCase(),
      firstName: String(emp.firstName || '').toUpperCase(),
      middleInitial: String(emp.middleInitial || '').toUpperCase(),
      lastName: String(emp.lastName || '').toUpperCase(),
      position: String(emp.position || '').toUpperCase(),
      department: String(emp.department || '').toUpperCase(),
      notes: String(emp.notes || '').toUpperCase(),
      ecName: String(emp.ecName || '').toUpperCase(),
      ecPhone: String(emp.ecPhone || ''),
      photo: String(emp.photo || ''),
      disabled: !!emp.disabled,
      createdAt: emp.createdAt || '',
      updatedAt: emp.updatedAt || ''
    };
  }

  function setEmployees(list) {
    appState.employees = Array.isArray(list) ? list.map(normalizeEmployee) : [];
    syncDisabledIdsFromEmployees(appState.employees);
  }

  function setStats(stats) {
    appState.stats = stats || null;
  }

  function syncDisabledIdsFromEmployees(list) {
    var ids = (list || [])
      .filter(function (e) { return !!e.disabled; })
      .map(function (e) { return (e.id || '').toUpperCase(); });

    writeJson(STORAGE_KEYS.disabledIds, ids);
  }

  function loadBootstrapData() {
    if (appState.bootstrapPromise) return appState.bootstrapPromise;

    if (!window.dtrApi) {
      appState.bootstrapLoaded = true;
      appState.bootstrapPromise = Promise.resolve(appState);
      return appState.bootstrapPromise;
    }

    appState.bootstrapPromise = window.dtrApi.getBootstrap()
      .then(function (data) {
        setEmployees(data && data.employees ? data.employees : []);
        setStats(data && data.stats ? data.stats : null);
        appState.reminder = data ? data.reminder : null;
        appState.adminAccount = data ? data.adminAccount : null;
        appState.bootstrapLoaded = true;
        return appState;
      })
      .catch(function (err) {
        console.error(err);
        appState.bootstrapLoaded = true;
        return appState;
      });

    return appState.bootstrapPromise;
  }

  function refreshBootstrapData() {
    appState.bootstrapPromise = null;
    return loadBootstrapData();
  }

  function getAdminAccount() {
    return appState.apiReady
      ? appState.adminAccount
      : readJson(STORAGE_KEYS.adminAccount, null);
  }

  function setAdminAccount(account) {
    appState.adminAccount = account;

    if (!appState.apiReady) {
      writeJson(STORAGE_KEYS.adminAccount, account);
      return Promise.resolve(account);
    }

    return window.dtrApi.saveAdminAccount(account).then(function (data) {
      appState.adminAccount = data && data.account ? data.account : account;
      return appState.adminAccount;
    });
  }

  function getAdminSession() {
    return readSession(STORAGE_KEYS.adminSession, null);
  }

  function setAdminSession(session) {
    writeSession(STORAGE_KEYS.adminSession, session);
  }

  function clearAdminSession() {
    clearSession(STORAGE_KEYS.adminSession);
  }

  function getReminderText() {
    if (appState.apiReady && appState.reminder) {
      return appState.reminder;
    }

    var t = window.localStorage.getItem(STORAGE_KEYS.reminder);
    return (t && t.trim()) ? t : DEFAULT_REMINDER;
  }

  function setReminderText(text) {
    var value = (text && text.trim()) ? text.trim() : DEFAULT_REMINDER;
    appState.reminder = value;

    if (!appState.apiReady) {
      try { window.localStorage.setItem(STORAGE_KEYS.reminder, value); } catch (e) {}
      return Promise.resolve(value);
    }

    return window.dtrApi.setSetting('reminder', value).then(function (data) {
      appState.reminder = data && data.value ? data.value : value;
      return appState.reminder;
    });
  }

  /* ---------- Punch log ---------- */
  function recordPunch(employeeId, action) {
    if (!employeeId || !action) return Promise.resolve(null);

    if (!appState.apiReady) {
      var all = readJson(STORAGE_KEYS.punches, {});
      var key = datestamp();
      if (!all[key] || !Array.isArray(all[key])) all[key] = [];
      all[key].push({ id: employeeId, action: action, at: Date.now() });
      writeJson(STORAGE_KEYS.punches, all);
      return Promise.resolve(null);
    }

    return window.dtrApi.recordPunch(employeeId, action).then(function (data) {
      if (data && data.stats) setStats(data.stats);
      return data;
    });
  }

  function getTodayPunches() {
    var all = readJson(STORAGE_KEYS.punches, {});
    var key = datestamp();
    return (all[key] && Array.isArray(all[key])) ? all[key] : [];
  }

  /* Counts employees whose latest action today is Clock In.
     `disabledIds` is an optional map { "EMP-0001": true } used to
     exclude disabled employees from the count. */
  function countOnSiteToday(disabledIds) {
    if (appState.apiReady && appState.stats) {
      return appState.stats.onSite || 0;
    }

    var punches = getTodayPunches();
    var latest = {};
    punches.forEach(function (p) {
      if (p && p.id) latest[p.id] = p.action;
    });
    var blocked = disabledIds || {};
    var count = 0;
    Object.keys(latest).forEach(function (id) {
      if (latest[id] === 'Clock In' && !blocked[id]) count++;
    });
    return count;
  }

  /* Returns true when the given employee ID is currently disabled. */
  function isEmployeeDisabled(id) {
    if (!id) return false;

    var employeeId = String(id).toUpperCase();

    if (appState.apiReady && appState.employees.length) {
      var employee = appState.employees.find(function (e) {
        return e.id === employeeId;
      });

      return !!(employee && employee.disabled);
    }

    var list = readJson(STORAGE_KEYS.disabledIds, []);
    if (!Array.isArray(list)) return false;
    return list.indexOf(employeeId) > -1;
  }

  /* ---------- Clock ---------- */
  function updateTime() {
    var el = document.getElementById('time');
    if (!el) return;
    var d = new Date();
    var h = d.getHours();
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    el.textContent =
      pad(h12) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + ampm;
    el.setAttribute('datetime', d.toISOString());
  }
  function updateDate() {
    var el = document.getElementById('date');
    if (!el) return;
    var d = new Date();
    el.textContent = d.toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    el.setAttribute('datetime', d.toISOString().slice(0, 10));
  }
  function tick() { updateTime(); updateDate(); }

  /* =========================================================
     REMINDERS MODAL (Home)
     ========================================================= */
  function initRemindersModal() {
    var modalEl = document.getElementById('myModal');
    if (!modalEl) return;
    if (typeof bootstrap === 'undefined' || !bootstrap.Modal) return;

    var body = document.getElementById('reminderBody');
    if (body) {
      var text = getReminderText();
      body.innerHTML = escapeHtml(text).replace(/\r?\n/g, '<br>');
    }

    try { new bootstrap.Modal(modalEl).show(); } catch (e) { /* ignore */ }
  }

  /* =========================================================
     CAMERA (Home)
     ========================================================= */
  function initCamera() {
    var video = document.getElementById('camera-js');
    if (!video) return;

    var statusEl = document.getElementById('cameraStatus');
    function setStatus(msg, kind) {
      if (!statusEl) return;
      statusEl.textContent = msg || '';
      statusEl.className = 'camera-status' + (kind ? ' is-' + kind : '');
      statusEl.hidden = !msg;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Camera API is not available in this browser.', 'error');
      return;
    }

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    }).then(function (stream) {
      video.srcObject = stream;
      video.play().catch(function () { /* autoplay may be blocked until gesture */ });
      setStatus('', '');
    }).catch(function (err) {
      var msg = 'Camera unavailable';
      if (err && err.name === 'NotAllowedError')      msg = 'Camera permission was denied.';
      else if (err && err.name === 'NotFoundError')   msg = 'No camera found on this device.';
      else if (err && err.name === 'NotReadableError')msg = 'Camera is in use by another application.';
      setStatus(msg, 'error');
    });
  }

  /* =========================================================
     CLOCK ACTION MODAL + QR SCAN LOOP
     ========================================================= */
  function initClockActionModal() {
    var modalEl = document.getElementById('clockActionModal');
    if (!modalEl) return;
    if (typeof bootstrap === 'undefined' || !bootstrap.Modal) return;

    var statusEl  = document.getElementById('clockActionStatus');
    var okayBtn   = document.getElementById('clockActionOkay');
    var video     = document.getElementById('camera-js');
    var scanCanvas= document.getElementById('qrScanCanvas');
    var scanHint  = document.getElementById('scanHint');
    var radios    = modalEl.querySelectorAll('input[name="clockAction"]');

    var countdownTimer = null;
    var scanRAF        = null;
    var scanLoopTimer  = null;
    var currentAction  = '';
    var scanActive     = false;

    var READY_WAIT_MS  = 10000;
    var RETRY_WAIT_MS  = 3000;
    var FAILED_WAIT_MS = 2500;

    function getSelectedValue() {
      for (var i = 0; i < radios.length; i++) {
        if (radios[i].checked) return radios[i].value;
      }
      return '';
    }

    function stopScanLoop() {
      scanActive = false;
      if (scanLoopTimer) { clearTimeout(scanLoopTimer); scanLoopTimer = null; }
      if (scanRAF && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(scanRAF);
        scanRAF = null;
      }
      currentAction = '';
      if (scanHint) scanHint.hidden = true;
      var camWrap = document.querySelector('.camera-wrap');
      if (camWrap) camWrap.classList.remove('is-ready');
    }

    function showReadyMessage() {
      if (!scanHint || !currentAction) return;
      scanHint.hidden = false;
      scanHint.classList.remove('is-retry');
      scanHint.innerHTML = '<i class="fa-solid fa-qrcode me-2"></i>' +
        'Ready to ' + currentAction + ' — show your QR code to the camera.';

      var camWrap = document.querySelector('.camera-wrap');
      if (camWrap) {
        camWrap.classList.remove('is-ready');
        void camWrap.offsetWidth;
        camWrap.classList.add('is-ready');
      }

      if (scanActive) {
        scanLoopTimer = setTimeout(showRetryMessage, READY_WAIT_MS);
      }
    }

    function showRetryMessage() {
      if (!scanHint || !currentAction || !scanActive) return;
      scanHint.hidden = false;
      scanHint.classList.add('is-retry');
      scanHint.innerHTML = '<i class="fa-solid fa-triangle-exclamation me-2"></i>' +
        'Try again — No QR code detected.';

      var camWrap = document.querySelector('.camera-wrap');
      if (camWrap) camWrap.classList.remove('is-ready');

      scanLoopTimer = setTimeout(showReadyMessage, RETRY_WAIT_MS);
    }

    /* Shown when a scanned QR belongs to a disabled employee.
       Does NOT stop the scan loop — a different employee can scan next. */
    function showFailed() {
      if (!scanHint || !currentAction) return;

      if (scanLoopTimer) { clearTimeout(scanLoopTimer); scanLoopTimer = null; }

      scanHint.hidden = false;
      scanHint.classList.add('is-retry');
      scanHint.innerHTML = '<i class="fa-solid fa-triangle-exclamation me-2"></i>' +
        'Invalid — QR code disabled.';

      var camWrap = document.querySelector('.camera-wrap');
      if (camWrap) camWrap.classList.remove('is-ready');

      if (scanActive) {
        scanLoopTimer = setTimeout(showReadyMessage, FAILED_WAIT_MS);
      }
    }

    function startScanLoop(action) {
      stopScanLoop();
      currentAction = action;
      scanActive = true;
      showReadyMessage();
      startDecoding();
    }

    function startDecoding() {
      if (!video || !scanCanvas) return;
      if (typeof window.jsQR !== 'function') return;
      var ctx = scanCanvas.getContext('2d');

      function step() {
        if (!scanActive) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          var w = video.videoWidth;
          var h = video.videoHeight;
          if (w && h) {
            if (scanCanvas.width !== w)  scanCanvas.width  = w;
            if (scanCanvas.height !== h) scanCanvas.height = h;
            ctx.drawImage(video, 0, 0, w, h);
            var imgData = ctx.getImageData(0, 0, w, h);
            var code = window.jsQR(imgData.data, w, h, { inversionAttempts: 'dontInvert' });
            if (code && code.data) {
              handleQrDetected(code.data);
              return;
            }
          }
        }
        scanRAF = window.requestAnimationFrame(step);
      }
      scanRAF = window.requestAnimationFrame(step);
    }

    function handleQrDetected(rawText) {
      var payload;
      try {
        payload = JSON.parse(rawText);
      } catch (e) {
        // Non-JSON QR codes are ignored; keep scanning.
        return;
      }
      if (!payload || !payload.id) return;

      // Reject disabled employees — no punch, no count, no stop.
      if (isEmployeeDisabled(payload.id)) {
        showFailed();
        return;
      }

      // Record the punch BEFORE stopping the loop
      var actionForMessage = currentAction;

      recordPunch(payload.id, currentAction)
        .then(function () {
          stopScanLoop();

          if (scanHint) {
            scanHint.hidden = false;
            scanHint.classList.remove('is-retry');
            scanHint.innerHTML = '<i class="fa-solid fa-circle-check me-2"></i>' +
              actionForMessage + ' recorded for ' +
              escapeHtml(payload.fullName || payload.id) + '.';
            setTimeout(function () {
              if (scanHint) scanHint.hidden = true;
            }, 4000);
          }
        })
        .catch(function (err) {
          if (scanHint) {
            scanHint.hidden = false;
            scanHint.classList.add('is-retry');
            scanHint.innerHTML = '<i class="fa-solid fa-triangle-exclamation me-2"></i>' +
              escapeHtml(err && err.message ? err.message : 'Could not record attendance.');
          }

          startDecoding();
        });
    }

    function resetState() {
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
      for (var i = 0; i < radios.length; i++) radios[i].checked = false;
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.classList.remove('is-warn', 'is-success');
      }
      if (okayBtn) okayBtn.disabled = false;
    }

    modalEl.addEventListener('shown.bs.modal', function () {
      stopScanLoop();
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.classList.remove('is-warn', 'is-success');
      }
    });

    modalEl.addEventListener('hidden.bs.modal', resetState);

    if (okayBtn) {
      okayBtn.addEventListener('click', function () {
        var selected = getSelectedValue();

        if (!selected) {
          if (statusEl) {
            statusEl.textContent = 'Please select Clock In or Clock Out.';
            statusEl.classList.remove('is-success');
            statusEl.classList.add('is-warn');
          }
          return;
        }

        var remaining = 3;
        if (statusEl) {
          statusEl.classList.remove('is-warn');
          statusEl.classList.add('is-success');
          statusEl.textContent = 'Selected: ' + selected +
            ' — closing in ' + remaining + ' seconds...';
        }
        if (okayBtn) okayBtn.disabled = true;

        countdownTimer = setInterval(function () {
          remaining--;
          if (remaining > 0) {
            if (statusEl) {
              statusEl.textContent = 'Selected: ' + selected +
                ' — closing in ' + remaining +
                (remaining === 1 ? ' second...' : ' seconds...');
            }
          } else {
            clearInterval(countdownTimer);
            countdownTimer = null;
            var action = selected;
            var instance = bootstrap.Modal.getInstance(modalEl);
            if (instance) instance.hide();
            startScanLoop(action);
          }
        }, 1000);
      });
    }
  }

  /* =========================================================
     AUTH — Admin page
     ========================================================= */
  function initAdminAuth() {
    var modalEl = document.getElementById('authModal');
    if (!modalEl) return;
    if (typeof bootstrap === 'undefined' || !bootstrap.Modal) return;

    var titleEl      = document.getElementById('authTitleText');
    var subtitleEl   = document.getElementById('authSubtitle');
    var usernameEl   = document.getElementById('authUsername');
    var passwordEl   = document.getElementById('authPassword');
    var confirmEl    = document.getElementById('authConfirm');
    var setupBlock   = modalEl.querySelector('.auth-setup-only');
    var submitTextEl = document.getElementById('authSubmitText');
    var noticeEl     = document.getElementById('authNotice');
    var formEl       = document.getElementById('authForm');

    var bsModal = bootstrap.Modal.getOrCreateInstance(modalEl, {
      backdrop: 'static',
      keyboard: false
    });

    var mode = 'login';

    function showNotice(msg, kind) {
      if (!noticeEl) return;
      noticeEl.textContent = msg || '';
      noticeEl.className = 'auth-notice' + (kind ? ' is-' + kind : '');
    }

    function applyMode() {
      var account = getAdminAccount();
      mode = account ? 'login' : 'setup';

      if (mode === 'setup') {
        if (titleEl) titleEl.textContent = 'Create Admin Account';
        if (subtitleEl) subtitleEl.textContent =
          'No administrator account exists yet. Create one to continue.';
        if (setupBlock) setupBlock.hidden = false;
        if (submitTextEl) submitTextEl.textContent = 'Create account';
        if (confirmEl) confirmEl.value = '';
      } else {
        if (titleEl) titleEl.textContent = 'Admin Login';
        if (subtitleEl) subtitleEl.textContent =
          'Enter your administrator credentials to continue.';
        if (setupBlock) setupBlock.hidden = true;
        if (submitTextEl) submitTextEl.textContent = 'Login';
      }
      showNotice('', '');
      if (passwordEl) passwordEl.value = '';
      if (usernameEl && mode === 'login') usernameEl.value = '';
      setTimeout(function () {
        if (usernameEl) usernameEl.focus();
      }, 300);
    }

    function revealAdmin() {
      document.body.classList.remove('auth-pending');
      try { bsModal.hide(); } catch (e) {}
    }

    var existing = getAdminSession();
    if (existing && existing.username) {
      revealAdmin();
    } else {
      applyMode();
      bsModal.show();
    }

    if (formEl) {
      formEl.addEventListener('submit', function (e) {
        e.preventDefault();
        showNotice('', '');

        var username = (usernameEl && usernameEl.value || '').trim();
        var password = (passwordEl && passwordEl.value || '');
        var confirm  = (confirmEl  && confirmEl.value  || '');

        if (!username) { showNotice('Username is required.', 'error'); return; }
        if (!password) { showNotice('Password is required.', 'error'); return; }

        if (mode === 'setup') {
          if (password.length < 6) {
            showNotice('Password must be at least 6 characters.', 'error');
            return;
          }
          if (password !== confirm) {
            showNotice('Passwords do not match.', 'error');
            return;
          }
          var salt = randomSalt();
          hashPassword(password, salt).then(function (hash) {
            setAdminAccount({ username: username, salt: salt, passwordHash: hash });
            setAdminSession({ username: username, startedAt: Date.now() });
            revealAdmin();
          }).catch(function (err) {
            showNotice(err && err.message ? err.message : 'Could not create the account.', 'error');
          });
          return;
        }

        var account = getAdminAccount();
        if (!account) { applyMode(); return; }
        if (account.username !== username) {
          showNotice('Incorrect username or password.', 'error');
          return;
        }
        hashPassword(password, account.salt).then(function (hash) {
          if (hash !== account.passwordHash) {
            showNotice('Incorrect username or password.', 'error');
            return;
          }
          setAdminSession({ username: username, startedAt: Date.now() });
          revealAdmin();
        }).catch(function (err) {
          showNotice(err && err.message ? err.message : 'Login failed.', 'error');
        });
      });
    }

    /* --- Session ends when the user navigates away --------------- */
    function endSession() {
      clearAdminSession();
    }
    window.addEventListener('pagehide', endSession);
    window.addEventListener('beforeunload', endSession);

    window.addEventListener('pageshow', function () {
      var session = getAdminSession();
      if (!session) {
        document.body.classList.add('auth-pending');
        applyMode();
        try { bsModal.show(); } catch (err) {}
      }
    });
  }

  /* =========================================================
     FILTERS
     ========================================================= */
  var NAME_DISALLOWED_RE = (function () {
    try {
      return new RegExp(
        '[' +
        '\\u0000-\\u001F\\u007F' +
        '0-9' +
        '!@#$%^&*()_+=\\[\\]{};:"\\\\|<>,?\\/~`' +
        ']',
        'g'
      );
    } catch (e) { return /[0-9]/g; }
  })();

  var PHONE_DISALLOWED_RE = /[^0-9+()\-\/]/g;

  function attachUppercase(el) {
    if (!el || el.dataset.ucAttached === '1') return;
    el.dataset.ucAttached = '1';
    el.addEventListener('input', function () {
      var upper = el.value.toUpperCase();
      if (upper !== el.value) el.value = upper;
    });
  }

  function attachNameFilter(el) {
    if (!el || el.dataset.nameAttached === '1') return;
    el.dataset.nameAttached = '1';
    attachUppercase(el);
    el.addEventListener('input', function () {
      var upper = el.value.toUpperCase();
      var filtered = upper.replace(NAME_DISALLOWED_RE, '');
      if (filtered !== el.value) {
        var pos = el.selectionStart;
        var delta = el.value.length - filtered.length;
        el.value = filtered;
        try { el.setSelectionRange(Math.max(0, pos - delta), Math.max(0, pos - delta)); }
        catch (e) { /* ignored */ }
      }
    });
    el.addEventListener('blur', function () {
      el.value = el.value.replace(/\s+/g, ' ').trim();
    });
  }

  function attachPhoneFilter(el) {
    if (!el || el.dataset.phoneAttached === '1') return;
    el.dataset.phoneAttached = '1';
    el.addEventListener('input', function () {
      var filtered = el.value.replace(PHONE_DISALLOWED_RE, '');
      if (filtered !== el.value) {
        var pos = el.selectionStart;
        var delta = el.value.length - filtered.length;
        el.value = filtered;
        try { el.setSelectionRange(Math.max(0, pos - delta), Math.max(0, pos - delta)); }
        catch (e) { /* ignored */ }
      }
    });
  }

  function isValidRequiredName(value) {
    return (value || '').trim().length > 0;
  }
  function isValidOptionalName(value, minLen) {
    var v = (value || '').trim();
    if (!v) return true;
    if (minLen && v.length < minLen) return false;
    return true;
  }

  /* =========================================================
     ID CARD RENDERING
     ========================================================= */
  function computeDisplayName(d) {
    var mi = (d.middleInitial || '').trim().replace(/\.+$/, '');
    var first = (d.firstName || '').trim();
    var last  = (d.lastName  || '').trim();
    var secondLine = first + (mi ? ' ' + mi + '.' : '');
    return { last: last, rest: secondLine.trim() };
  }

  function fullName(d) {
    var mi = (d.middleInitial || '').trim().replace(/\.+$/, '');
    return [d.firstName, mi ? mi + '.' : '', d.lastName]
      .filter(function (x) { return x && x.trim(); })
      .join(' ')
      .trim();
  }

  function renderIdCard(d) {
    var nameEl = document.getElementById('pvName');
    if (nameEl) {
      var n = computeDisplayName(d);
      nameEl.innerHTML =
        '<span class="name-last">'  + escapeHtml(n.last || '—') + '</span>' +
        '<span class="name-first">' + escapeHtml(n.rest || '')   + '</span>';
    }

    var posEl = document.getElementById('pvPosition');
    if (posEl) posEl.textContent = d.position || '—';

    var idEl = document.getElementById('pvId');
    if (idEl) idEl.textContent = d.id || '—';

    var deptEl = document.getElementById('pvDept');
    if (deptEl) deptEl.textContent = d.department || '—';

    var ecEl   = document.getElementById('pvEmergency');
    var ecName = document.getElementById('pvEcName');
    var ecPh   = document.getElementById('pvEcPhone');
    if (ecEl && ecName && ecPh) {
      if (d.ecName || d.ecPhone) {
        ecName.textContent = d.ecName  || '—';
        ecPh.textContent   = d.ecPhone || '—';
        ecEl.hidden = false;
      } else {
        ecName.textContent = '—';
        ecPh.textContent   = '—';
        ecEl.hidden = true;
      }
    }

    var photoEl = document.getElementById('pvPhoto');
    if (photoEl) {
      if (d.photo) photoEl.innerHTML = '<img src="' + d.photo + '" alt="Employee photo" />';
      else photoEl.innerHTML = '<span>Photo</span>';
    }
  }

  /* ---------- QR ---------- */
  var QR_PLACEHOLDER = '<span class="placeholder">QR code will appear here once you generate an ID.</span>';

  function renderQr(holder, payloadText) {
    if (!holder) return;
    if (typeof QRCode === 'undefined') {
      holder.innerHTML = '<span class="placeholder">QR library failed to load.</span>';
      return;
    }
    holder.innerHTML = '';
    new QRCode(holder, {
      text: payloadText,
      width: 256,
      height: 256,
      colorDark: '#1c1b1f',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  /* ---------- Print helpers ---------- */
  function printQrOnly() {
    var holder = document.getElementById('qrContainer');
    if (!holder) return;
    var canvas = holder.querySelector('canvas');
    var img = holder.querySelector('img');
    var dataUrl = '';
    if (canvas) dataUrl = canvas.toDataURL('image/png');
    else if (img) dataUrl = img.src;
    if (!dataUrl) {
      window.alert('Generate an ID first to print its QR code.');
      return;
    }
    var w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print QR</title>' +
      '<style>@page{margin:10mm}html,body{margin:0;padding:0;height:100%}' +
      'body{display:flex;align-items:center;justify-content:center}' +
      'img{width:80mm;height:80mm;image-rendering:pixelated}</style>' +
      '</head><body><img src="' + dataUrl + '" alt="QR code"></body></html>'
    );
    w.document.close();
    w.focus();
    setTimeout(function () { try { w.print(); } catch (e) {} }, 250);
  }

  /* ---------- DTR print helpers ---------- */
  function buildDtrHtml(emp, monthValue) {
    var companyName = ((document.getElementById('companyName') || {}).value || '').trim() || 'DTR Manager';
    var monthLabel = formatMonthLabel(monthValue);

    var empName  = emp ? fullName(emp) : '';
    var empPos   = emp ? (emp.position || '') : '';
    var empDept  = emp ? (emp.department || '') : '';
    var empIdTxt = emp ? (emp.id || '') : '';

    var rows = '';
    for (var i = 1; i <= 31; i++) {
      rows +=
        '<tr>' +
        '<td class="c-date">' + i + '</td>' +
        '<td></td><td></td><td></td><td></td>' +
        '<td></td><td></td>' +
        '</tr>';
    }

    var empDetailsBlock = '';
    if (emp) {
      empDetailsBlock =
        '<div class="emp-line"><strong>' + escapeHtml(empName || '—') + '</strong></div>' +
        '<div class="emp-line">' + escapeHtml(empPos || '—') + (empDept ? ' — ' + escapeHtml(empDept) : '') + '</div>' +
        (empIdTxt ? '<div class="emp-line">ID: ' + escapeHtml(empIdTxt) + '</div>' : '');
    } else {
      empDetailsBlock =
        '<div class="emp-line"><strong>Employee Name</strong></div>' +
        '<div class="emp-line">Position — Department</div>' +
        '<div class="emp-line">ID: </div>';
    }

    return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>DTR</title>' +
      '<style>' +
      '@page{size:A4 portrait;margin:10mm 12mm}' +
      'html,body{margin:0;padding:0;font-family:"Roboto",Arial,sans-serif;color:#1c1b1f;font-size:10px}' +
      '.wrap{max-width:100%;}' +
      '.company-centered{text-align:center;font-size:13px;font-weight:700;margin-bottom:10px;letter-spacing:.02em}' +
      '.hdr-left{text-align:left;line-height:1.3;margin-bottom:8px}' +
      '.emp-line{font-size:10px;line-height:1.3}' +
      '.month-line{margin:8px 0 5px;font-size:10.5px}' +
      'table{width:100%;border-collapse:collapse;margin:0 auto;table-layout:fixed}' +
      'th,td{border:1px solid #333;padding:1px 2px;text-align:center;font-size:9px;line-height:1.05;height:13px;overflow:hidden;word-wrap:break-word}' +
      'th{background:#f0f0f0;font-weight:600;font-size:8.5px;line-height:1.1;height:auto;padding:2px 1px}' +
      '.c-date{width:6%}' +
      '.c-time{width:14%}' +
      '.c-ut{width:16%}' +
      '.footer{margin:10px auto 0;max-width:160mm;font-style:italic;text-align:center;font-size:9.5px;line-height:1.45}' +
      '.sig{text-align:center;margin-top:16px}' +
      '.sig .line{display:block;width:280px;margin:0 auto;border-bottom:1px solid #333;height:22px}' +
      '.employee{margin-top:2px;text-align:center;font-size:10px}' +
      '.verified{margin-top:16px;text-align:left;font-style:normal;font-size:10px}' +
      '.verified-sig{text-align:center;margin-top:16px}' +
      '.verified-sig .line{display:block;width:280px;margin:0 auto;border-bottom:1px solid #333;height:22px}' +
      '.incharge{margin-top:2px;text-align:center;font-size:10px}' +
      '</style></head><body><div class="wrap">' +

      '<div class="company-centered">' + escapeHtml(companyName) + '</div>' +

      '<div class="hdr-left">' +
        empDetailsBlock +
        '<div class="month-line">For the month of ' +
          (monthLabel
            ? '<span style="font-weight:600">' + escapeHtml(monthLabel) + '</span>'
            : '<span style="display:inline-block;min-width:220px;border-bottom:1px solid #333">&nbsp;</span>') +
        '</div>' +
      '</div>' +

      '<table>' +
        '<colgroup>' +
          '<col class="c-date">' +
          '<col class="c-time"><col class="c-time">' +
          '<col class="c-time"><col class="c-time">' +
          '<col class="c-ut"><col class="c-ut">' +
        '</colgroup>' +
        '<thead><tr>' +
          '<th>Date</th>' +
          '<th>Arrival</th>' +
          '<th>Departure</th>' +
          '<th>Arrival</th>' +
          '<th>Departure</th>' +
          '<th>Undertime<br>Hours</th>' +
          '<th>Undertime<br>Minutes</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +

      '<div class="footer">' +
        'I certify on my honor that the above is a true and correct report of the hours of work performed,<br>' +
        'record of which was made daily at the time of arrival and departure from office.' +
      '</div>' +

      '<div class="sig"><span class="line"></span></div>' +
      '<div class="employee">Employee</div>' +

      '<div class="verified">VERIFIED as the prescribed office hours:</div>' +

      '<div class="verified-sig"><span class="line"></span></div>' +
      '<div class="incharge">In Charge</div>' +

      '</div></body></html>';
  }

  function openDtrPrint(emp, monthValue) {
    var w = window.open('', '_blank');
    if (!w) {
      window.alert('Please allow pop-ups to print the DTR.');
      return;
    }
    var html = buildDtrHtml(emp, monthValue);
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(function () { try { w.print(); } catch (e) { /* ignore */ } }, 350);
  }

  /* =========================================================
     CSV BACKUP
     ========================================================= */
  function csvCell(v) {
    if (v == null) return '';
    var s = String(v);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function downloadCsv(filename, csvText) {
    var blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function buildEmployeesCsv(employees) {
    var headers = [
      'Employee ID','First Name','Middle Initial','Last Name','Full Name',
      'Position','Department','QR Notes',
      'Emergency Contact Name','Emergency Contact Phone',
      'Status','Has Photo'
    ];
    var lines = [headers.map(csvCell).join(',')];
    employees.forEach(function (e) {
      lines.push([
        e.id || '',
        e.firstName || '',
        e.middleInitial || '',
        e.lastName || '',
        fullName(e),
        e.position || '',
        e.department || '',
        e.notes || '',
        e.ecName || '',
        e.ecPhone || '',
        e.disabled ? 'Disabled' : 'Active',
        e.photo ? 'Yes' : 'No'
      ].map(csvCell).join(','));
    });
    return lines.join('\r\n');
  }

  /* =========================================================
     ADMIN PANEL
     ========================================================= */
    function initAdmin() {
    var form = document.getElementById('idForm');
    if (!form) return;

    var qrHolder        = document.getElementById('qrContainer');
    var qrPreviewHolder = document.getElementById('qrPreviewContainer');
    var tableBody       = document.getElementById('idTableBody');
    var searchInput     = document.getElementById('idSearch');
    var employees       = appState.employees.slice();
    var currentPage     = 1;
    var pageSize        = 50;
    var editingEmployeeId = '';

    function applyEmployees(nextEmployees) {
      employees = Array.isArray(nextEmployees) ? nextEmployees.map(normalizeEmployee) : [];
      setEmployees(employees);
      renderTable();
      updateStats();
    }

    function showAdminError(message) {
      window.alert(message || 'The admin action failed.');
    }

    /* ---------- Company details ---------- */
    var companyNameInput = document.getElementById('companyName');
    var companyLogoInput = document.getElementById('companyLogo');
    var companyNameEl    = document.getElementById('idCompanyName');
    var logoEl           = document.getElementById('idLogo');

    function syncCompanyName() {
      var v = (companyNameInput && companyNameInput.value || '').trim();
      var display = v || 'DTR Manager';
      if (companyNameEl) companyNameEl.textContent = display;
      var footer = document.querySelector('.id-card__footer');
      if (footer) footer.textContent = 'Property of ' + display;
    }

    if (companyNameInput) companyNameInput.addEventListener('input', syncCompanyName);
    syncCompanyName();

    if (companyLogoInput) {
      companyLogoInput.addEventListener('change', function () {
        var file = companyLogoInput.files && companyLogoInput.files[0];
        if (!file) return;
        if (!/^image\//i.test(file.type)) {
          window.alert('Please choose an image file.');
          companyLogoInput.value = '';
          return;
        }
        var reader = new FileReader();
        reader.onload = function (ev) { if (logoEl) logoEl.src = ev.target.result; };
        reader.readAsDataURL(file);
      });
    }

    /* ---------- Employee photo upload ---------- */
    var empPhotoInput    = document.getElementById('empPhoto');
    var empPhotoPreview  = document.getElementById('empPhotoPreview');
    var currentPhotoData = '';

    function resizeEmployeePhoto(file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();

        reader.onload = function (readerEvent) {
          var img = new Image();

          img.onload = function () {
            var size = 360;
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');

            canvas.width = size;
            canvas.height = size;

            var sourceSize = Math.min(img.width, img.height);
            var sourceX = Math.floor((img.width - sourceSize) / 2);
            var sourceY = Math.floor((img.height - sourceSize) / 2);

            ctx.drawImage(
              img,
              sourceX,
              sourceY,
              sourceSize,
              sourceSize,
              0,
              0,
              size,
              size
            );

            resolve(canvas.toDataURL('image/jpeg', 0.82));
          };

          img.onerror = function () {
            reject(new Error('Could not read the selected photo.'));
          };

          img.src = readerEvent.target.result;
        };

        reader.onerror = function () {
          reject(new Error('Could not load the selected photo.'));
        };

        reader.readAsDataURL(file);
      });
    }

    function setEmployeePhoto(dataUrl) {
      currentPhotoData = dataUrl || '';
      if (empPhotoPreview) {
        if (currentPhotoData) {
          empPhotoPreview.innerHTML = '<img src="' + currentPhotoData + '" alt="Employee photo preview" />';
        } else {
          empPhotoPreview.innerHTML = '<span class="photo-upload__placeholder">Photo</span>';
        }
      }
      var photoEl = document.getElementById('pvPhoto');
      if (photoEl) {
        if (currentPhotoData) photoEl.innerHTML = '<img src="' + currentPhotoData + '" alt="Employee photo" />';
        else photoEl.innerHTML = '<span>Photo</span>';
      }
    }

    if (empPhotoInput) {
      empPhotoInput.addEventListener('change', function () {
        var file = empPhotoInput.files && empPhotoInput.files[0];
        if (!file) return;

        if (!/^image\//i.test(file.type)) {
          window.alert('Please choose an image file.');
          empPhotoInput.value = '';
          return;
        }

        resizeEmployeePhoto(file)
          .then(function (dataUrl) {
            setEmployeePhoto(dataUrl);
          })
          .catch(function (err) {
            window.alert(err && err.message ? err.message : 'Could not process the selected photo.');
            empPhotoInput.value = '';
          });
      });
    }

    /* ---------- Field wiring ---------- */
    ['empId', 'empPosition', 'empDept', 'empNotes'].forEach(function (id) {
      attachUppercase(document.getElementById(id));
    });
    form.querySelectorAll('[data-name-field]').forEach(function (el) {
      attachNameFilter(el);
    });
    form.querySelectorAll('[data-phone-field]').forEach(function (el) {
      attachPhoneFilter(el);
    });

    function readForm() {
      var miRaw = ((document.getElementById('empMi') || {}).value || '').trim().replace(/\.+$/, '');
      return {
        id:            ((document.getElementById('empId')       || {}).value || '').trim().toUpperCase(),
        firstName:     ((document.getElementById('empFirst')    || {}).value || '').trim().toUpperCase(),
        middleInitial: miRaw ? miRaw.toUpperCase() : '',
        lastName:      ((document.getElementById('empLast')     || {}).value || '').trim().toUpperCase(),
        position:      ((document.getElementById('empPosition') || {}).value || '').trim().toUpperCase(),
        department:    ((document.getElementById('empDept')     || {}).value || '').trim().toUpperCase(),
        notes:         ((document.getElementById('empNotes')    || {}).value || '').trim().toUpperCase(),
        ecName:        ((document.getElementById('empEcName')   || {}).value || '').trim().toUpperCase(),
        ecPhone:       ((document.getElementById('empEcPhone')  || {}).value || '').trim(),
        photo:         currentPhotoData
      };
    }

    function buildPayload(d) {
      var p = {
        id:            d.id,
        firstName:     d.firstName,
        middleInitial: d.middleInitial || '',
        lastName:      d.lastName,
        fullName:      fullName(d),
        position:      d.position || '',
        department:    d.department || ''
      };
      if (d.notes) p.notes = d.notes;
      if (d.ecName || d.ecPhone) {
        p.emergencyContact = { name: d.ecName || '', phone: d.ecPhone || '' };
      }
      return JSON.stringify(p);
    }

    function refreshPreview() {
      var d = readForm();
      renderIdCard(d);
      if (d.id) {
        var payload = buildPayload(d);
        renderQr(qrHolder, payload);
        renderQr(qrPreviewHolder, payload);
      }
    }

    var PREVIEW_FIELDS = ['empId','empFirst','empMi','empLast','empPosition',
                          'empDept','empNotes','empEcName','empEcPhone'];
    PREVIEW_FIELDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', refreshPreview);
      el.addEventListener('blur', refreshPreview);
      el.addEventListener('change', refreshPreview);
    });

    function setInvalid(id, invalid) {
      var el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('is-invalid', invalid);
    }

    function validate() {
      var ok = true;

      var idEl = document.getElementById('empId');
      if (!idEl.value.trim()) { setInvalid('empId', true); ok = false; }
      else                     { setInvalid('empId', false); }

      var firstEl = document.getElementById('empFirst');
      if (!isValidRequiredName(firstEl.value)) { setInvalid('empFirst', true); ok = false; }
      else                                      { setInvalid('empFirst', false); }

      var lastEl = document.getElementById('empLast');
      if (!isValidRequiredName(lastEl.value)) { setInvalid('empLast', true); ok = false; }
      else                                     { setInvalid('empLast', false); }

      var miEl = document.getElementById('empMi');
      if (!isValidOptionalName(miEl.value, 1)) { setInvalid('empMi', true); ok = false; }
      else                                      { setInvalid('empMi', false); }

      return ok;
    }

    function updateStats() {
      var total = employees.length;
      var disabled = employees.filter(function (e) { return !!e.disabled; }).length;
      var active = total - disabled;

      var s1 = document.getElementById('statEmployees');
      if (s1) s1.textContent = String(total);
      var s2 = document.getElementById('statActiveIds');
      if (s2) s2.textContent = String(active);
      var s3 = document.getElementById('statDisabledIds');
      if (s3) s3.textContent = String(disabled);

      // On-Site — exclude any employee marked as disabled
      var disabledIds = {};
      employees.forEach(function (e) {
        if (e.disabled) disabledIds[e.id] = true;
      });
      var s4 = document.getElementById('statOnSite');
      if (s4) s4.textContent = String(countOnSiteToday(disabledIds));
    }

    function renderTable() {
      if (!tableBody) return;

      var q = (searchInput ? searchInput.value : '').trim().toUpperCase();
      var list = employees;

      if (q) {
        list = employees.filter(function (emp) {
          return (emp.id || '').toUpperCase().indexOf(q) > -1 ||
                 fullName(emp).toUpperCase().indexOf(q) > -1 ||
                 (emp.position || '').toUpperCase().indexOf(q) > -1 ||
                 (emp.department || '').toUpperCase().indexOf(q) > -1;
        });
      }

      var totalPages = Math.max(1, Math.ceil(list.length / pageSize));
      if (currentPage > totalPages) currentPage = totalPages;
      if (currentPage < 1) currentPage = 1;

      var startIndex = (currentPage - 1) * pageSize;
      var pageItems = list.slice(startIndex, startIndex + pageSize);

      if (!list.length) {
        tableBody.innerHTML =
          '<tr><td colspan="5" class="text-center text-muted py-4">' +
          (q ? 'No matching IDs.' : 'No IDs generated yet.') +
          '</td></tr>';
        renderPagination(0, 0, 0);
        return;
      }

      tableBody.innerHTML = '';

      pageItems.forEach(function (emp) {
        var tr = document.createElement('tr');
        if (emp.disabled) tr.classList.add('table-secondary');

        var statusBadge = emp.disabled
          ? '<span class="badge bg-danger">Disabled</span>'
          : '<span class="badge bg-success">Active</span>';

        tr.innerHTML =
          '<td class="text-nowrap">' + escapeHtml(emp.id) + '</td>' +
          '<td>' + escapeHtml(fullName(emp)) + '</td>' +
          '<td>' + escapeHtml(emp.position || '—') + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td class="text-end text-nowrap">' +
            '<button class="btn btn-link btn-sm p-1" data-edit="' + escapeHtml(emp.id) + '"' +
              ' title="Edit" aria-label="Edit ' + escapeHtml(emp.id) + '">' +
              '<i class="fa-solid fa-pen"></i>' +
            '</button>' +
            '<button class="btn btn-link btn-sm p-1 ' + (emp.disabled ? 'text-success' : 'text-warning') + '"' +
              ' data-disable="' + escapeHtml(emp.id) + '"' +
              ' title="' + (emp.disabled ? 'Enable' : 'Disable') + '"' +
              ' aria-label="' + (emp.disabled ? 'Enable' : 'Disable') + ' ' + escapeHtml(emp.id) + '">' +
              '<i class="fa-solid ' + (emp.disabled ? 'fa-circle-check' : 'fa-ban') + '"></i>' +
            '</button>' +
          '</td>';

        tableBody.appendChild(tr);
      });

      renderPagination(list.length, startIndex + 1, startIndex + pageItems.length);
    }

        function renderPagination(totalItems, startItem, endItem) {
      var tableCard = tableBody ? tableBody.closest('.card') : null;
      if (!tableCard) return;

      var pager = document.getElementById('idTablePager');

      if (!pager) {
        pager = document.createElement('div');
        pager.id = 'idTablePager';
        pager.className = 'id-table-pager';
        tableCard.appendChild(pager);
      }

      if (!totalItems || totalItems <= pageSize) {
        pager.innerHTML = totalItems
          ? '<span class="text-muted small">Showing ' + totalItems + ' generated ID' + (totalItems === 1 ? '' : 's') + '.</span>'
          : '';
        return;
      }

      var totalPages = Math.ceil(totalItems / pageSize);

      pager.innerHTML =
        '<div class="id-table-pager__info">Showing ' + startItem + '–' + endItem + ' of ' + totalItems + '</div>' +
        '<div class="id-table-pager__actions">' +
          '<button type="button" class="btn btn-outline-secondary btn-sm" id="idPrevPage" ' + (currentPage <= 1 ? 'disabled' : '') + '>Previous</button>' +
          '<span class="id-table-pager__page">Page ' + currentPage + ' of ' + totalPages + '</span>' +
          '<button type="button" class="btn btn-outline-secondary btn-sm" id="idNextPage" ' + (currentPage >= totalPages ? 'disabled' : '') + '>Next</button>' +
        '</div>';

      var prev = document.getElementById('idPrevPage');
      var next = document.getElementById('idNextPage');

      if (prev) {
        prev.addEventListener('click', function () {
          currentPage--;
          renderTable();
        });
      }

      if (next) {
        next.addEventListener('click', function () {
          currentPage++;
          renderTable();
        });
      }
    }

    ['empFirst', 'empLast', 'empMi', 'empId'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function () {
        if (el.classList.contains('is-invalid')) validate();
      });
    });

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        currentPage = 1;
        renderTable();
      });
    }

    function clearEmployeeForm() {
      form.reset();
      editingEmployeeId = '';

      var idInput = document.getElementById('empId');
      if (idInput) {
        idInput.readOnly = false;
        idInput.classList.remove('is-readonly');
      }

      form.querySelectorAll('.is-invalid').forEach(function (el) {
        el.classList.remove('is-invalid');
      });

      setEmployeePhoto('');
      renderIdCard({});

      if (qrHolder) qrHolder.innerHTML = QR_PLACEHOLDER;
      if (qrPreviewHolder) qrPreviewHolder.innerHTML = QR_PLACEHOLDER;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!validate()) return;

      var d = readForm();
      var existedBefore = employees.some(function (x) { return x.id === d.id; });

      renderIdCard(d);
      var payload = buildPayload(d);
      renderQr(qrHolder, payload);
      renderQr(qrPreviewHolder, payload);

      if (!appState.apiReady) {
        var idx = employees.findIndex(function (x) { return x.id === d.id; });
        if (idx >= 0) {
          var wasDisabled = employees[idx].disabled;
          employees[idx] = d;
          employees[idx].disabled = wasDisabled;
        } else {
          employees.push(d);
        }

        applyEmployees(employees);

        if (!existedBefore) {
          form.reset();
          form.querySelectorAll('.is-invalid').forEach(function (el) { el.classList.remove('is-invalid'); });
          setEmployeePhoto('');
        }

        return;
      }

      var existing = employees.find(function (x) { return x.id === d.id; });
      d.disabled = existing ? !!existing.disabled : false;

      window.dtrApi.saveEmployee(d)
        .then(function (data) {
          if (data && data.stats) setStats(data.stats);
          applyEmployees(data && data.employees ? data.employees : employees);

          if (!existedBefore) {
            form.reset();
            form.querySelectorAll('.is-invalid').forEach(function (el) { el.classList.remove('is-invalid'); });
            setEmployeePhoto('');
          }
        })
        .catch(function (err) {
          showAdminError(err && err.message ? err.message : 'Could not save employee.');
        });
    });

    var btnReset = document.getElementById('btnReset');
    if (btnReset) btnReset.addEventListener('click', clearEmployeeForm);

    var btnPrint = document.getElementById('btnPrint');
    if (btnPrint) btnPrint.addEventListener('click', function () { window.print(); });

    var btnPrintQr = document.getElementById('btnPrintQr');
    if (btnPrintQr) btnPrintQr.addEventListener('click', printQrOnly);

    if (tableBody) tableBody.addEventListener('click', function (e) {
      var editBtn = e.target.closest('[data-edit]');
      if (editBtn) {
        var id = editBtn.getAttribute('data-edit');
        var emp = employees.find(function (x) { return x.id === id; });
        if (!emp) return;
        editingEmployeeId = emp.id;

        var idInput = document.getElementById('empId');
        if (idInput) {
          idInput.value = emp.id;
          idInput.readOnly = true;
          idInput.classList.add('is-readonly');
        }
        document.getElementById('empFirst').value    = emp.firstName || '';
        document.getElementById('empMi').value       = emp.middleInitial || '';
        document.getElementById('empLast').value     = emp.lastName || '';
        document.getElementById('empPosition').value = emp.position || '';
        document.getElementById('empDept').value     = emp.department || '';
        document.getElementById('empNotes').value    = emp.notes || '';
        document.getElementById('empEcName').value   = emp.ecName || '';
        document.getElementById('empEcPhone').value  = emp.ecPhone || '';
        setEmployeePhoto(emp.photo || '');
        form.querySelectorAll('.is-invalid').forEach(function (el) { el.classList.remove('is-invalid'); });
        renderIdCard(emp);
        var p = buildPayload(emp);
        renderQr(qrHolder, p);
        renderQr(qrPreviewHolder, p);
        return;
      }
      var disableBtn = e.target.closest('[data-disable]');
      if (disableBtn) {
        var did = disableBtn.getAttribute('data-disable');
        var target = employees.find(function (x) { return x.id === did; });
        if (!target) return;

        var nextDisabled = !target.disabled;

        if (!appState.apiReady) {
          target.disabled = nextDisabled;

          if (target.disabled) {
            recordPunch(target.id, 'Clock Out');
          }

          applyEmployees(employees);
          return;
        }

        window.dtrApi.setEmployeeStatus(target.id, nextDisabled)
          .then(function (data) {
            if (data && data.stats) setStats(data.stats);
            applyEmployees(data && data.employees ? data.employees : employees);
          })
          .catch(function (err) {
            showAdminError(err && err.message ? err.message : 'Could not update employee status.');
          });
      }
    });

    /* =========================================================
       REMINDER EDITOR
       ========================================================= */
    var reminderInput  = document.getElementById('reminderText');
    var reminderCount  = document.getElementById('reminderCount');
    var reminderStatus = document.getElementById('reminderStatus');
    var btnSaveReminder  = document.getElementById('btnSaveReminder');
    var btnResetReminder = document.getElementById('btnResetReminder');

    function updateReminderCount() {
      if (!reminderInput || !reminderCount) return;
      reminderCount.textContent = reminderInput.value.length + ' / 600';
    }

    function loadReminderEditor() {
      if (!reminderInput) return;
      reminderInput.value = getReminderText();
      updateReminderCount();
    }

    function flashReminderStatus(msg, kind) {
      if (!reminderStatus) return;
      reminderStatus.textContent = msg;
      reminderStatus.className = 'reminder-editor__status mt-2' + (kind ? ' is-' + kind : '');
      setTimeout(function () {
        if (reminderStatus) {
          reminderStatus.textContent = '';
          reminderStatus.className = 'reminder-editor__status mt-2';
        }
      }, 2600);
    }

    if (reminderInput) {
      reminderInput.addEventListener('input', updateReminderCount);
    }
    if (btnSaveReminder) {
      btnSaveReminder.addEventListener('click', function () {
        var text = (reminderInput && reminderInput.value || '').trim();
        if (!text) {
          flashReminderStatus('Reminder text cannot be empty.', 'error');
          return;
        }

        setReminderText(text)
          .then(function () {
            flashReminderStatus('Reminder saved.', 'success');
          })
          .catch(function (err) {
            flashReminderStatus(err && err.message ? err.message : 'Could not save reminder.', 'error');
          });
      });
    }
    if (btnResetReminder) {
      btnResetReminder.addEventListener('click', function () {
        setReminderText(DEFAULT_REMINDER)
          .then(function () {
            loadReminderEditor();
            flashReminderStatus('Reminder reset to default.', 'success');
          })
          .catch(function (err) {
            flashReminderStatus(err && err.message ? err.message : 'Could not reset reminder.', 'error');
          });
      });
    }
    loadReminderEditor();

    /* =========================================================
       RESET PASSWORD (modal)
       ========================================================= */
    var resetForm      = document.getElementById('resetPasswordForm');
    var newPwEl        = document.getElementById('newPassword');
    var confirmPwEl    = document.getElementById('confirmPassword');
    var resetNoticeEl  = document.getElementById('resetPasswordNotice');
    var resetModalEl   = document.getElementById('resetPasswordModal');

    function showResetNotice(msg, kind) {
      if (!resetNoticeEl) return;
      resetNoticeEl.textContent = msg || '';
      resetNoticeEl.className = 'auth-notice' + (kind ? ' is-' + kind : '');
    }

    // Reset the form every time the modal opens or closes.
    if (resetModalEl) {
      resetModalEl.addEventListener('shown.bs.modal', function () {
        showResetNotice('', '');
        if (newPwEl) newPwEl.value = '';
        if (confirmPwEl) confirmPwEl.value = '';
        setTimeout(function () { if (newPwEl) newPwEl.focus(); }, 250);
      });
      resetModalEl.addEventListener('hidden.bs.modal', function () {
        showResetNotice('', '');
        if (newPwEl) newPwEl.value = '';
        if (confirmPwEl) confirmPwEl.value = '';
      });
    }

    if (resetForm) {
      resetForm.addEventListener('submit', function (e) {
        e.preventDefault();
        showResetNotice('', '');

        var session = getAdminSession();
        if (!session || !session.username) {
          showResetNotice('You must be signed in to change the password.', 'error');
          return;
        }
        var account = getAdminAccount();
        if (!account) {
          showResetNotice('No admin account found.', 'error');
          return;
        }

        var newPw     = (newPwEl && newPwEl.value || '');
        var confirmPw = (confirmPwEl && confirmPwEl.value || '');

        if (newPw.length < 6) {
          showResetNotice('Password must be at least 6 characters.', 'error');
          return;
        }
        if (newPw !== confirmPw) {
          showResetNotice('Passwords do not match.', 'error');
          return;
        }

        var salt = randomSalt();
        hashPassword(newPw, salt).then(function (hash) {
          setAdminAccount({
            username: account.username,
            salt: salt,
            passwordHash: hash
          });
          if (newPwEl) newPwEl.value = '';
          if (confirmPwEl) confirmPwEl.value = '';
          showResetNotice('Password updated successfully.', 'success');
          setTimeout(function () {
            showResetNotice('', '');
            if (resetModalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
              var inst = bootstrap.Modal.getInstance(resetModalEl);
              if (inst) inst.hide();
            }
          }, 1600);
        }).catch(function (err) {
          showResetNotice(err && err.message ? err.message : 'Could not update the password.', 'error');
        });
      });
    }

    /* =========================================================
       DTR SECTION
       ========================================================= */
    var dtrSearch      = document.getElementById('dtrEmpSearch');
    var dtrMonth       = document.getElementById('dtrMonth');
    var dtrStatus      = document.getElementById('dtrEmpStatus');
    var btnPrintDtr       = document.getElementById('btnPrintDtr');
    var btnExportBlank    = document.getElementById('btnExportBlankDtr');
    var btnExportAllDtr   = document.getElementById('btnExportAllDtr');

    function findEmployeeById(raw) {
      var q = (raw || '').trim().toUpperCase();
      if (!q) return null;
      return employees.find(function (x) { return (x.id || '').toUpperCase() === q; }) || null;
    }

    function refreshDtrStatus() {
      if (!dtrStatus || !dtrSearch) return;
      var q = dtrSearch.value.trim();
      if (!q) {
        dtrStatus.textContent = 'Search by employee ID only.';
        dtrStatus.classList.remove('text-danger', 'text-success');
        return;
      }
      var emp = findEmployeeById(q);
      if (emp) {
        dtrStatus.textContent = 'Found: ' + fullName(emp) + ' — ' + (emp.position || '—');
        dtrStatus.classList.remove('text-danger');
        dtrStatus.classList.add('text-success');
      } else {
        dtrStatus.textContent = 'No employee found with that ID.';
        dtrStatus.classList.remove('text-success');
        dtrStatus.classList.add('text-danger');
      }
    }

    if (dtrSearch) {
      attachUppercase(dtrSearch);
      dtrSearch.addEventListener('input', refreshDtrStatus);
    }

    if (btnPrintDtr) {
      btnPrintDtr.addEventListener('click', function () {
        var emp = findEmployeeById(dtrSearch ? dtrSearch.value : '');
        if (!emp) {
          window.alert('Please enter a valid employee ID before printing the DTR.');
          if (dtrSearch) dtrSearch.focus();
          return;
        }

        var monthVal = dtrMonth ? dtrMonth.value : '';
        if (!monthVal) {
          window.alert('Please select a month for the DTR.');
          if (dtrMonth) dtrMonth.focus();
          return;
        }

          showDownloadProcessing(
          'Preparing DTR...',
          'Exporting the selected employee DTR file.'
        );
        window.location.href =
          '/api/dtr/export?month=' + encodeURIComponent(monthVal) +
          '&employeeId=' + encodeURIComponent(emp.id);
      });
    }

    if (btnExportBlank) {
      btnExportBlank.addEventListener('click', function () {
        window.location.href = '/api/dtr/blank-template';
          showDownloadProcessing(
          'Preparing blank DTR...',
          'Downloading the blank DTR template.'
        );
      });
    }

        if (btnExportAllDtr) {
      btnExportAllDtr.addEventListener('click', function () {
        var monthVal = dtrMonth ? dtrMonth.value : '';

        if (!monthVal) {
          window.alert('Please select a month before exporting all employee DTR files.');
          if (dtrMonth) dtrMonth.focus();
          return;
        }

          showDownloadProcessing(
          'Preparing monthly DTR files...',
          'Exporting all employee DTR files. This may take a moment for many records.'
        );
        window.location.href =
          '/api/dtr/export-all?month=' + encodeURIComponent(monthVal);
      });
    }

    /* =========================================================
       BACKUP & RESET MODAL (password protected)
       ========================================================= */
    var modalEl       = document.getElementById('backupResetModal');
    var backupPwEl    = document.getElementById('backupPassword');
    var backupNotice  = document.getElementById('backupNotice');
    var bsModal = (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal)
      ? bootstrap.Modal.getOrCreateInstance(modalEl)
      : null;

    function showBackupNotice(msg, kind) {
      if (!backupNotice) return;
      backupNotice.textContent = msg || '';
      backupNotice.className = 'auth-notice' + (kind ? ' is-' + kind : '');
    }

    function hideModal() {
      if (bsModal) bsModal.hide();
      else if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        try { bootstrap.Modal.getInstance(modalEl).hide(); } catch (e) {}
      }
    }

        function showProcessing(title, message) {
      var overlay = document.getElementById('processingOverlay');
      var titleEl = document.getElementById('processingTitle');
      var messageEl = document.getElementById('processingMessage');

      if (titleEl) titleEl.textContent = title || 'Processing...';
      if (messageEl) messageEl.textContent = message || 'Please wait while the app finishes this action.';
      if (overlay) overlay.hidden = false;
    }

    function hideProcessing() {
      var overlay = document.getElementById('processingOverlay');
      if (overlay) overlay.hidden = true;
    }

    function showDownloadProcessing(title, message) {
      showProcessing(title, message);

      setTimeout(function () {
        hideProcessing();
      }, 2500);
    }

    function doBackup() {
      showDownloadProcessing(
        'Preparing backup...',
        'Downloading employee IDs and DTR time logs as an Excel workbook.'
      );
      window.location.href = '/api/backup.xlsx';
    }

    function applyResetResult(data) {
      if (data && data.stats) setStats(data.stats);
      applyEmployees(data && data.employees ? data.employees : employees);
      clearEmployeeForm();
      refreshDtrStatus();
    }

    function doResetDtrOnly() {
      if (!window.dtrApi || !window.dtrApi.resetDtr) {
        setStats(null);
        updateStats();
        refreshDtrStatus();
        return Promise.resolve();
      }

      return window.dtrApi.resetDtr().then(function (data) {
        applyResetResult(data);
      });
    }

    function doResetAll() {
      if (!window.dtrApi || !window.dtrApi.resetAll) {
        employees.length = 0;
        writeJson(STORAGE_KEYS.disabledIds, []);
        renderTable();
        updateStats();
        clearEmployeeForm();
        refreshDtrStatus();
        return Promise.resolve();
      }

      return window.dtrApi.resetAll().then(function (data) {
        applyResetResult(data);
      });
    }

    /* Verify the entered admin password against the stored hash.
       On success, clears the field and runs the callback. */
    function verifyAdminPassword(onVerified) {
      showBackupNotice('', '');

      var pw = (backupPwEl && backupPwEl.value) || '';
      if (!pw) {
        showBackupNotice('Administrator password is required.', 'error');
        if (backupPwEl) backupPwEl.focus();
        return;
      }

      var account = getAdminAccount();
      if (!account) {
        showBackupNotice('No admin account found.', 'error');
        return;
      }

      hashPassword(pw, account.salt).then(function (hash) {
        if (hash !== account.passwordHash) {
          showBackupNotice('Incorrect password.', 'error');
          if (backupPwEl) {
            backupPwEl.value = '';
            backupPwEl.focus();
          }
          return;
        }
        // Verified — clear the field and proceed.
        if (backupPwEl) backupPwEl.value = '';
        showBackupNotice('', '');
        onVerified();
      }).catch(function (err) {
        showBackupNotice(
          err && err.message ? err.message : 'Password verification failed.',
          'error'
        );
      });
    }

    // Reset the password field and notice whenever the modal opens or closes.
    if (modalEl) {
      modalEl.addEventListener('shown.bs.modal', function () {
        showBackupNotice('', '');
        if (backupPwEl) {
          backupPwEl.value = '';
          setTimeout(function () { backupPwEl.focus(); }, 250);
        }
      });
      modalEl.addEventListener('hidden.bs.modal', function () {
        showBackupNotice('', '');
        if (backupPwEl) backupPwEl.value = '';
      });
    }

    var btnBackupOnly = document.getElementById('btnBackupOnly');
    if (btnBackupOnly) btnBackupOnly.addEventListener('click', function () {
      verifyAdminPassword(function () {
        hideModal();
        doBackup();
      });
    });

    var btnResetDtrOnly = document.getElementById('btnResetDtrOnly');
    if (btnResetDtrOnly) btnResetDtrOnly.addEventListener('click', function () {
      verifyAdminPassword(function () {
        if (!window.confirm('Reset DTR attendance records only? Employee IDs will be kept.')) {
          return;
        }

        hideModal();

        showProcessing(
          'Resetting DTR records...',
          'Clearing attendance records while keeping employee IDs.'
        );

        doResetDtrOnly()
          .then(function () {
            hideProcessing();
            window.alert('DTR attendance records were cleared. Employee IDs were kept.');
          })
          .catch(function (err) {
            hideProcessing();
            window.alert(err && err.message ? err.message : 'Could not reset DTR records.');
          });
      });
    });

    var btnBackupAndReset = document.getElementById('btnBackupAndReset');
    if (btnBackupAndReset) btnBackupAndReset.addEventListener('click', function () {
      verifyAdminPassword(function () {
        hideModal();
        doBackup();

        setTimeout(function () {
          showProcessing(
            'Resetting all records...',
            'Clearing employee IDs and attendance records.'
          );

          doResetAll()
            .then(function () {
              hideProcessing();
              window.alert('Backup started. All employee IDs and attendance records were cleared.');
            })
            .catch(function (err) {
              hideProcessing();
              window.alert(err && err.message ? err.message : 'Could not reset records.');
            });
        }, 1200);
      });
    });

    var btnResetAll = document.getElementById('btnResetAll');
    if (btnResetAll) btnResetAll.addEventListener('click', function () {
      verifyAdminPassword(function () {
        if (!window.confirm('Reset all employee IDs and attendance records? This cannot be undone unless you already made a backup.')) {
          return;
        }

        hideModal();

        showProcessing(
          'Resetting all records...',
          'Clearing employee IDs and attendance records.'
        );

        doResetAll()
          .then(function () {
            hideProcessing();
            window.alert('All employee IDs and attendance records were cleared.');
          })
          .catch(function (err) {
            hideProcessing();
            window.alert(err && err.message ? err.message : 'Could not reset records.');
          });
      });
    });

    // Refresh the on-site count when the tab regains focus (e.g. after
    // the Home page recorded a punch in another tab).
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) updateStats();
    });

    applyEmployees(employees);
    refreshPreview();
  }

  /* ---------- Boot ---------- */
  function boot() {
    if (document.getElementById('time') || document.getElementById('date')) {
      tick();
      setInterval(tick, 1000);
    }

    loadBootstrapData().then(function () {
      initRemindersModal();
      initCamera();
      initClockActionModal();

      initAdminAuth();
      initAdmin();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
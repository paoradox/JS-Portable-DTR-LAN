/* =========================================================
   DTR Manager — bundled application JavaScript
   - Live preview on every employee field
   - Employee photo upload
   - Emergency contact (name + number, rendered on 2 lines)
   - Company header text + logo upload
   - Generated IDs search, Edit, Disable/Enable
   - Print ID, Print QR, DTR print, Blank DTR export
   - Backup / Backup & Reset / Reset modal (CSV backup)
   - Clock action modal (Clock In / Clock Out) with countdown
     and a "Ready to Clock In/Out" ↔ "Try again" scan hint loop
   ========================================================= */
(function () {
  'use strict';

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

  /* ---------- Reminders modal ---------- */
  function initModal() {
    var modalEl = document.getElementById('myModal');
    if (!modalEl) return;
    if (typeof bootstrap === 'undefined' || !bootstrap.Modal) return;
    try { new bootstrap.Modal(modalEl).show(); } catch (e) { /* ignore */ }
  }

  /* =========================================================
     CLOCK ACTION MODAL
     - No default selection (user must explicitly choose)
     - Okay with no selection → warning, modal stays open
     - Okay with Clock In / Clock Out → 3s countdown, then close
     - After close → "Ready to Clock In/Out" message that cycles
       with "Try again — No QR code detected." until the user
       opens the modal again.
     - Only the X button or a valid Okay+countdown can close it.
     ========================================================= */
  function initClockActionModal() {
    var modalEl = document.getElementById('clockActionModal');
    if (!modalEl) return;
    if (typeof bootstrap === 'undefined' || !bootstrap.Modal) return;

    var statusEl = document.getElementById('clockActionStatus');
    var okayBtn  = document.getElementById('clockActionOkay');
    var cameraEl = document.getElementById('camera-js');
    var scanHint = document.getElementById('scanHint');
    var radios   = modalEl.querySelectorAll('input[name="clockAction"]');

    var countdownTimer   = null;
    var scanLoopTimer    = null;
    var currentAction    = '';   // "Clock In" | "Clock Out"

    // Longer wait before we declare "no QR detected"
    var READY_WAIT_MS = 8000;
    // How long the "Try again" message stays before cycling back
    var RETRY_WAIT_MS = 4000;

    function getSelectedValue() {
      for (var i = 0; i < radios.length; i++) {
        if (radios[i].checked) return radios[i].value;
      }
      return '';
    }

    function stopScanLoop() {
      if (scanLoopTimer) { clearTimeout(scanLoopTimer); scanLoopTimer = null; }
      currentAction = '';
      if (scanHint) scanHint.hidden = true;
      if (cameraEl) cameraEl.classList.remove('is-ready');
    }

    function showReadyMessage() {
      if (!scanHint || !currentAction) return;
      scanHint.hidden = false;
      scanHint.classList.remove('is-retry');
      scanHint.innerHTML = '<i class="fa-solid fa-qrcode me-2"></i>' +
        'Ready to ' + currentAction + ' — show your QR code to the camera.';

      if (cameraEl) {
        cameraEl.classList.remove('is-ready');
        void cameraEl.offsetWidth;   // restart animation
        cameraEl.classList.add('is-ready');
      }

      scanLoopTimer = setTimeout(showRetryMessage, READY_WAIT_MS);
    }

    function showRetryMessage() {
      if (!scanHint || !currentAction) return;
      scanHint.hidden = false;
      scanHint.classList.add('is-retry');
      scanHint.innerHTML = '<i class="fa-solid fa-triangle-exclamation me-2"></i>' +
        'Try again — No QR code detected.';

      if (cameraEl) cameraEl.classList.remove('is-ready');

      scanLoopTimer = setTimeout(showReadyMessage, RETRY_WAIT_MS);
    }

    function startScanLoop(action) {
      stopScanLoop();
      currentAction = action;
      showReadyMessage();
    }

    function resetState() {
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
      // No default selection
      for (var i = 0; i < radios.length; i++) radios[i].checked = false;
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.classList.remove('is-warn', 'is-success');
      }
      if (okayBtn) okayBtn.disabled = false;
    }

    // When the modal is reopened, cancel any previous scan loop and clear UI
    modalEl.addEventListener('shown.bs.modal', function () {
      stopScanLoop();
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.classList.remove('is-warn', 'is-success');
      }
    });

    // After the modal is fully hidden, reset radios / status
    modalEl.addEventListener('hidden.bs.modal', resetState);

    if (okayBtn) {
      okayBtn.addEventListener('click', function () {
        var selected = getSelectedValue();

        // No selection → warn and keep modal open
        if (!selected) {
          if (statusEl) {
            statusEl.textContent = 'Please select Clock In or Clock Out.';
            statusEl.classList.remove('is-success');
            statusEl.classList.add('is-warn');
          }
          return;
        }

        // Valid selection → 3-second countdown, then close
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
      '.hdr-left{text-align:left;line-height:1.3;margin-bottom:8px}' +
      '.hdr-left .company{font-size:12.5px;font-weight:700;margin-bottom:4px}' +
      '.emp-line{font-size:10px;line-height:1.3}' +
      '.month-line{margin:8px 0 5px;font-size:10.5px}' +
      'table{width:100%;border-collapse:collapse;margin:0 auto;table-layout:fixed}' +
      'th,td{border:1px solid #333;padding:1px 2px;text-align:center;font-size:9px;line-height:1.05;height:13px;overflow:hidden;word-wrap:break-word}' +
      'th{background:#f0f0f0;font-weight:600;font-size:8.5px;line-height:1.1;height:auto;padding:2px 1px}' +
      '.c-date{width:6%}' +
      '.c-time{width:14%}' +
      '.c-ut{width:16%}' +
      '.footer{margin-top:10px;font-style:italic;text-align:center;font-size:9.5px;line-height:1.35}' +
      '.sig{text-align:center;margin-top:16px}' +
      '.sig .line{display:block;width:280px;margin:0 auto;border-bottom:1px solid #333;height:22px}' +
      '.verified{margin-top:16px;text-align:left;font-style:normal;font-size:10px}' +
      '.verified-sig{text-align:center;margin-top:16px}' +
      '.verified-sig .line{display:block;width:280px;margin:0 auto;border-bottom:1px solid #333;height:22px}' +
      '.incharge{margin-top:2px;text-align:center;font-size:10px}' +
      '</style></head><body><div class="wrap">' +

      '<div class="hdr-left">' +
        '<div class="company">' + escapeHtml(companyName) + '</div>' +
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
        'I certify on my honor that the above is a true and correct report of the hours of work performed, ' +
        'record of which was made daily at the time of arrival and departure from office.' +
      '</div>' +

      '<div class="sig"><span class="line"></span></div>' +

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
    var employees       = [];

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
        var reader = new FileReader();
        reader.onload = function (ev) { setEmployeePhoto(ev.target.result); };
        reader.readAsDataURL(file);
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
      if (!list.length) {
        tableBody.innerHTML =
          '<tr><td colspan="5" class="text-center text-muted py-4">' +
          (q ? 'No matching IDs.' : 'No IDs generated yet.') +
          '</td></tr>';
        return;
      }
      tableBody.innerHTML = '';
      list.forEach(function (emp) {
        var tr = document.createElement('tr');
        if (emp.disabled) tr.classList.add('table-secondary');
        var statusBadge = emp.disabled
          ? '<span class="badge bg-secondary">Disabled</span>'
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
    }

    ['empFirst', 'empLast', 'empMi', 'empId'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function () {
        if (el.classList.contains('is-invalid')) validate();
      });
    });

    if (searchInput) searchInput.addEventListener('input', renderTable);

    function clearEmployeeForm() {
      form.reset();
      form.querySelectorAll('.is-invalid').forEach(function (el) { el.classList.remove('is-invalid'); });
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

      var idx = employees.findIndex(function (x) { return x.id === d.id; });
      if (idx >= 0) {
        var wasDisabled = employees[idx].disabled;
        employees[idx] = d;
        employees[idx].disabled = wasDisabled;
      } else {
        employees.push(d);
      }

      renderTable();
      updateStats();

      if (!existedBefore) {
        form.reset();
        form.querySelectorAll('.is-invalid').forEach(function (el) { el.classList.remove('is-invalid'); });
        setEmployeePhoto('');
      }
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
        document.getElementById('empId').value       = emp.id;
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
        target.disabled = !target.disabled;
        renderTable();
        updateStats();
      }
    });

    /* =========================================================
       DTR SECTION
       ========================================================= */
    var dtrSearch      = document.getElementById('dtrEmpSearch');
    var dtrMonth       = document.getElementById('dtrMonth');
    var dtrStatus      = document.getElementById('dtrEmpStatus');
    var btnPrintDtr    = document.getElementById('btnPrintDtr');
    var btnExportBlank = document.getElementById('btnExportBlankDtr');

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
        openDtrPrint(emp, monthVal);
      });
    }

    if (btnExportBlank) {
      btnExportBlank.addEventListener('click', function () {
        openDtrPrint(null, '');
      });
    }

    /* =========================================================
       BACKUP & RESET MODAL
       ========================================================= */
    var modalEl = document.getElementById('backupResetModal');
    var bsModal = (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal)
      ? bootstrap.Modal.getOrCreateInstance(modalEl)
      : null;

    function hideModal() {
      if (bsModal) bsModal.hide();
      else if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        try { bootstrap.Modal.getInstance(modalEl).hide(); } catch (e) {}
      }
    }

    function doBackup() {
      if (!employees.length) {
        window.alert('There are no records to back up.');
        return;
      }
      var csv = buildEmployeesCsv(employees);
      downloadCsv('DTR_Backup_' + datestamp() + '.csv', csv);
    }

    function doReset() {
      employees.length = 0;
      renderTable();
      updateStats();
      clearEmployeeForm();
      refreshDtrStatus();
    }

    var btnBackupOnly = document.getElementById('btnBackupOnly');
    if (btnBackupOnly) btnBackupOnly.addEventListener('click', function () {
      hideModal();
      doBackup();
    });

    var btnBackupAndReset = document.getElementById('btnBackupAndReset');
    if (btnBackupAndReset) btnBackupAndReset.addEventListener('click', function () {
      hideModal();
      doBackup();
      doReset();
    });

    var btnResetAll = document.getElementById('btnResetAll');
    if (btnResetAll) btnResetAll.addEventListener('click', function () {
      hideModal();
      doReset();
    });

    updateStats();
    refreshPreview();
  }

  /* ---------- Boot ---------- */
  function boot() {
    if (document.getElementById('time') || document.getElementById('date')) {
      tick();
      setInterval(tick, 1000);
    }
    initModal();
    initClockActionModal();
    initAdmin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

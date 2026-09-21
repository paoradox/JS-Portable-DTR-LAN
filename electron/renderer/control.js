'use strict';

function setText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text || '';
}

function makeButton(label, onClick) {
  var button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function renderUrls(info) {
  var urlList = document.getElementById('urlList');
  if (!urlList) return;

  urlList.innerHTML = '';

  var urls = info.urls && info.urls.length ? info.urls : [info.localUrl];

  urls.forEach(function (url) {
    if (!url) return;

    var row = document.createElement('div');
    row.className = 'url-row';

    var input = document.createElement('input');
    input.readOnly = true;
    input.value = url;

    var copyBtn = makeButton('Copy', function () {
      window.controlApp.copyUrl(url);
    });

    var openBtn = makeButton('Open', function () {
      window.controlApp.openExternalUrl(url);
    });

    row.append(input, copyBtn, openBtn);
    urlList.appendChild(row);
  });
}

function renderShortcuts(info) {
  var container = document.getElementById('shortcuts');
  if (!container) return;

  container.innerHTML = '';

  (info.shortcuts || []).forEach(function (shortcut) {
    var button = makeButton(shortcut.label, function () {
      window.controlApp.openShortcut(shortcut.key);
    });

    container.appendChild(button);
  });
}

function refresh() {
  window.controlApp.getConnectionInfo().then(function (info) {
    setText('status', 'Listening on port ' + info.port);

    var portInput = document.getElementById('portInput');
    if (portInput) portInput.value = info.port || '';

    renderShortcuts(info);
    renderUrls(info);
  });
}

document.getElementById('changePortBtn').addEventListener('click', function () {
  var portInput = document.getElementById('portInput');
  var port = portInput ? portInput.value : '';

  setText('portMessage', 'Changing port...');

  window.controlApp.changePort(port).then(function (result) {
    if (result.ok) {
      setText('portMessage', 'Port changed to ' + result.port + '.');
      refresh();
      return;
    }

    setText('portMessage', result.error || 'Could not change port.');
  });
});

refresh();
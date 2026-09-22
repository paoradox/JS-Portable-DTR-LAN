'use strict';

(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function renderConnectionInfo(info) {
    $('statusLine').textContent = 'Listening on port ' + info.port;
    $('portInput').value = info.port || '';

    renderUrls(info);
    renderShortcuts(info);
  }

  function renderUrls(info) {
    var urlList = $('urlList');
    urlList.innerHTML = '';

    var urls = info.urls && info.urls.length ? info.urls : [info.localUrl];

    urls.forEach(function (url) {
      if (!url) return;

      var row = document.createElement('div');
      row.className = 'url-box';

      var input = document.createElement('input');
      input.type = 'text';
      input.readOnly = true;
      input.value = url;

      var copyBtn = document.createElement('button');
      copyBtn.textContent = 'Copy';
      copyBtn.className = 'secondary';
      copyBtn.addEventListener('click', function () {
        window.controlApp.copyUrl(url);
        copyBtn.textContent = 'Copied!';
        window.setTimeout(function () {
          copyBtn.textContent = 'Copy';
        }, 1500);
      });

      var openBtn = document.createElement('button');
      openBtn.textContent = 'Open';
      openBtn.className = 'secondary';
      openBtn.addEventListener('click', function () {
        window.controlApp.openExternalUrl(url);
      });

      row.appendChild(input);
      row.appendChild(copyBtn);
      row.appendChild(openBtn);
      urlList.appendChild(row);
    });

    if (!info.urls || info.urls.length === 0) {
      var warning = document.createElement('div');
      warning.className = 'hint';
      warning.textContent = 'No LAN network address detected. Local access still works at ' + info.localUrl + '.';
      urlList.appendChild(warning);
    }
  }

  function renderShortcuts(info) {
    var shortcuts = $('shortcuts');
    shortcuts.innerHTML = '';

    (info.shortcuts || []).forEach(function (shortcut) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = shortcut.label;
      button.addEventListener('click', function () {
        window.controlApp.openShortcut(shortcut.key);
      });

      shortcuts.appendChild(button);
    });
  }

  function loadConnectionInfo() {
    window.controlApp.getConnectionInfo().then(renderConnectionInfo);
  }

  $('changePortBtn').addEventListener('click', function () {
    var newPort = $('portInput').value;
    var messageEl = $('portMessage');

    messageEl.textContent = 'Changing port...';
    messageEl.className = 'port-message';

    window.controlApp.changePort(newPort).then(function (result) {
      if (result.ok) {
        messageEl.textContent = 'Port changed successfully.';
        messageEl.className = 'port-message ok';
        renderConnectionInfo(result.info || {
          port: result.port || newPort,
          urls: [],
          localUrl: 'http://localhost:' + (result.port || newPort),
          shortcuts: []
        });
      } else {
        messageEl.textContent = result.error || 'Could not change port.';
        messageEl.className = 'port-message error';
      }
    });
  });

  loadConnectionInfo();
})();
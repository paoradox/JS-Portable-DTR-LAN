'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('controlApp', {
  getConnectionInfo: function () {
    return ipcRenderer.invoke('get-connection-info');
  },
  copyUrl: function (url) {
    return ipcRenderer.invoke('copy-url', url);
  },
  openShortcut: function (key) {
    return ipcRenderer.invoke('open-shortcut', key);
  },
  openExternalUrl: function (url) {
    return ipcRenderer.invoke('open-external-url', url);
  },
  changePort: function (port) {
    return ipcRenderer.invoke('change-port', port);
  }
});
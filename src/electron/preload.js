const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  platform: process.platform,
  isElectron: true,
});

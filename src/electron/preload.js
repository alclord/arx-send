const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateStatus: (cb) => ipcRenderer.on('update_status', (_, data) => cb(data)),
  platform: process.platform,
  isElectron: true,
});

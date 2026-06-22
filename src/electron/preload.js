const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: (info) => ipcRenderer.invoke('download-update', info),
  cancelUpdate: () => ipcRenderer.invoke('cancel-update'),
  onUpdateStatus: (cb) => ipcRenderer.on('update_status', (_, data) => cb(data)),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  platform: process.platform,
  isElectron: true,
});

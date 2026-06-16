const { app, BrowserWindow, shell, Menu, Tray, nativeImage, ipcMain, Notification } = require('electron');
const path = require('path');
const http = require('http');
const { AutoUpdater } = require('./updater/autoUpdater');

process.env.ELECTRON_IS_DEV = parseInt(process.env.ELECTRON_IS_DEV || '0', 10);
const isDev = process.env.ELECTRON_IS_DEV === '1';

const PORT = process.env.PORT || 3000;
let mainWindow = null;
let tray = null;
let updater = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  Menu.setApplicationMenu(null);

  const { createApp, startApp, stopCleanupIntervals } = require('./app');
  const { createHTTPServer } = require('./app/http');
  const config = require('./app/config');
  const { AUTH_TOKEN } = require('./app/security');
  const { destroyAllSessions } = require('./services/sessionService');

  const appExpress = createApp();
  const { server, io } = createHTTPServer(appExpress);
  startApp(appExpress, io);

  const preloadPath = path.join(__dirname, 'electron', 'preload.js');

  function waitForServer(maxAttempts = 40) {
    return new Promise((resolve) => {
      let attempts = 0;
      const check = () => {
        const req = http.get(`http://localhost:${PORT}/`, (res) => {
          res.resume();
          resolve();
        });
        req.setTimeout(500, () => req.destroy());
        req.on('error', () => {
          if (++attempts < maxAttempts) setTimeout(check, 250);
          else resolve();
        });
      };
      check();
    });
  }

  function sendUpdateStatus(data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update_status', data);
    }
  }

  async function gracefulShutdown() {
    stopCleanupIntervals();
    await destroyAllSessions();
  }

  async function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 920,
      minHeight: 620,
      title: 'ARX Send',
      icon: path.join(__dirname, '../public/logo.png'),
      backgroundColor: '#0d1117',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: preloadPath,
      },
      show: false,
    });

    const loadingPath = isDev
      ? path.join(__dirname, 'loading.html')
      : path.join(process.resourcesPath, 'loading.html');
    mainWindow.loadFile(loadingPath);
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      mainWindow.focus();
    });

    server.listen(PORT);

    await waitForServer();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(`http://localhost:${PORT}`);
    }

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (!url.startsWith(`http://localhost:${PORT}`)) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });

    updater = new AutoUpdater({
      owner: config.GITHUB_OWNER,
      repo: config.GITHUB_REPO,
      currentVersion: config.CURRENT_VERSION,
      onStatus: sendUpdateStatus,
    });

    mainWindow.on('close', async (event) => {
      if (!app.isQuitting) {
        event.preventDefault();
        mainWindow.hide();
      }
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  function createTray() {
    const iconPath = path.join(__dirname, '../public/logo.png');
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip('ARX Send');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Abrir ARX Send',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: async () => {
          app.isQuitting = true;
          await gracefulShutdown();
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  }

  ipcMain.handle('get-app-version', () => config.CURRENT_VERSION);
  ipcMain.handle('get-auth-token', () => AUTH_TOKEN);
  ipcMain.handle('show-notification', (event, { title, body }) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  });
  ipcMain.handle('check-for-updates', async () => {
    if (!updater) return { ok: false, error: 'Updater não inicializado' };
    try {
      const result = await updater.check();
      if (!result.updateAvailable) {
        return { ok: true, updateAvailable: false };
      }
      return {
        ok: true,
        updateAvailable: true,
        version: result.version,
        electronChanged: result.electronChanged,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('download-update', async (event, updateInfo) => {
    if (!updater) return { ok: false, error: 'Updater não inicializado' };
    try {
      const result = await updater.downloadAndApply(updateInfo);
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('cancel-update', () => {
    if (updater) updater.abort();
    return { ok: true };
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      if (!mainWindow) app.quit();
    }
  });

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('before-quit', async () => {
    app.isQuitting = true;
    await gracefulShutdown();
  });
}

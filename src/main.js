const { app, BrowserWindow, shell, Menu, Tray, nativeImage, ipcMain, Notification } = require('electron');
const path = require('path');
const http = require('http');
const { autoUpdater } = require('electron-updater');

process.env.ELECTRON_IS_DEV = parseInt(process.env.ELECTRON_IS_DEV || '0', 10);
const isDev = process.env.ELECTRON_IS_DEV === '1';

const PORT = process.env.PORT || 3000;
let mainWindow = null;
let tray = null;

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
}

Menu.setApplicationMenu(null);

// ── Inicia servidor Express no mesmo processo ──
const { createApp, startApp } = require('./app');
const { createHTTPServer } = require('./app/http');
const config = require('./app/config');

const appExpress = createApp();
const { server, io } = createHTTPServer(appExpress);
startApp(appExpress, io);
server.listen(PORT);

// ── Preload path ──
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

  // ── Auto-updater ──
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send('update_status', {
      status: 'available', version: info.version,
      message: `Nova versão ${info.version} disponível`
    });
    autoUpdater.downloadUpdate().catch(() => {});
  });

  autoUpdater.on('download-progress', (p) => {
    mainWindow.webContents.send('update_status', {
      status: 'downloading', progress: Math.round(p.percent),
      message: `Baixando... ${Math.round(p.percent)}%`
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('update_status', {
      status: 'ready', version: info.version,
      message: 'Atualização pronta para instalar'
    });
  });

  if (!process.env.ELECTRON_IS_DEV) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
  }

  // ── Window events ──
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── System Tray ──
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
      click: () => {
        app.isQuitting = true;
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

// ── IPC Handlers ──
ipcMain.handle('get-app-version', () => config.CURRENT_VERSION);
ipcMain.handle('get-auth-token', () => {
  const { AUTH_TOKEN } = require('./app/security');
  return AUTH_TOKEN;
});
ipcMain.handle('show-notification', (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});
ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

// ── App lifecycle ──
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

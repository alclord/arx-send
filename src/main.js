const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const http = require('http');

const PORT = process.env.PORT || 3000;

// Remove a barra de menu nativa (File, Edit, View...)
Menu.setApplicationMenu(null);

// Inicia o servidor Express no mesmo processo
require('./server');

// Aguarda o Express estar ouvindo antes de abrir a janela
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
        else resolve(); // tenta mesmo assim após timeout
      });
    };
    check();
  });
}

let mainWindow = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1280,
    height:    820,
    minWidth:  920,
    minHeight: 620,
    title:     'ARX Send',
    icon:      path.join(__dirname, '../public/logo.png'),
    backgroundColor: '#0d1117', // evita flash branco antes de carregar
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false, // só mostra quando estiver pronto para exibir
  });

  // Tela de loading enquanto o servidor sobe
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Quando o servidor estiver pronto, navega para o app
  await waitForServer();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(`http://localhost:${PORT}`);
  }

  // Links externos abrem no navegador do sistema, não dentro do app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://localhost:${PORT}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { startServer } = require('./server');

let mainWindow = null;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0b0c12',
    title: 'VibedStudio',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const url = `http://localhost:${port}`;
  mainWindow.loadURL(url);

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  const port = await startServer();
  createWindow(port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

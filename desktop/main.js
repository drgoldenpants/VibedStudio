import { app, BrowserWindow, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startServer } from './server.js';

let mainWindow = null;
const LOG_PATH = path.join(os.homedir(), 'Library', 'Logs', 'VibedStudio.log');

function log(message) {
  try {
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
  }
}

process.on('uncaughtException', err => {
  log(`uncaughtException: ${err?.stack || err}`);
});
process.on('unhandledRejection', err => {
  log(`unhandledRejection: ${err?.stack || err}`);
});

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
  log('App ready');
  let port;
  try {
    const timeoutMs = 8000;
    port = await Promise.race([
      startServer(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Server start timed out')), timeoutMs)),
    ]);
  } catch (err) {
    log(`Server start failed: ${err?.stack || err}`);
    const errWin = new BrowserWindow({
      width: 640,
      height: 420,
      backgroundColor: '#0b0c12',
      title: 'VibedStudio',
    });
    const html = `
      <html>
        <body style="margin:0;background:#0b0c12;color:#e2e8f0;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
          <div style="padding:24px;">
            <h2 style="margin:0 0 12px;">VibedStudio failed to start</h2>
            <p style="margin:0 0 12px;color:#94a3b8;">The local server did not start in time.</p>
            <p style="margin:0 0 12px;color:#94a3b8;">Check the log file for details:</p>
            <code style="display:block;background:#111827;padding:10px;border-radius:8px;color:#e2e8f0;">${LOG_PATH}</code>
          </div>
        </body>
      </html>
    `;
    errWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return;
  }
  log(`Server started on port ${port}`);
  createWindow(port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

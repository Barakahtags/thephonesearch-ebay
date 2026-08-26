const { app, BrowserWindow, shell } = require('electron');

const APP_URL = process.env.THEPHONESEARCH_APP_URL || 'https://ie-verified-phones-ebay-hook.vercel.app/app.html';

function createWindow() {
  const win = new BrowserWindow({
    width: 1680,
    height: 1050,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#0b0f14',
    title: 'ThePhoneSearch',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url);
      const allowed = new URL(APP_URL);
      if (target.origin !== allowed.origin) {
        event.preventDefault();
        if (url.startsWith('https://')) shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  win.loadURL(APP_URL);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// main.js

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');

const uart = require('./uart');
const DeviceController = require('./device-controller');
const FirmwareUpdater = require('./firmware-updater');

const registerIpc = require('./ipc');

// Initialize updater with the device controller instance
const deviceController = new DeviceController(uart);
const firmwareUpdater = new FirmwareUpdater(deviceController);

let selectWindow = null;
let mainWindow = null;

// ---------- Window Management ----------

function createSelectWindow() {
  selectWindow = new BrowserWindow({
    width: 320,
    height: 320,
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  selectWindow.setMenuBarVisibility(false);
  selectWindow.loadFile('index.html');

  selectWindow.on('closed', () => {
    selectWindow = null;
  });
}

function createMainWindow({ portPath, fwVersion }) {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 1000,
    minHeight: 700,
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('main.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('FW version: ', fwVersion);

    mainWindow.webContents.send('selected-port', {
      portPath,
      fwVersion,
    });

    const appVersion = app.getVersion();
    mainWindow.webContents.send('app-version', appVersion);
  });
}

// ---------- IPC Registration ----------

registerIpc({
  ipcMain,
  BrowserWindow,
  dialog,
  fs,
  uart,
  deviceController,
  firmwareUpdater,
  createMainWindow,
  getSelectWindow: () => selectWindow,
  closeSelectWindow: () => {
    if (selectWindow) selectWindow.close();
  },
});

// ---------- App Lifecycle ----------

app.whenReady().then(() => {
  createSelectWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createSelectWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  // only intercept once
  app.removeAllListeners('before-quit');

  // let us run async, then quit
  event.preventDefault();

  deviceController.shutdown().finally(() => {
    app.quit();
  });
});

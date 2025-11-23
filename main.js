// main.js

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const uart = require('./uart');

let selectWindow;
let mainWindow;

function createSelectWindow() {
    selectWindow = new BrowserWindow({
        width: 320,
        height: 280,
        resizable: false,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    selectWindow.setMenuBarVisibility(false);
    selectWindow.loadFile('index.html');

    selectWindow.on('closed', () => {
        selectWindow = null;
    });
}

function createMainWindow(selectedPort) {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 710,
        minWidth: 1000,
        minHeight: 710,
        resizable: true,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile('main.html');

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('selected-port', selectedPort);
    });
}

let uploadWindow = null;

function createUploadWindow() {
  if (!mainWindow) return;

  uploadWindow = new BrowserWindow({
    width: 400,
    height: 140,
    resizable: false,
    parent: mainWindow,
    modal: true,
    frame: false,
    transparent: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  uploadWindow.setMenuBarVisibility(false);
  uploadWindow.loadFile('upload.html');

  uploadWindow.on('closed', () => {
    uploadWindow = null;
  });
}

app.whenReady().then(() => {
    createSelectWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createSelectWindow();
        }
    });
});

app.on('window-all-closed', () => {
    uart.close();
    if (process.platform !== 'darwin') app.quit();
});

// From small window: user chose a port and clicked Connect
ipcMain.on('port-selected', async (event, portPath) => {
    console.log('Port selected in renderer:', portPath);

    const baud = 115200;

    try {
        //await uart.open(portPath, baud);
        //await uart.sendAndWait('ID', line => line === 'VPT', 800);

        createMainWindow(portPath);
        if (selectWindow) selectWindow.close();
    } catch (err) {
        console.error('Device ID check failed:', err.message);
        uart.close();

        if (selectWindow && selectWindow.webContents) {
            selectWindow.webContents.send('port-check-failed', err.message);
        } else {
            event.sender.send('port-check-failed', err.message);
        }
    }
});

ipcMain.handle('fw-open-upload-window', () => {
  if (!uploadWindow) {
    createUploadWindow();
  }
});

// Generic UART IPC if needed from main window
ipcMain.handle('uart-open', (_e, portPath, baud) => uart.open(portPath, baud));
ipcMain.handle('uart-close', () => uart.close());
ipcMain.handle('uart-send', (_e, cmd) => uart.send(cmd));
ipcMain.handle('uart-send-wait', (_e, cmd, timeoutMs) =>
    uart.sendAndWait(cmd, () => true, timeoutMs)
);

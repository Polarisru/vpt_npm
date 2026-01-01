// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const uart = require('./uart');
const DeviceController = require('./device-controller');
const FirmwareUpdater = require('./firmware-updater');

// Initialize updater with the device controller instance
const deviceController = new DeviceController(uart);
const firmwareUpdater = new FirmwareUpdater(deviceController);

let selectWindow;
let mainWindow;

// ---------- Window Management ----------

function createSelectWindow() {
  selectWindow = new BrowserWindow({
    width: 320,
    height: 320,
    resizable: true,
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
      backgroundThrottling: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('main.html');
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    // Send both port and FW version to main window renderer
    console.log('FW version: ', fwVersion);
    mainWindow.webContents.send('selected-port', {
      portPath,
      fwVersion
    });
    // send app version from package.json
    const appVersion = app.getVersion();
    mainWindow.webContents.send('app-version', appVersion);
  });
}

// ---------- App Lifecycle ----------

app.whenReady().then(() => {
  createSelectWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSelectWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', event => {
  // only intercept once
  app.removeAllListeners('before-quit');
  // let us run async, then quit
  event.preventDefault();
  deviceController.shutdown().finally(() => {
    app.quit();
  });
});

// ---------- IPC Handlers ----------

// From starting window: user chose a port and clicked Connect
ipcMain.on('port-selected', async (event, arg) => {
  const portPath = typeof arg === 'string' ? arg : arg.portPath;
  const isRecovery = typeof arg === 'string' ? false : arg.recovery;
  
  console.log('Port selected in renderer:', portPath, 'Recovery:', isRecovery);
  const baud = 115200;
  
  try {
    await uart.open(portPath, baud);
    let fwVersion = '00.00';

    if (!isRecovery) {
      const { fwVersion: fw } = await deviceController.handshake();
      fwVersion = fw;
    } else {
      console.log('Recovery mode: Skipping handshake.');
    }

    createMainWindow({ portPath, fwVersion });
    if (selectWindow) selectWindow.close();

  } catch (err) {
    console.error('Connection failed:', err.message);
    uart.close();
    const msg = isRecovery ? 'Recovery open failed' : 'VPT not connected';
    if (selectWindow && selectWindow.webContents) {
      selectWindow.webContents.send('port-check-failed', msg);
    } else {
      event.sender.send('port-check-failed', msg);
    }
  }
});

// Connection setup
ipcMain.handle('conn-init', async (_event, cfg) => {
  if (!uart.isOpen()) throw new Error('UART not open');
  await deviceController.setInterface(cfg.type, cfg);
  return true;
});

ipcMain.handle('conn-power', async (_event, on) => {
  if (!uart.isOpen()) return false;
  await deviceController.setPower(on);
  return true;
});

// Device Control & Status
ipcMain.handle('set-position', async (_event, degrees) => {
  if (!uart.isOpen()) throw new Error('UART not open');
  return await deviceController.setPosition(degrees);
});

ipcMain.handle('read-device-position', async () => {
  if (!uart.isOpen()) throw new Error('UART not open');
  return await deviceController.readDevicePosition();
});

ipcMain.handle('read-supply', async () => {
  if (!uart.isOpen()) throw new Error('UART not open');
  return deviceController.readSupply();
});

ipcMain.handle('read-temperature', async () => {
  if (!uart.isOpen()) throw new Error('UART not open');
  return deviceController.readTemperature();
});

ipcMain.handle('read-status', async () => {
  if (!uart.isOpen()) throw new Error('UART not open');
  return deviceController.readStatus();
});

ipcMain.handle('read-live-metrics', async () => {
  if (!uart.isOpen()) throw new Error('UART not open');

  // Fetch all 3 sequentially
  // We handle them here so the Renderer gets one nice object
  // const voltage = await deviceController.readMonitorVoltage();
  // const current = await deviceController.readMonitorCurrent();
  // const temp = await deviceController.readMonitorTemperature();
  // return { voltage, current, temp };
  return await deviceController.readLiveMetrics();
});

ipcMain.handle('uart-send-wait', async (_e, cmd, matchStringOrTimeout, timeoutArg) => {
  let timeoutMs = 3000;
  let matcher = () => true; 

  if (typeof matchStringOrTimeout === 'string') {
    const matchStr = matchStringOrTimeout.trim().toUpperCase();
    matcher = (line) => line.trim().toUpperCase() === matchStr;
    if (typeof timeoutArg === 'number') timeoutMs = timeoutArg;
  } else if (typeof matchStringOrTimeout === 'number') {
    timeoutMs = matchStringOrTimeout;
  }

  try {
    return await deviceController.queuedSendAndWait(cmd, matcher, timeoutMs);
  } catch (error) {
    throw error;
  }
});

ipcMain.handle('send-raw-command', async (_event, { bytes }) => {
  if (!uart.isOpen()) throw new Error('UART not open');
  return await deviceController.sendRawCommand(bytes);
});

ipcMain.handle('send-text-command', async (_event, { cmd, prefix }) => {
  if (!uart.isOpen()) throw new Error('UART not open');
  return await deviceController.sendTextCommand(cmd, prefix);
});

ipcMain.handle('get-uart-instance', async (event) => {
  // Return your uart object or wrapper if needed by some specific logic, 
  // though usually renderer shouldn't access this directly.
  return {}; 
});

ipcMain.handle('uart-open', (_e, portPath, baud) => uart.open(portPath, baud));
ipcMain.handle('uart-close', () => uart.close());
ipcMain.handle('uart-send', (_e, cmd) => uart.send(cmd));


// Parameters (EEPROM)
ipcMain.handle('write-param', async (_event, { address, type, value }) => {
  if (!uart.isOpen()) throw new Error('UART not open');
  await deviceController.writeParam(address, type, value);
  return true;
});

ipcMain.handle('read-byte', async (_event, address) => {
  if (!uart.isOpen()) throw new Error('UART not open');
  return await deviceController.readByte(address);
});

ipcMain.handle('read-ascii-range', async (_event, { start, end }) => {
  if (!uart.isOpen()) throw new Error('UART not open');
  return await deviceController.readAsciiRange(start, end);
});


// Firmware / Bootloader
ipcMain.handle('perform-update', async (event, pages, totalPages) => {
  if (!uart.isOpen()) throw new Error('UART not open');
  const win = BrowserWindow.fromWebContents(event.sender);
  try {
    await firmwareUpdater.performUpdate(win, pages, totalPages);
  } catch (err) {
    console.error('Firmware update error:', err);
    throw err;
  }
  return true;
});

ipcMain.handle('perform-upload', async (event, pages, totalPages) => {
  if (!uart.isOpen()) throw new Error('UART not open');
  const win = BrowserWindow.fromWebContents(event.sender);
  try {
    await firmwareUpdater.performUpload(win, pages, totalPages);
  } catch (err) {
    console.error('HEX upload error:', err);
    throw err;
  }
  return true;
});


// Filesystem Handlers
ipcMain.handle('select-hex-file', async () => {
  const result = await dialog.showOpenDialog({ 
    filters: [{ name: 'Hex Files', extensions: ['hex'] }], 
    properties: ['openFile'] 
  });
  return result;
});

ipcMain.handle('read-file', async (_event, path) => {
  return fs.promises.readFile(path, 'utf-8');
});

ipcMain.handle('write-file', async (event, { path, content }) => {
  await fs.promises.writeFile(path, content, 'utf8');
});

ipcMain.handle('save-dialog', async (event, options) => {
  const { canceled, filePath } = await dialog.showSaveDialog(options);
  return { canceled, filePath };
});

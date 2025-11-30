// main.js

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const uart = require('./uart');
const fs = require('fs');

let selectWindow;
let mainWindow;
let uploadWindow = null;

async function sendPwr0OnExit() {
  if (!uart.isOpen()) {
    console.log('sendPwr0OnExit: UART not open, skipping PWR0');
    return;
  }

  console.log('sendPwr0OnExit: trying to send PWR0');

  try {
    await uart.sendAndWait(
      'PWR0',
      line => {
        console.log('sendPwr0OnExit got line:', line);
        return line.trim() === 'OK';
      },
      500
    );
    console.log('sendPwr0OnExit: PWR0 acknowledged');
  } catch (e) {
    console.error('sendPwr0OnExit: PWR0 failed:', e.message);
  }

  // now close UART once, here
  uart.close();
}

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

function createMainWindow({ portPath, fwVersion }) {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 1000,
        minHeight: 670,
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
      mainWindow.webContents.send('selected-port', {
        portPath,
			  fwVersion
		  });
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
    //uart.close();
    if (process.platform !== 'darwin') app.quit();
});

// From small window: user chose a port and clicked Connect
ipcMain.on('port-selected', async (event, portPath) => {
  console.log('Port selected in renderer:', portPath);
  const baud = 115200;

  try {
    // 1) Open port
    await uart.open(portPath, baud);

    // 2) Send "ID" and expect exact "VPT"
    const idResp = await uart.sendAndWait(
      'ID',
      line => line.trim() === 'VPT',
      800
    );
    console.log('ID response:', idResp);

    // 3) Send "VN" and expect "Nx.y"
    const vnResp = await uart.sendAndWait(
      'VN',
      line => /^N:\d+\.\d+$/.test(line.trim()),
      800
    );
    console.log('VN response:', vnResp);

    // Extract x.y from "N:x.y"
    const match = vnResp.trim().match(/^N:(\d+\.\d+)$/);
    const fwVersion = match ? match[1] : '0.0';

    // Open main window and pass both port and FW version
    createMainWindow({ portPath, fwVersion });

    if (selectWindow) selectWindow.close();
  } catch (err) {
    console.error('Device handshake failed:', err.message);
    uart.close();

    // Tell renderer: VPT not connected
    const msg = 'VPT not connected';
    if (selectWindow && selectWindow.webContents) {
      selectWindow.webContents.send('port-check-failed', msg);
    } else {
      event.sender.send('port-check-failed', msg);
    }
  }
});

// cfg = { type: 'PWM'|'RS485'|'CAN', baud?, id?, bitrate? }
ipcMain.handle('conn-init', async (_event, cfg) => {
  if (!uart.isOpen()) {
    throw new Error('UART not open');
  }

  const type = cfg.type;

  // Map connType -> SIx
  let siCmd = null;
  if (type === 'PWM') siCmd = 'SI0';
  else if (type === 'RS485') siCmd = 'SI1';
  else if (type === 'CAN') siCmd = 'SI2';
  else throw new Error('Unknown connection type: ' + type);

  // Helper: send command and expect "OK"
  async function sendOk(cmd) {
    const resp = await uart.sendAndWait(
      cmd,
      line => line.trim() === 'OK',
      800
    );
    return resp;
  }

  // 1) SIx
  await sendOk(siCmd);

  // 2) Type-specific SBx / SIDx
  if (type === 'RS485') {
    // SBx where x = rs485-baud value
    const baud = cfg.baud;
    if (!baud) throw new Error('Missing RS485 baud');
    await sendOk('SB' + String(baud));

    // SIDx where x = rs485-id value
    const id = cfg.id;
    if (!id) throw new Error('Missing RS485 ID');
    await sendOk('SID' + String(id));
  } else if (type === 'CAN') {
    // SBx where x = 250/500/1000 from can-bitrate
    const bitrate = Number(cfg.bitrate);
    if (![250, 500, 1000].includes(bitrate)) {
      throw new Error('Invalid CAN bitrate: ' + cfg.bitrate);
    }
    await sendOk('SB' + String(bitrate));

    // SIDx where x = can-id value
    const id = cfg.id;
    if (!id) throw new Error('Missing CAN ID');
    await sendOk('SID' + String(id));
  }

  // 4) SCLx.x current limit
  if (typeof cfg.current === 'number') {
    const curStr = cfg.current.toFixed(1); // 1 decimal
    await sendOk('SCL' + curStr);
  }

  // 3) For all protocols: PWR1
  await sendOk('PWR1');

  // if all OK, just return
  return true;
});

ipcMain.handle('conn-power', async (_event, on) => {
  if (!uart.isOpen()) return false;

  const cmd = on ? 'PWR1' : 'PWR0';
  await uart.sendAndWait(
    cmd,
    line => line.trim() === 'OK',
    800
  );
  return true;
});

ipcMain.handle('set-position', async (_event, degrees) => {
  if (!uart.isOpen()) {
    throw new Error('UART not open');
  }

  // format with one decimal place, e.g. 12.3
  const posStr = Number(degrees).toFixed(1);
  const cmd = 'DP' + posStr;

  await uart.sendAndWait(
    cmd,
    line => line.trim() === 'OK',
    800
  );

  return true;
});

ipcMain.handle('read-device-position', async () => {
  if (!uart.isOpen()) throw new Error('UART not open');

  // Send "GPS", wait for a line starting with "PS:"
  const resp = await uart.sendAndWait(
    'GPS',
    line => line.trim().startsWith('PS:'),
    800
  );
  return resp;
});

ipcMain.handle('uart-send-command', async (_event, command) => {
  try {
    const resp = await uart.sendAndWait(
      command,
      line => line.startsWith('UM:') || line.startsWith('CS:') || line.startsWith('TS:') || line === 'E.H',
      800
    );
    return resp;
  } catch (e) {
    console.error(`Error sending uart command '${command}':`, e);
    throw e;
  }
});

ipcMain.handle('select-hex-file', async () => {
  const result = await dialog.showOpenDialog({ filters: [{ name: 'Hex Files', extensions: ['hex'] }], properties: ['openFile'] });
  return result;
});

ipcMain.handle('read-file', async (_event, path) => {
  return fs.promises.readFile(path, 'utf-8');
});

ipcMain.handle('write-param', async (_event, { address, type, value }) => {
  if (!uart.isOpen()) {
    throw new Error('UART not open');
  }

  // Ensure integer raw value
  let raw = Number(value);
  if (!Number.isFinite(raw)) {
    throw new Error('Invalid value for address ' + address);
  }
  raw = Math.trunc(raw);

  // Helper to send one WBxx:yy and expect OK
  async function writeByte(addr, byteVal) {
    const addrHex = addr.toString(16).toUpperCase().padStart(2, '0');
    const valHex = (byteVal & 0xFF).toString(16).toUpperCase().padStart(2, '0');
    const cmd = `WB${addrHex}:${valHex}`;
    await uart.sendAndWait(
      cmd,
      line => line.trim() === 'OK',
      800
    );
  }

  if (type === 'uint16' || type === 'int16') {
    const low = raw & 0xFF;
    const high = (raw >> 8) & 0xFF;
    await writeByte(address, low);
    await writeByte(address + 1, high);
  } else {
    await writeByte(address, raw);
  }

  return true;
});

ipcMain.handle('read-byte', async (_event, address) => {
  if (!uart.isOpen()) throw new Error('UART not open');

  const addrHex = address.toString(16).toUpperCase().padStart(2, '0');
  const cmd = `RB${addrHex}`;

  const resp = await uart.sendAndWait(
    cmd,
    line => /^B:0x[0-9A-Fa-f]{2}$/.test(line.trim()),
    800
  );

  const m = resp.trim().match(/^B:0x([0-9A-Fa-f]{2})$/);
  if (!m) throw new Error('Bad RB response for address ' + address + ': ' + resp);

  return parseInt(m[1], 16); // numeric 0..255
});

ipcMain.handle('read-ascii-range', async (_event, { start, end }) => {
  if (!uart.isOpen()) throw new Error('UART not open');

  function addrHex(a) {
    return a.toString(16).toUpperCase().padStart(2, '0');
  }

  async function readByte(addr) {
    const cmd = 'RB' + addrHex(addr);
    const resp = await uart.sendAndWait(
      cmd,
      line => /^B:0x[0-9A-Fa-f]{2}$/.test(line.trim()),
      800
    );
    const m = resp.trim().match(/^B:0x([0-9A-Fa-f]{2})$/);
    if (!m) throw new Error('Bad RB response at ' + addr + ': ' + resp);
    return parseInt(m[1], 16);
  }

  const bytes = [];
  for (let a = start; a <= end; a++) {
    const b = await readByte(a);
    if (b === 0x00 || b === 0xFF) break; // terminator
    bytes.push(b);
  }

  const chars = bytes.map(b => String.fromCharCode(b));
  console.log("Text: ", chars.join(''));
  return chars.join('');
});

ipcMain.handle('send-raw-command', async (_event, { bytes }) => {
  if (!uart.isOpen()) throw new Error('UART not open');
  // bytes: array of numbers 0..255
  // Build command string, e.g. "RCxx yy zz ..." or directly hex frame
  const hex = bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
  // Assuming device expects just hex bytes as one command:
  const cmd = 'RAW' + hex; // adjust if protocol needs prefix
  const resp = await uart.sendAndWait(
    cmd,
    line => line.trim() === 'OK',
    800
  );
  return resp;
});

ipcMain.handle('read-supply', async () => {
  if (!uart.isOpen()) throw new Error('UART not open');

  const resp = await uart.sendAndWait(
    'GUS',
    line => /^US:-?\d+\.\d+$/.test(line.trim()),
    800
  );
  const m = resp.trim().match(/^US:(-?\d+\.\d+)$/);
  return m ? parseFloat(m[1]) : null;
});

ipcMain.handle('read-temperature', async () => {
  if (!uart.isOpen()) throw new Error('UART not open');

  const resp = await uart.sendAndWait(
    'GT',
    line => /^T:-?\d+\.\d+$/.test(line.trim()),
    800
  );
  const m = resp.trim().match(/^T:(-?\d+\.\d+)$/);
  return m ? parseFloat(m[1]) : null;
});

ipcMain.handle('read-status', async () => {
  if (!uart.isOpen()) throw new Error('UART not open');

  const resp = await uart.sendAndWait(
    'GS',
    line => /^S:\d+$/.test(line.trim()),
    800
  );
  const m = resp.trim().match(/^S:(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
});

ipcMain.handle('perform-update', async (event, hexContent) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  // your chunking / flashing logic…
  const totalSteps = chunks.length;
  for (let i = 0; i < totalSteps; i++) {
    // write chunk i...
    const percent = Math.round(((i + 1) / totalSteps) * 100);
    win.webContents.send('update-progress', {
      percent,
      text: `Uploading… ${percent}%`
    });
  }
});

ipcMain.handle('get-uart-instance', async (event) => {
  // Return your uart object or wrapper
  return uartInstance;  // adjust to your implementation
});

ipcMain.handle('save-dialog', async (event, options) => {
  const { canceled, filePath } = await dialog.showSaveDialog(options);
  return { canceled, filePath };
});

ipcMain.handle('write-file', async (event, { path, content }) => {
  await fs.promises.writeFile(path, content, 'utf8');
});

app.on('before-quit', event => {
  // only intercept once
  app.removeAllListeners('before-quit');
  // let us run async, then quit
  event.preventDefault();
  sendPwr0OnExit().finally(() => {
    app.quit();
  });
});

// Generic UART IPC if needed from main window
ipcMain.handle('uart-open', (_e, portPath, baud) => uart.open(portPath, baud));
ipcMain.handle('uart-close', () => uart.close());
ipcMain.handle('uart-send', (_e, cmd) => uart.send(cmd));
//ipcMain.handle('uart-send-wait', (_e, cmd, timeoutMs) =>
//    uart.sendAndWait(cmd, () => true, timeoutMs)
//);
ipcMain.handle('uart-send-wait', async (_e, cmd, timeoutMs) => {
  try {
    const result = await uart.sendAndWait(cmd, () => true, timeoutMs || 3000);
    return result;
  } catch (error) {
    throw error;
  }
});

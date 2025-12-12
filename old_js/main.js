// main.js

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const uart = require('./uart');
const fs = require('fs');

let selectWindow;
let mainWindow;
let uploadWindow = null;

// Priority-based async lock
class PriorityLock {
  constructor() {
    this.locked = false;
    this.highPriorityQueue = [];  // position, user commands
    this.lowPriorityQueue = [];   // polling
  }

  async acquire(priority = 'high') {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    // Wait in appropriate queue
    const queue = priority === 'high' ? this.highPriorityQueue : this.lowPriorityQueue;
    await new Promise(resolve => queue.push(resolve));
  }

  release() {
    // High priority first
    if (this.highPriorityQueue.length > 0) {
      const resolve = this.highPriorityQueue.shift();
      resolve();
    } else if (this.lowPriorityQueue.length > 0) {
      const resolve = this.lowPriorityQueue.shift();
      resolve();
    } else {
      this.locked = false;
    }
  }
}

const uartLock = new PriorityLock();

// High priority (default for all commands)
async function queuedSendAndWait(cmd, matcher, timeoutMs = 1000) {
  await uartLock.acquire('high');
  try {
    return await uart.sendAndWait(cmd, matcher, timeoutMs);
  } finally {
    uartLock.release();
  }
}

// Low priority (for polling only)
async function pollingRequest(cmd, matcher, timeoutMs = 1000) {
  await uartLock.acquire('low');
  try {
    return await uart.sendAndWait(cmd, matcher, timeoutMs);
  } finally {
    uartLock.release();
  }
}

async function sendPwr0OnExit() {
  if (!uart.isOpen()) {
    console.log('sendPwr0OnExit: UART not open, skipping PWR0');
    return;
  }

  console.log('sendPwr0OnExit: trying to send PWR0');

  try {
    await queuedSendAndWait(
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
        height: 320,
        resizable: true,//false,
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
ipcMain.on('port-selected', async (event, arg) => {
  // Handle both old (string) and new (object) formats for backward compatibility
  const portPath = typeof arg === 'string' ? arg : arg.portPath;
  const isRecovery = typeof arg === 'string' ? false : arg.recovery;

  console.log('Port selected in renderer:', portPath, 'Recovery:', isRecovery);
  
  const baud = 115200;

  try {
    // Open port
    await uart.open(portPath, baud);
    
    let fwVersion = '00.00';

    if (!isRecovery) {
      // NORMAL MODE: Do handshake    // 2) Send "ID" and expect exact "VPT"
      const idResp = await queuedSendAndWait(
        'ID',
        line => line.trim() === 'VPT',
        800
      );
      console.log('ID response:', idResp);

      // 3) Send "VN" and expect "N:x.y"
      const vnResp = await queuedSendAndWait(
        'VN',
        line => /^N:\d+\.\d+$/.test(line.trim()),
        800
      );
      console.log('VN response:', vnResp);

      // Extract x.y from "N:x.y"
      const match = vnResp.trim().match(/^N:(\d+\.\d+)$/);
      fwVersion = match ? match[1] : '00.00';
    } else {
      // RECOVERY MODE: Skip handshake, force version 0.0
      console.log('Recovery mode: Skipping handshake.');
    }
    // Open main window and pass both port and FW version
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

// cfg = { type: 'PWM'|'RS485'|'CAN', baud?, id?, bitrate?, subtype?, baseId?, current? }
ipcMain.handle('conn-init', async (_event, cfg) => {
  if (!uart.isOpen()) {
    throw new Error('UART not open');
  }

  const type = cfg.type;

  // Map connType -> SIx
  let siCmd = null;
  if (type === 'PWM') siCmd = 'SI1';
  else if (type === 'RS485') siCmd = 'SI2';
  else if (type === 'CAN') siCmd = 'SI3';
  else throw new Error('Unknown connection type: ' + type);

  // Helper: send command and expect "OK"
  async function sendOk(cmd) {
    const resp = await queuedSendAndWait(
      cmd,
      line => line.trim() === 'OK',
      800
    );
    return resp;
  }

  // 1) SIx
  await sendOk(siCmd);

  // 2) Type-specific SBx / SIDx / etc.
  if (type === 'RS485') {
    // SBx where x = rs485-baud value
    const baud = cfg.baud;
    if (!baud) throw new Error('Missing RS485 baud');
    await sendOk('SB' + String(baud));
    // SSIx where x = rs485-subtype value
    const subtype = cfg.subtype;
    if (!subtype) throw new Error('Missing RS485 subtype');
    await sendOk('SSI' + String(subtype));
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
    // SBIx where x = can-base-id value
    const base_id = cfg.baseId;
    if (!base_id) throw new Error('Missing CAN base ID');
    await sendOk('SBI' + String(base_id));
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
  await queuedSendAndWait(
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

  // Format with one decimal place, e.g. 12.3
  const posStr = Number(degrees).toFixed(1);
  const cmd = 'DPR' + posStr;

  // 1. Change Matcher: Expect "PS:..." response
  // 2. Timeout: Increased to 80ms to be safe (30ms is risky with USB latency)
  const resp = await queuedSendAndWait(
    cmd,
    line => line.trim().startsWith('PS:'),
    80
  );

  // 3. Parse response "PS:12.3" -> 12.3
  // Regex handles negative numbers and optional decimals
  const match = resp.trim().match(/^PS:(-?\d+(?:\.\d+)?)$/);
  if (match) {
    return parseFloat(match[1]); // Return actual position to renderer
  }

  throw new Error(`Unexpected response format: ${resp}`);
});

ipcMain.handle('read-device-position', async () => {
  if (!uart.isOpen()) throw new Error('UART not open');

  // Send "GPS", wait for a line starting with "PS:"
  const resp = await queuedSendAndWait(
    'GPS',
    line => line.trim().startsWith('PS:'),
    800
  );
  return resp;
});

ipcMain.handle('uart-send-command', async (_event, command) => {
  try {
    const resp = await queuedSendAndWait(
      command,
      line =>
        line.startsWith('UM:') ||
        line.startsWith('CS:') ||
        line.startsWith('TS:') ||
        line === 'E.H',  // ??? may be this should be ignored
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
    await queuedSendAndWait(
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

  const resp = await queuedSendAndWait(
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
    const resp = await queuedSendAndWait(
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
  console.log('Text: ', chars.join(''));
  return chars.join('');
});

ipcMain.handle('send-raw-command', async (_event, { bytes }) => {
  if (!uart.isOpen()) throw new Error('UART not open');
  const hex = bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
  const cmd = 'RAW' + hex;
  const resp = await queuedSendAndWait(
    cmd,
    line => line.trim().length > 0,
    800
  );
  return resp.trim();
});

// NEW: prefix-based text command
ipcMain.handle('send-text-command', async (_event, { cmd, prefix }) => {
  if (!uart.isOpen()) throw new Error('UART not open');
  
  const matcher = line => {
    const t = line.trim();
    if (!t) return false;
    if (typeof prefix === 'string' && prefix.length > 0) {
      return t.startsWith(prefix);
    }
    return false;
  };
  
  const resp = await queuedSendAndWait(cmd, matcher, 800);
  return resp;
});

ipcMain.handle('read-supply', async () => {
  if (!uart.isOpen()) throw new Error('UART not open');

  const resp = await pollingRequest(
    'GUS',
    line => /^US:-?\d+\.\d+$/.test(line.trim()),
    100
  );
  const m = resp.trim().match(/^US:(-?\d+\.\d+)$/);
  return m ? parseFloat(m[1]) : null;
});

ipcMain.handle('read-temperature', async () => {
  if (!uart.isOpen()) throw new Error('UART not open');

  const resp = await pollingRequest(
    'GT',
    line => /^T:-?\d+\.\d+$/.test(line.trim()),
    100
  );
  const m = resp.trim().match(/^T:(-?\d+\.\d+)$/);
  return m ? parseFloat(m[1]) : null;
});

ipcMain.handle('read-status', async () => {
  if (!uart.isOpen()) throw new Error('UART not open');

  const resp = await pollingRequest(
    'GS',
    line => /^S:\d+$/.test(line.trim()),
    100
  );
  const m = resp.trim().match(/^S:(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
});

function crc16(pageData) {
  const polynomial = 0x8005;
  let crc = 0xFFFF;

  for (let i = 0; i < pageData.length; i++) {
    crc ^= (pageData[i] << 8);
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ polynomial;
      } else {
        crc = (crc << 1);
      }
      crc &= 0xFFFF;
    }
  }
  return crc & 0xFFFF;
}

// perform-update: keep uart.send / writeBinary
ipcMain.handle('perform-update', async (event, pages, totalPages) => {
  if (!uart.isOpen()) throw new Error('UART not open');

  const win = BrowserWindow.fromWebContents(event.sender);
  let successCount = 0;

  try {
    // Step 1: Send UPFW1234 (no response expected)
    await uart.send('UPFW1234');
    win.webContents.send('update-progress', {
      current: 0,
      total: totalPages,
      text: 'Entering bootloader...'
    });
    await new Promise(resolve => setTimeout(resolve, 10));

    // Step 2: Send BLS repeatedly until 'OK' or 5s timeout
    const blsStart = Date.now();
    let blsResponse = null;

    while (Date.now() - blsStart < 5000) {
      try {
        // Try sending BLS with a short but reasonable timeout (e.g. 100ms)
        // If it times out, we just loop again
        const res = await queuedSendAndWait('BLS', line => line.trim() === 'OK', 20);
        if (res) {
          blsResponse = res;
          break;
        }
      } catch (e) {
        // Ignore timeout errors here, just retry
      }
      // Brief pause before next attempt
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    if (!blsResponse) throw new Error('Failed to enter bootloader: No OK response within 5s');

    win.webContents.send('update-progress', {
      current: 0,
      total: totalPages,
      text: 'Flashing pages...'
    });

    // Step 3: Flash each page
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      let attempts = 0;
      let pageSuccess = false;

      while (attempts < 3 && !pageSuccess) {
        attempts++;

        // 3.1: Send BLFxxx (xxx = page index as 3-digit HEX)
        const pageIndexHex = page.index.toString(16).toUpperCase().padStart(3, '0');
        await uart.send(`BLF${pageIndexHex}`);

        // 3.2: Wait 10ms
        await new Promise(resolve => setTimeout(resolve, 10));

        // 3.3: Send 256-byte binary stream
        await uart.writeBinary(page.data);

        // 3.4: Wait for response 'OK'
        const response = await queuedSendAndWait('', line => line.trim() === 'OK', 2000);
        if (response) {
          pageSuccess = true;
          successCount++;
        } else {
          console.warn(`Page ${page.index} attempt ${attempts} failed`);
          if (attempts < 3) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      }

      if (!pageSuccess) {
        throw new Error(`Failed to flash page ${page.index} after 3 attempts`);
      }

      win.webContents.send('update-progress', {
        current: successCount,
        total: totalPages,
        text: `Flashed page ${successCount}/${totalPages}`
      });
    }

    // Step 4: Verify each page with BLCxxx:yyyy
    win.webContents.send('update-progress', {
      current: 0,
      total: totalPages,
      text: 'Verifying pages...'
    });

    let verifyCount = 0;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      // 4.1: Calculate CRC16 for this page
      const crc = crc16(page.data); // see helper above
      const pageIndexHex = page.index.toString(16).toUpperCase().padStart(3, '0');
      const crcHex = crc.toString(16).toUpperCase().padStart(4, '0');

      // 4.2: Send BLCxxx:yyyy and wait for 'OK'
      const cmd = `BLC${pageIndexHex}:${crcHex}`;
      const verifyResp = await queuedSendAndWait(cmd, line => line.trim() === 'OK', 200);

      if (!verifyResp) {
        throw new Error(`Verification failed for page ${page.index} (CRC ${crcHex})`);
      }

      verifyCount++;
      win.webContents.send('update-progress', {
        current: verifyCount,
        total: totalPages,
        text: `Verified page ${verifyCount}/${totalPages}`
      });
    }

    // Step 5: Send BLQ to exit bootloader (no response)
    await uart.send('BLQ');

    win.webContents.send('update-progress', {
      current: totalPages,
      total: totalPages,
      text: 'Update complete'
    });
  } catch (err) {
    console.error('Firmware update error:', err);
    //throw new Error(`Firmware update failed: ${err.message}`);
    throw err;
  }

  return true;
});

ipcMain.handle('perform-upload', async (event, pages, totalPages) => {
  if (!uart.isOpen()) throw new Error('UART not open');

  const win = BrowserWindow.fromWebContents(event.sender);
  let successCount = 0;

  try {
    win.webContents.send('update-progress', {
      current: 0,
      total: totalPages,
      text: 'Entering bootloader...'
    });

    // Step 1: Send BLS repeatedly until 'OK' or 5s timeout
    // (No UPFW command sent here)
    const blsStart = Date.now();
    let blsResponse = null;

    while (Date.now() - blsStart < 5000) {
      try {
        // Short timeout 100ms as requested
        const res = await queuedSendAndWait('BLS', line => line.trim() === 'OK', 100);
        if (res) {
          blsResponse = res;
          break;
        }
      } catch (e) {
        // ignore timeout and retry
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    if (!blsResponse) throw new Error('Failed to enter bootloader: No OK response within 5s');

    win.webContents.send('update-progress', {
      current: 0,
      total: totalPages,
      text: 'Flashing pages...'
    });

    // Step 2: Flash each page
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      let attempts = 0;
      let pageSuccess = false;

      while (attempts < 3 && !pageSuccess) {
        attempts++;

        // Send BLFxx (2-digit hex index) - reusing logic from perform-update
        const pageIndexHex = page.index.toString(16).toUpperCase().padStart(2, '0');
        await uart.send(`BLF${pageIndexHex}`);
        await new Promise(resolve => setTimeout(resolve, 10));

        await uart.writeBinary(page.data);

        // Wait for response 'OK'
        const response = await queuedSendAndWait('', line => line.trim() === 'OK', 2000);
        
        if (response) {
          pageSuccess = true;
          successCount++;
        } else {
          console.warn(`Page ${page.index} attempt ${attempts} failed`);
          if (attempts < 3) await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      if (!pageSuccess) {
        throw new Error(`Failed to flash page ${page.index} after 3 attempts`);
      }

      win.webContents.send('update-progress', {
        current: successCount,
        total: totalPages,
        text: `Flashed page ${successCount}/${totalPages}`
      });
    }

    // Step 3: Verify each page with BLCxxx:yyyy
    win.webContents.send('update-progress', {
      current: 0,
      total: totalPages,
      text: 'Verifying pages...'
    });

    let verifyCount = 0;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      // 3.1: Calculate CRC16 for this page
      const crc = crc16(page.data); // see helper above
      const pageIndexHex = page.index.toString(16).toUpperCase().padStart(2, '0');
      const crcHex = crc.toString(16).toUpperCase().padStart(4, '0');

      // 3.2: Send BLCxxx:yyyy and wait for 'OK'
      const cmd = `BLC${pageIndexHex}:${crcHex}`;
      const verifyResp = await queuedSendAndWait(cmd, line => line.trim() === 'OK', 200);

      if (!verifyResp) {
        throw new Error(`Verification failed for page ${page.index} (CRC ${crcHex})`);
      }

      verifyCount++;
      win.webContents.send('update-progress', {
        current: verifyCount,
        total: totalPages,
        text: `Verified page ${verifyCount}/${totalPages}`
      });
    }
    
    // Step 4: Send BLQ (no response expected/checked usually, or check logic if needed)
    await uart.send('BLQ');

    win.webContents.send('update-progress', {
      current: totalPages,
      total: totalPages,
      text: 'Upload complete'
    });

  } catch (err) {
    console.error('HEX upload error:', err);
    throw err; // Let renderer catch it
  }

  return true;
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
//    queuedSendAndWait(cmd, () => true, timeoutMs)
//);
ipcMain.handle('uart-send-wait', async (_e, cmd, timeoutMs) => {
  try {
    const result = await queuedSendAndWait(cmd, () => true, timeoutMs || 3000);
    return result;
  } catch (error) {
    throw error;
  }
});

// ipc.js
// All ipcMain handlers extracted from main.js.
// Keep window creation functions in main.js and pass callbacks into registerIpc().

module.exports = function registerIpc(ctx) {
  const {
    ipcMain,
    BrowserWindow,
    dialog,
    fs,
    uart,
    deviceController,
    firmwareUpdater,
    createMainWindow,
    getSelectWindow,
    closeSelectWindow,
  } = ctx;

  // From starting window: user chose a port and clicked Connect
  ipcMain.on('port-selected', async (event, arg) => {
    const portPath = typeof arg === 'string' ? arg : arg?.portPath;
    const isRecovery = typeof arg === 'string' ? false : !!arg?.recovery;

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
      closeSelectWindow();
    } catch (err) {
      console.error('Connection failed:', err?.message || err);

      try { uart.close(); } catch (_) {}

      const msg = isRecovery ? 'Recovery open failed' : 'VPT not connected';

      const sw = getSelectWindow();
      if (sw && sw.webContents) sw.webContents.send('port-check-failed', msg);
      else event.sender.send('port-check-failed', msg);
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
    // Your code already prefers the controller method:
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

    return await deviceController.queuedSendAndWait(cmd, matcher, timeoutMs);
  });

  ipcMain.handle('send-raw-command', async (_event, { bytes }) => {
    if (!uart.isOpen()) throw new Error('UART not open');
    return await deviceController.sendRawCommand(bytes);
  });

  ipcMain.handle('send-text-command', async (_event, { cmd, prefix }) => {
    if (!uart.isOpen()) throw new Error('UART not open');
    return await deviceController.sendTextCommand(cmd, prefix);
  });

  ipcMain.handle('get-uart-instance', async (_event) => {
    // Keep as placeholder like in your file.
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
      return true;
    } catch (err) {
      console.error('Firmware update error:', err);
      throw err;
    }
  });

  ipcMain.handle('perform-upload', async (event, pages, totalPages) => {
    if (!uart.isOpen()) throw new Error('UART not open');

    const win = BrowserWindow.fromWebContents(event.sender);
    try {
      await firmwareUpdater.performUpload(win, pages, totalPages);
      return true;
    } catch (err) {
      console.error('HEX upload error:', err);
      throw err;
    }
  });

  // Filesystem Handlers
  ipcMain.handle('select-hex-file', async () => {
    return await dialog.showOpenDialog({
      filters: [{ name: 'Hex Files', extensions: ['hex'] }],
      properties: ['openFile'],
    });
  });

  ipcMain.handle('read-file', async (_event, filePath) => {
    return fs.promises.readFile(filePath, 'utf-8');
  });

  ipcMain.handle('write-file', async (_event, { path: filePath, content }) => {
    await fs.promises.writeFile(filePath, content, 'utf8');
    return true;
  });

  ipcMain.handle('save-dialog', async (_event, options) => {
    const { canceled, filePath } = await dialog.showSaveDialog(options);
    return { canceled, filePath };
  });
};

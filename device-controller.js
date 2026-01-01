// device-controller.js
//const uart = require('./uart');

class PriorityLock {
  constructor() {
    this.locked = false;
    this.highPriorityQueue = []; // position, user commands
    this.lowPriorityQueue = []; // polling
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

class DeviceController {
  // constructor() {
    // this.uartLock = new PriorityLock();
  // }
  constructor(uartAdapter) {
      this.uart = uartAdapter || null; 
      this.uartLock = new PriorityLock();
  }  
  
  setUart(uartAdapter) {
      this.uart = uartAdapter;
  }  

  // --- Core Queueing Methods ---

  // High priority (default for all commands)
  async queuedSendAndWait(cmd, matcher, timeoutMs = 1000) {
    await this.uartLock.acquire('high');
    try {
      return await this.uart.sendAndWait(cmd, matcher, timeoutMs);
    } finally {
      this.uartLock.release();
    }
  }

  // Low priority (for polling only)
  async pollingRequest(cmd, matcher, timeoutMs = 1000) {
    await this.uartLock.acquire('low');
    try {
      return await this.uart.sendAndWait(cmd, matcher, timeoutMs);
    } finally {
      this.uartLock.release();
    }
  }

  async readLiveMetrics() {
      // This was previously an ipcMain handler in main.js
      const voltage = await this.readMonitorVoltage();
      const current = await this.readMonitorCurrent();
      const temp = await this.readMonitorTemperature();
      return { voltage, current, temp };
  }

  // --- Device API helpers ---

  // Helper for "Command -> Value" or "E.H"
  async _readFloatValue(cmd, prefix) {
    const resp = await this.pollingRequest(
      cmd,
      // Match "PREFIX:12.34" OR "E.H"
      line => line.startsWith(prefix + ':') || line === 'E.H',
      150 // Small timeout for live polling
    );

    const trimmed = resp.trim();
    if (trimmed === 'E.H') return null;

    const match = trimmed.match(new RegExp(`^${prefix}:(-?\\d+(\\.\\d+)?)$`));
    return match ? parseFloat(match[1]) : null;
  }

  async handshake() {
    const idResp = await this.queuedSendAndWait(
      'ID',
      line => line.trim() === 'VPT',
      800
    );
    const vnResp = await this.queuedSendAndWait(
      'VN',
      line => /^N:\d+\.\d+$/.test(line.trim()),
      800
    );
    const match = vnResp.trim().match(/^N:(\d+\.\d+)$/);
    const fwVersion = match ? match[1] : '00.00';
    return { idResp, vnResp, fwVersion };
  }

  async setInterface(type, cfg) {
    let siCmd = null;
    if (type === 'PWM') siCmd = 'SI1';
    else if (type === 'RS485') siCmd = 'SI2';
    else if (type === 'CAN') siCmd = 'SI3';
    else throw new Error('Unknown connection type: ' + type);

    const sendOk = async (cmd) => {
      return this.queuedSendAndWait(
        cmd,
        line => line.trim() === 'OK',
        800
      );
    };

    // 1) SIx
    await sendOk(siCmd);

    // 2) Type-specific config
    if (type === 'RS485') {
      const baud = cfg.baud;
      if (!baud) throw new Error('Missing RS485 baud');
      await sendOk('SB' + String(baud));

      const subtype = cfg.subtype;
      if (!subtype) throw new Error('Missing RS485 subtype');
      await sendOk('SSI' + String(subtype));

      const id = cfg.id;
      if (!id) throw new Error('Missing RS485 ID');
      await sendOk('SID' + String(id));
    } else if (type === 'CAN') {
      const bitrate = Number(cfg.bitrate);
      if (![125, 250, 500, 1000].includes(bitrate)) {
        throw new Error('Invalid CAN bitrate: ' + cfg.bitrate);
      }
      await sendOk('SB' + String(bitrate));

      const baseId = cfg.baseId;
      if (!baseId && baseId !== 0) throw new Error('Missing CAN base ID');
      await sendOk('SBI' + String(baseId));

      const id = cfg.id;
      if (!id) throw new Error('Missing CAN ID');
      await sendOk('SID' + String(id));
    }

    // 3) Current limit (optional)
    if (typeof cfg.current === 'number') {
      const curStr = cfg.current.toFixed(1);
      await sendOk('SCL' + curStr);
    }

    // 4) Power on
    await sendOk('PWR1');
  }

  async setPower(on) {
    const cmd = on ? 'PWR1' : 'PWR0';
    await this.queuedSendAndWait(cmd, line => line.trim() === 'OK', 800);
  }

  async setPosition(degrees) {
    const posStr = Number(degrees).toFixed(1);
    const cmd = 'DPR' + posStr;
    const resp = await this.queuedSendAndWait(
      cmd,
      line => line.trim().startsWith('PS:'),
      80
    );
    const m = resp.trim().match(/^PS:(-?\d+(\.\d+)?)$/);
    if (!m) throw new Error('Unexpected response format: ' + resp);
    return parseFloat(m[1]);
  }

  async readSupply() {
    const resp = await this.pollingRequest(
      'GUS',
      line => /^US:-?\d+\.\d+$/.test(line.trim()),
      100
    );
    const m = resp.trim().match(/^US:(-?\d+\.\d+)$/);
    return m ? parseFloat(m[1]) : null;
  }

  async readTemperature() {
    const resp = await this.pollingRequest(
      'GT',
      line => /^T:-?\d+\.\d+$/.test(line.trim()),
      100
    );
    const m = resp.trim().match(/^T:(-?\d+\.\d+)$/);
    return m ? parseFloat(m[1]) : null;
  }

  async readStatus() {
    const resp = await this.pollingRequest(
      'GS',
      line => /^S:\d+$/.test(line.trim()),
      100
    );
    const m = resp.trim().match(/^S:(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
  }
  
  async readMonitorVoltage() {
    return this._readFloatValue('GUM', 'UM');
  }

  async readMonitorCurrent() {
    return this._readFloatValue('GCS', 'CS');
  }

  async readMonitorTemperature() {
    return this._readFloatValue('GTS', 'TS');
  }  

  async readDevicePosition() {
    const resp = await this.queuedSendAndWait(
      'GPS',
      line => line.trim().startsWith('PS:'),
      800
    );
    const match = resp.trim().match(/^PS:(-?\d+\.\d+)$/);
    if (!match) throw new Error('Unexpected GPS response: ' + resp);
    return parseFloat(match[1]);
  }

  async writeByte(addr, byteVal) {
    const addrHex = addr.toString(16).toUpperCase().padStart(2, '0');
    const valHex = (byteVal & 0xFF).toString(16).toUpperCase().padStart(2, '0');
    const cmd = `WB${addrHex}:${valHex}`;
    await this.queuedSendAndWait(
      cmd,
      line => line.trim() === 'OK',
      800
    );
  }

  async writeParam(address, type, value) {
    // Ensure integer raw value
    let raw = Number(value);
    if (!Number.isFinite(raw)) {
      throw new Error('Invalid value for address ' + address);
    }
    raw = Math.trunc(raw);

    if (type === 'uint16' || type === 'int16') {
      const low = raw & 0xFF;
      const high = (raw >> 8) & 0xFF;
      await this.writeByte(address, low);
      await this.writeByte(address + 1, high);
    } else {
      await this.writeByte(address, raw);
    }
  }

  async readByte(address) {
    const addrHex = address.toString(16).toUpperCase().padStart(2, '0');
    const cmd = `RB${addrHex}`;
    const resp = await this.queuedSendAndWait(
      cmd,
      line => /^B:0x[0-9A-Fa-f]{2}$/.test(line.trim()),
      800
    );
    const m = resp.trim().match(/^B:0x([0-9A-Fa-f]{2})$/);
    if (!m) throw new Error('Bad RB response for address ' + address + ': ' + resp);
    return parseInt(m[1], 16); // numeric 0..255
  }

  async readAsciiRange(start, end) {
    const bytes = [];
    for (let a = start; a <= end; a++) {
      const b = await this.readByte(a);
      if (b === 0x00 || b === 0xFF) break; // terminator
      bytes.push(b);
    }
    const chars = bytes.map(b => String.fromCharCode(b));
    return chars.join('');
  }

  async sendRawCommand(bytes) {
    const hex = bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
    const cmd = 'RAW' + hex;
    const resp = await this.queuedSendAndWait(
      cmd,
      line => line.trim().length > 0,
      800
    );
    return resp.trim();
  }

  async sendTextCommand(cmd, prefix) {
    const matcher = line => {
      const t = line.trim();
      if (!t) return false;
      if (typeof prefix === 'string' && prefix.length > 0) {
        return t.startsWith(prefix);
      }
      return false;
    };
    return await this.queuedSendAndWait(cmd, matcher, 800);
  }

  // Used on app exit
  async shutdown() {
    if (!this.uart.isOpen()) {
      console.log('shutdown: UART not open, skipping PWR0');
      return;
    }
    console.log('shutdown: trying to send PWR0');
    try {
      await this.queuedSendAndWait(
        'PWR0',
        line => {
          console.log('shutdown got line:', line);
          return line.trim() === 'OK';
        },
        500
      );
      console.log('shutdown: PWR0 acknowledged');
    } catch (e) {
      console.error('shutdown: PWR0 failed:', e.message);
    }
    // now close UART once
    this.uart.close();
  }
}

//module.exports = new DeviceController();
module.exports = DeviceController;

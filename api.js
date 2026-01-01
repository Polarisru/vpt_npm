// src/renderer/js/api.js

// 1. Detect Environment
const isElectron = typeof navigator === 'object' && typeof navigator.userAgent === 'string' && navigator.userAgent.indexOf('Electron') >= 0;

let ipcRenderer;
let SerialPort; // Add SerialPort for listing ports in Electron
let DeviceController;
let CapSerial, CapFilesystem, Directory, Encoding;
let mobileController = null;

if (isElectron) {
    // --- ELECTRON MODE ---
    const electron = require('electron');
    ipcRenderer = electron.ipcRenderer;
    // Load SerialPort only in Electron for listing ports
    try {
        SerialPort = require('serialport').SerialPort;
    } catch (e) {
        console.warn('SerialPort module not found in renderer (normal if using context isolation)');
    }
} else {
    // --- CAPACITOR / MOBILE MODE ---
    DeviceController = require('./device-controller');
    const { Serial } = require('@adeunis/capacitor-serial');
    CapSerial = Serial;
    const { Filesystem, Directory: Dir, Encoding: Enc } = require('@capacitor/filesystem');
    CapFilesystem = Filesystem;
    Directory = Dir;
    Encoding = Enc;

    // ... (Keep your MobileUartAdapter class code here) ...
    class MobileUartAdapter {
        constructor() {
            this.isOpenFlag = false;
            this.emitter = new (require('events'))();
            CapSerial.registerReadCallback((res) => {
                if (res && res.data) this.emitter.emit('line', res.data);
            });
        }
        async open(path, baudRate) {
            try { await CapSerial.requestSerialPermissions(); } catch (e) {}
            await CapSerial.openConnection({ baudRate: baudRate || 115200, dtr: true, rts: true });
            this.isOpenFlag = true;
        }
        async close() {
            if (this.isOpenFlag) {
                await CapSerial.closeConnection();
                this.isOpenFlag = false;
            }
        }
        isOpen() { return this.isOpenFlag; }
        async send(cmd) {
            if (!this.isOpenFlag) return;
            await CapSerial.write({ data: '\x1B' + cmd + '\n' });
        }
        async sendAndWait(cmd, matcher, timeoutMs = 1000) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.emitter.off('line', listener);
                    reject(new Error('Timeout'));
                }, timeoutMs);
                const listener = (line) => {
                    if (matcher(line)) {
                        clearTimeout(timer);
                        this.emitter.off('line', listener);
                        resolve(line);
                    }
                };
                this.emitter.on('line', listener);
                this.send(cmd);
            });
        }
    }
    
    const adapter = new MobileUartAdapter();
    mobileController = new DeviceController(adapter);
}

module.exports = {
    // --- NEW METHODS FOR RENDERER.JS REFACTORING ---

    /**
     * Returns a list of available ports.
     * Electron: Returns real COM ports.
     * Mobile: Returns a single static "USB OTG" entry.
     */
    async listPorts() {
        if (isElectron) {
            if (!SerialPort) return [];
            return await SerialPort.list();
        } else {
            // Mobile always assumes one OTG device
            return [{ path: 'USB', friendlyName: 'USB OTG Device' }];
        }
    },

    /**
     * Handles the "Connect" action from the start screen.
     * Electron: Sends IPC to main process to connect and open window.
     * Mobile: Navigates to main.html (connection happens there).
     */
    async selectPort(portPath, isRecovery) {
        if (isElectron) {
            ipcRenderer.send('port-selected', { portPath, recovery: isRecovery });
        } else {
            // Mobile: Just navigate. Connection/Handshake happens in app.js
            window.location.href = 'main.html';
        }
    },

    /**
     * Listen for connection failures (Electron only).
     */
    onPortCheckFailed(callback) {
        if (isElectron) {
            ipcRenderer.on('port-check-failed', (event, message) => callback(message));
        }
    },

    // ---------------------------------------------------

    // ... (Keep all your existing API methods below: connInit, connPower, handshake, etc.) ...
    
    async handshake() {
        if (isElectron) return { fwVersion: '00.00' }; // Handled by main.js
        return mobileController.handshake();
    },

    async connInit(cfg) {
        if (isElectron) return ipcRenderer.invoke('conn-init', cfg);
        if (!mobileController.uart.isOpen()) {
            await mobileController.uart.open('USB', cfg.baud);
        }
        await mobileController.setInterface(cfg.type, cfg);
        return true;
    },

    // ... (rest of your existing methods: connPower, setPosition, etc.) ...
    async connPower(on) {
        if (isElectron) return ipcRenderer.invoke('conn-power', on);
        return mobileController.setPower(on);
    },
    async setPosition(degrees) {
        if (isElectron) return ipcRenderer.invoke('set-position', degrees);
        return mobileController.setPosition(degrees);
    },
    async readSupply() {
        if (isElectron) return ipcRenderer.invoke('read-supply');
        return mobileController.readSupply();
    },
    async readTemperature() {
        if (isElectron) return ipcRenderer.invoke('read-temperature');
        return mobileController.readTemperature();
    },
    async readStatus() {
        if (isElectron) return ipcRenderer.invoke('read-status');
        return mobileController.readStatus();
    },
    async readDevicePosition() {
        if (isElectron) return ipcRenderer.invoke('read-device-position');
        return mobileController.readDevicePosition();
    },
    async readLiveMetrics() {
        if (isElectron) return ipcRenderer.invoke('read-live-metrics');
        return mobileController.readLiveMetrics();
    },
    async writeParam(p) {
        if (isElectron) return ipcRenderer.invoke('write-param', p);
        const { address, type, value } = p;
        return mobileController.writeParam(address, type, value);
    },
    async readByte(addr) {
        if (isElectron) return ipcRenderer.invoke('read-byte', addr);
        return mobileController.readByte(addr);
    },
    async readAsciiRange(args) {
        if (isElectron) return ipcRenderer.invoke('read-ascii-range', args);
        const { start, end } = args;
        return mobileController.readAsciiRange(start, end);
    },
    async sendTextCommand(cmd, prefix) {
        if (isElectron) return ipcRenderer.invoke('send-text-command', { cmd, prefix });
        return mobileController.sendTextCommand(cmd, prefix);
    },
    async sendRawCommand(bytes) {
        if (isElectron) return ipcRenderer.invoke('send-raw-command', { bytes });
        return mobileController.sendRawCommand(bytes);
    },
    async performUpdate(pages, totalPages) {
        if (isElectron) return ipcRenderer.invoke('perform-update', pages, totalPages);
        throw new Error('Firmware update not supported on mobile yet');
    },
    async performUpload(pages, totalPages) {
        if (isElectron) return ipcRenderer.invoke('perform-upload', pages, totalPages);
        throw new Error('Upload not supported on mobile yet');
    },
    async readFile(path) {
        if (isElectron) return ipcRenderer.invoke('read-file', path);
        const ret = await CapFilesystem.readFile({ path, directory: Directory.Documents, encoding: Encoding.UTF8 });
        return ret.data;
    },
    async writeFile(path, content) {
        if (isElectron) return ipcRenderer.invoke('write-file', { path, content });
        await CapFilesystem.writeFile({ path, data: content, directory: Directory.Documents, encoding: Encoding.UTF8 });
    },
    async selectHexFile() {
        if (isElectron) return ipcRenderer.invoke('select-hex-file');
        return { canceled: true, filePaths: [] };
    },
    async saveDialog(opts) {
        if (isElectron) return ipcRenderer.invoke('save-dialog', opts);
        return { canceled: true };
    },
    on(channel, listener) {
        if (isElectron) ipcRenderer.on(channel, listener);
    },
    removeListener(channel, listener) {
        if (isElectron) ipcRenderer.removeListener(channel, listener);
    }
};

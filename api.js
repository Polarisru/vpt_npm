// src/renderer/js/api.js

// 1. Detect Environment Robustly
const isElectron = typeof navigator === 'object' && typeof navigator.userAgent === 'string' && navigator.userAgent.indexOf('Electron') >= 0;

let ipcRenderer;
let DeviceController;
let CapSerial, CapFilesystem, Directory, Encoding;
let mobileController = null;

if (isElectron) {
    // --- ELECTRON MODE ---
    // Ensure we require this exactly as your original file did
    const electron = require('electron');
    ipcRenderer = electron.ipcRenderer;
} else {
    // --- CAPACITOR / MOBILE MODE ---
    // Only load these if NOT in Electron
    DeviceController = require('./device-controller');
    
    // Capacitor Plugins
    const { Serial } = require('@adeunis/capacitor-serial');
    CapSerial = Serial;
    
    const { Filesystem, Directory: Dir, Encoding: Enc } = require('@capacitor/filesystem');
    CapFilesystem = Filesystem;
    Directory = Dir;
    Encoding = Enc;

    // Mobile UART Adapter
    class MobileUartAdapter {
        constructor() {
            this.isOpenFlag = false;
            this.emitter = new (require('events'))();
            
            // Setup listener
            CapSerial.registerReadCallback((res) => {
                if (res && res.data) {
                    this.emitter.emit('line', res.data);
                }
            });
        }

        async open(path, baudRate) {
            try {
                await CapSerial.requestSerialPermissions();
            } catch (e) { /* ignore or log */ }
            
            await CapSerial.openConnection({ 
                baudRate: baudRate || 115200,
                dtr: true, rts: true 
            });
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
    
    // Instantiate Controller immediately for mobile
    const adapter = new MobileUartAdapter();
    mobileController = new DeviceController(adapter);
}

// 2. Export API
module.exports = {
    // Connection
    async connInit(cfg) {
        if (isElectron) return ipcRenderer.invoke('conn-init', cfg);
        
        // Mobile
        if (!mobileController.uart.isOpen()) {
            await mobileController.uart.open('USB', cfg.baud);
        }
        await mobileController.setInterface(cfg.type, cfg);
        return true;
    },

    async connPower(on) {
        if (isElectron) return ipcRenderer.invoke('conn-power', on);
        return mobileController.setPower(on);
    },

    // Device Control
    async setPosition(degrees) {
        if (isElectron) return ipcRenderer.invoke('set-position', degrees);
        return mobileController.setPosition(degrees);
    },

    // --- RESTORED EXACT METHOD SIGNATURES ---
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
        // Note: Electron args were object { cmd, prefix }
        if (isElectron) return ipcRenderer.invoke('send-text-command', { cmd, prefix });
        // Mobile direct call
        return mobileController.sendTextCommand(cmd, prefix);
    },

    async sendRawCommand(bytes) { 
        // Note: Electron args were object { bytes }
        if (isElectron) return ipcRenderer.invoke('send-raw-command', { bytes });
        return mobileController.sendRawCommand(bytes);
    },

    // Firmware / Update
    async performUpdate(pages, totalPages) { 
        if (isElectron) return ipcRenderer.invoke('perform-update', pages, totalPages);
        // Mobile updater not implemented here yet
        throw new Error('Firmware update not supported on mobile yet');
    },

    async performUpload(pages, totalPages) { 
        if (isElectron) return ipcRenderer.invoke('perform-upload', pages, totalPages);
        throw new Error('Upload not supported on mobile yet');
    },

    // Filesystem
    async readFile(path) { 
        if (isElectron) return ipcRenderer.invoke('read-file', path);
        const ret = await CapFilesystem.readFile({
            path,
            directory: Directory.Documents,
            encoding: Encoding.UTF8
        });
        return ret.data;
    },

    async writeFile(path, content) { 
        if (isElectron) return ipcRenderer.invoke('write-file', { path, content });
        await CapFilesystem.writeFile({
            path,
            data: content,
            directory: Directory.Documents,
            encoding: Encoding.UTF8
        });
    },

    async selectHexFile() { 
        if (isElectron) return ipcRenderer.invoke('select-hex-file');
        // Mobile shim: Return dummy or implement file picker
        return { canceled: true, filePaths: [] };
    },

    async saveDialog(opts) { 
        if (isElectron) return ipcRenderer.invoke('save-dialog', opts);
        // Mobile shim
        return { canceled: true };
    },

    // Listeners
    on(channel, listener) { 
        if (isElectron) ipcRenderer.on(channel, listener);
    },

    removeListener(channel, listener) { 
        if (isElectron) ipcRenderer.removeListener(channel, listener);
    }
};

// src/renderer/js/api.js
const { ipcRenderer } = require('electron');

module.exports = {
  // Connection & Power
  async connInit(cfg) { return ipcRenderer.invoke('conn-init', cfg); },
  async connPower(on) { return ipcRenderer.invoke('conn-power', on); },

  // Device Control
  async setPosition(degrees) { return ipcRenderer.invoke('set-position', degrees); },
  
  // --- MISSING FUNCTIONS ADDED HERE ---
  async readSupply() { return ipcRenderer.invoke('read-supply'); },      // GUS
  async readTemperature() { return ipcRenderer.invoke('read-temperature'); }, // GT
  // ------------------------------------

  async readStatus() { return ipcRenderer.invoke('read-status'); },      // GS
  async readDevicePosition() { return ipcRenderer.invoke('read-device-position'); }, // GPS

  // Aggregated "Live Read" (GUM, GCS, GTS)
  async readLiveMetrics() { return ipcRenderer.invoke('read-live-metrics'); },

  // EEPROM / Parameters
  async writeParam(p) { return ipcRenderer.invoke('write-param', p); },
  async readByte(addr) { return ipcRenderer.invoke('read-byte', addr); },
  async readAsciiRange(args) { return ipcRenderer.invoke('read-ascii-range', args); },

  // Commands
  async sendTextCommand(cmd, prefix) { return ipcRenderer.invoke('send-text-command', { cmd, prefix }); },
  async sendRawCommand(bytes) { return ipcRenderer.invoke('send-raw-command', { bytes }); },

  // Firmware
  async performUpdate(pages, totalPages) { return ipcRenderer.invoke('perform-update', pages, totalPages); },
  async performUpload(pages, totalPages) { return ipcRenderer.invoke('perform-upload', pages, totalPages); },

  // Filesystem
  async readFile(path) { return ipcRenderer.invoke('read-file', path); },
  async writeFile(path, content) { return ipcRenderer.invoke('write-file', { path, content }); },
  async selectHexFile() { return ipcRenderer.invoke('select-hex-file'); },
  async saveDialog(opts) { return ipcRenderer.invoke('save-dialog', opts); },

  // Listeners
  on(channel, listener) { ipcRenderer.on(channel, listener); },
  removeListener(channel, listener) { ipcRenderer.removeListener(channel, listener); }
};

// src/renderer/js/info-manager.js
const api = require('./api');
const ui = require('./ui-utils');

class InfoManager {
  init() {
    this.bindAsciiRead('serialReadBtn', 'serialNumber', 0x100, 0x12F);
    this.bindAsciiRead('pnReadBtn', 'pnNumber', 0x130, 0x15F);
    this.bindAsciiRead('fwReadBtn', 'fwVersion', 0x160, 0x18F);
    this.bindAsciiRead('hwReadBtn', 'hwRevision', 0x190, 0x1BF);

    // Revision String
    const revBtn = document.getElementById('revReadBtn');
    if (revBtn) {
      revBtn.addEventListener('click', async () => {
        try {
          const resp = await api.sendTextCommand('GVS', 'VS'); // "VS:..."
          if (resp) {
            document.getElementById('revText').value = resp.slice(3).trim();
          }
        } catch (e) {
          ui.showError('Rev read failed: ' + e.message);
        }
      });
    }

    // Working Time
    const wtBtn = document.getElementById('wtReadBtn');
    if (wtBtn) {
      wtBtn.addEventListener('click', async () => {
        try {
          const resp = await api.sendTextCommand('GWT', 'WT'); // "WT:hhhh:mm:ss"
          if (resp) {
            document.getElementById('workingTime').value = resp.slice(3).trim();
          }
        } catch (e) {
          ui.showError('WT read failed: ' + e.message);
        }
      });
    }
  }

  bindAsciiRead(btnId, inputId, start, end) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    
    btn.addEventListener('click', async () => {
      try {
        const txt = await api.readAsciiRange({ start, end });
        const input = document.getElementById(inputId);
        if (input) input.value = txt.trim();
      } catch (e) {
        ui.showError('Read failed: ' + e.message);
      }
    });
  }
}

module.exports = InfoManager;

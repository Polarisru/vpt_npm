// src/renderer/js/monitor-manager.js
const api = require('./api');

class MonitorManager {
  init() {
    const readBtn = document.getElementById('readLiveBtn');
    if (readBtn) {
      readBtn.addEventListener('click', () => this.readLiveMetrics());
    }
  }

  async readLiveMetrics() {
    try {
      // Use the aggregated call for GUM/GCS/GTS
      const data = await api.readLiveMetrics();

      const fmt = (val) => (typeof val === 'number') ? val.toFixed(1) : '--.-';

      const voltEl = document.getElementById('voltageValue');
      const currEl = document.getElementById('currentValue');
      const tempEl = document.getElementById('temp1Value');
      // const temp2El = document.getElementById('temp2Value'); // If exists

      if (voltEl) {
        // Voltage: 1 decimal place (e.g. "12.5")
        voltEl.textContent = (typeof data.voltage === 'number') 
          ? data.voltage.toFixed(1) 
          : '--.-';
      }

      if (currEl) {
        // Current: 2 decimal places (e.g. "0.45")
        currEl.textContent = (typeof data.current === 'number') 
          ? data.current.toFixed(2) 
          : '--.--';
      }

      if (tempEl) {
        // Temperature: Integer (e.g. "45")
        tempEl.textContent = (typeof data.temp === 'number') 
          ? data.temp.toFixed(0) 
          : '--';
      }

    } catch (e) {
      console.error('Failed to read live data:', e);
      // Optional: clear fields on error
    }
  }
}

module.exports = MonitorManager;

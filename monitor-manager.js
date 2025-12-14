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

      if (voltEl) voltEl.textContent = fmt(data.voltage); // GUM
      if (currEl) currEl.textContent = fmt(data.current); // GCS
      if (tempEl) tempEl.textContent = fmt(data.temp);    // GTS

    } catch (e) {
      console.error('Failed to read live data:', e);
      // Optional: clear fields on error
    }
  }
}

module.exports = MonitorManager;

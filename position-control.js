// src/renderer/js/position-control.js
const api = require('./api');
const ui = require('./ui-utils');

class PositionControl {
  constructor() {
    this.sineTimer = null;
    this.sineStartTime = null;
    this.sineRunning = false;
    this.connManager = null; // Store reference
  }

  setConnectionManager(conn) {
    this.connManager = conn;
  }

  init() {
    // Slider
    const slider = document.getElementById('positionSlider');
    const label = document.getElementById('positionLabel');
    const minBtn = document.getElementById('positionMinBtn');
    const maxBtn = document.getElementById('positionMaxBtn');
    const devPosLabel = document.getElementById('devicePositionLabel');

    if (slider) {
      slider.addEventListener('input', () => {
        this.updateLabel();
        this.sendPosition(slider.value);
      });
    }

    if (minBtn && slider) {
      minBtn.addEventListener('click', () => {
        slider.value = slider.min;
        this.updateLabel();
        this.sendPosition(slider.value);
      });
    }

    if (maxBtn && slider) {
      maxBtn.addEventListener('click', () => {
        slider.value = slider.max;
        this.updateLabel();
        this.sendPosition(slider.value);
      });
    }

    if (label && slider) {
      label.addEventListener('click', () => {
        slider.value = '0';
        this.updateLabel();
        this.sendPosition(slider.value);
      });
    }

    if (devPosLabel) {
        devPosLabel.addEventListener('click', async () => {
            if (!this.isConnected()) return;
            try {
                const pos = await api.readDevicePosition();
                devPosLabel.textContent = pos.toFixed(1) + '°';
            } catch(e) {
                devPosLabel.textContent = '--.-°';
            }
        });
    }

    // Sine Wave
    const startStop = document.getElementById('sineStartStopBtn');
    if (startStop) {
        startStop.addEventListener('click', () => {
            if (this.sineRunning) this.stopSine();
            else this.startSine();
        });
    }

    // Raw Command
    const rawInput = document.getElementById('rawCommandInput');
    const rawBtn = document.getElementById('rawSendBtn');
    
    if (rawInput) {
        rawInput.addEventListener('input', () => {
            let v = rawInput.value.toUpperCase().replace(/[^0-9A-F]/g, '');
            v = v.match(/.{1,2}/g)?.join(' ') || '';
            rawInput.value = v;
        });
    }

    if (rawBtn) {
        rawBtn.addEventListener('click', () => this.sendRaw());
    }

    // Listen for connection type change
    document.addEventListener('conn-type-changed', (e) => {
        const type = e.detail;
        if (slider) {
            if (type === 'PWM') {
                slider.min = '-45'; slider.max = '45';
            } else {
                slider.min = '-170'; slider.max = '170';
            }
            // clamp
            const v = parseFloat(slider.value);
            let newVal = v;
            if (v < parseFloat(slider.min)) newVal = parseFloat(slider.min);
            if (v > parseFloat(slider.max)) newVal = parseFloat(slider.max);
            
            slider.value = newVal;
            
            // FIX: Do NOT dispatch 'input' event here, as it triggers a UART send.
            // Just update the label visually.
            this.updateLabel();
        }
    });
  }

  isConnected() {
      return this.connManager && this.connManager.isConnected;
  }

  updateLabel() {
      const slider = document.getElementById('positionSlider');
      const label = document.getElementById('positionLabel');
      if (slider && label) {
          label.textContent = parseFloat(slider.value).toFixed(1) + '°';
      }
  }

  async sendPosition(val) {
    // FIX: Check connection before sending
    if (!this.isConnected()) return;

    try {
        const degrees = parseFloat(val);
        const actual = await api.setPosition(degrees);
        const devPosLabel = document.getElementById('devicePositionLabel');
        if (devPosLabel) devPosLabel.textContent = actual.toFixed(1) + '°';
    } catch (e) {
        console.error('Set pos failed', e);
    }
  }

  startSine() {
    if (!this.isConnected()) {
        ui.showError('Not connected');
        return;
    }
    // ... existing startSine logic ...
    // (Ensure you copy the rest of startSine/stopSine/sendRaw from previous response)
    // ...
    const ampInput = document.getElementById('sineAmplitude');
    const freqInput = document.getElementById('sineFrequency');
    const offsetInput = document.getElementById('sineOffset');
    const waveSelect = document.getElementById('sineWaveform');
    const slider = document.getElementById('positionSlider');
    const btn = document.getElementById('sineStartStopBtn');

    if (!slider || !btn) return;

    let amp = parseFloat(ampInput?.value || '0');
    let freq = parseFloat(freqInput?.value || '0.1');
    let offset = parseFloat(offsetInput?.value || '0');
    const wave = waveSelect?.value || 'sine';

    if (amp < 0) amp = 0;
    if (freq < 0.1) freq = 0.1;

    if (ampInput) ampInput.disabled = true;
    if (freqInput) freqInput.disabled = true;
    if (offsetInput) offsetInput.disabled = true;
    if (waveSelect) waveSelect.disabled = true;

    this.sineRunning = true;
    this.sineStartTime = performance.now();
    btn.textContent = 'Stop';

    this.sineTimer = setInterval(() => {
        const t = (performance.now() - this.sineStartTime) / 1000;
        const phase = (freq * t) % 1;
        let val = 0;

        if (wave === 'sine') val = Math.sin(2 * Math.PI * phase);
        else if (wave === 'rect') val = phase < 0.5 ? 1 : -1;
        else if (wave === 'saw') val = 2 * phase - 1;
        else if (wave === 'tri') val = phase < 0.5 ? (-1 + 4 * phase) : (3 - 4 * phase);

        const angle = offset + amp * val;
        slider.value = angle.toFixed(1);
        
        // Use updateLabel and sendPosition explicitly
        this.updateLabel();
        this.sendPosition(slider.value);
    }, 20);
  }

  stopSine() {
    clearInterval(this.sineTimer);
    this.sineTimer = null;
    this.sineRunning = false;

    const btn = document.getElementById('sineStartStopBtn');
    if (btn) btn.textContent = 'Start';

    ['sineAmplitude', 'sineFrequency', 'sineOffset', 'sineWaveform'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = false;
    });
  }

  async sendRaw() {
    if (!this.isConnected()) {
        ui.showError('Not connected');
        return;
    }
    const input = document.getElementById('rawCommandInput');
    const output = document.getElementById('rawCommandResponse');
    if (!input) return;

    // Clean and parse
    const clean = input.value.replace(/[^0-9A-F]/g, '');
    if (clean.length % 2 !== 0) {
        ui.showError('Invalid Hex string (odd length)');
        return;
    }
    const bytes = [];
    for (let i = 0; i < clean.length; i += 2) {
        bytes.push(parseInt(clean.slice(i, i+2), 16));
    }

    // --- 1. Validation Logic ---
    const connTypeEl = document.getElementById('connType');
    const type = connTypeEl ? connTypeEl.value : 'PWM';

    if (type === 'CAN') {
        if (bytes.length < 1 || bytes.length > 8) {
            ui.showError('CAN raw command must be 1 to 8 bytes');
            return;
        }
    } else {
        // RS485 / PWM / UART
        if (bytes.length !== 4) {
            ui.showError('Raw command must be exactly 4 bytes');
            return;
        }
    }
    // ---------------------------

    try {
        const resp = await api.sendRawCommand(bytes);

        // --- 2. Error Response Handling ---
        // If the backend returns an error string like "E.H", throw or show error.
        // Assuming "E.H" means "Error Hex" or similar invalid command.
        if (resp.includes('E.') || resp.includes('Error')) {
             ui.showError('Device returned error: ' + resp);
             if (output) output.value = resp; // Optionally show it
        } else {
             if (output) {
                 const formatted = resp.match(/.{1,2}/g)?.join(' ') || resp;
                 output.value = formatted;
             }
        }
        // ----------------------------------

    } catch (e) {
        // If sendRawCommand throws (e.g. timeout or NACK)
        ui.showError('Raw command failed: ' + ui.formatError(e));
    }
  }
}

module.exports = PositionControl;

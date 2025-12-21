// src/renderer/js/connection-manager.js
const api = require('./api');
const ui = require('./ui-utils');

class ConnectionManager {
  constructor() {
    this.isConnected = false;
    this.statusTimer = null;
    this.pollStep = 0;
    this.missedPolls = 0;
    this.MAX_MISSED_POLLS = 6;
    this.POLL_INTERVAL_MS = 500;
  }

  init() {
    const connectBtn = document.getElementById('connectBtn');
    const connType = document.getElementById('connType');

    // 1. Setup ID Dropdowns (MISSING IN PREVIOUS VERSION)
    this.setupIdDropdowns();

    if (connectBtn) {
      connectBtn.addEventListener('click', () => this.handleConnectClick());
    }

    if (connType) {
      connType.addEventListener('change', () => this.updateInterface(connType.value));
      // Initialize view
      this.updateInterface(connType.value);
    }

    // Set up listeners for CAN base ID formatting
    this.setupCanBaseIdInput();
  }

  setupIdDropdowns() {
    // Populate RS485 IDs (1..31)
    const rs485Id = document.getElementById('rs485-id');
    if (rs485Id && rs485Id.options.length <= 1) { // Check if not already populated
      rs485Id.innerHTML = ''; // Clear defaults if any
      for (let i = 1; i <= 31; i++) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = String(i);
        rs485Id.appendChild(opt);
      }
    }

    // Populate CAN IDs (1..15)
    const canId = document.getElementById('can-id');
    if (canId && canId.options.length <= 1) {
      canId.innerHTML = '';
      for (let i = 1; i <= 15; i++) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = String(i);
        canId.appendChild(opt);
      }
    }
  }

  setupCanBaseIdInput() {
    const canBaseIdInput = document.getElementById('can-base-id');
    if (!canBaseIdInput) return;

    let baseVal = 0x3E0 & ~0x1F;
    canBaseIdInput.value = baseVal.toString(16).toUpperCase();

    canBaseIdInput.addEventListener('blur', () => {
      let v = canBaseIdInput.value.toUpperCase().replace(/[^0-9A-F]/g, '');
      if (v === '') {
        canBaseIdInput.value = baseVal.toString(16).toUpperCase();
        return;
      }
      let num = parseInt(v, 16);
      if (isNaN(num)) num = baseVal;
      if (num > 0x7E0) num = 0x7E0;
      if (num < 0) num = 0;
      num &= ~0x1F;
      baseVal = num;
      canBaseIdInput.value = num.toString(16).toUpperCase();
    });
  }

  updateInterface(type) {
    const rs485 = document.getElementById('rs485-settings');
    const can = document.getElementById('can-settings');
    const infoBlock = document.getElementById('infoBlock');
    const rawBlock = document.getElementById('rawBlock');
    const revBlock = document.getElementById('revBlock');

    if (rs485) rs485.classList.add('hidden');
    if (can) can.classList.add('hidden');

    if (type === 'RS485') {
      if (rs485) rs485.classList.remove('hidden');
    } else if (type === 'CAN') {
      if (can) can.classList.remove('hidden');
    }

    const showExtras = (type === 'RS485' || type === 'CAN');
    if (infoBlock) infoBlock.style.display = showExtras ? 'block' : 'none';
    if (rawBlock) rawBlock.style.display = showExtras ? 'block' : 'none';
    if (revBlock) revBlock.style.display = showExtras ? 'block' : 'none';
    
    // Trigger event for other modules (like EepromManager) to update device list
    document.dispatchEvent(new CustomEvent('conn-type-changed', { detail: type }));
  }

  async handleConnectClick() {
    if (!this.isConnected) {
      await this.connect();
    } else {
      await this.disconnect();
    }
  }

  async connect() {
    const cfg = this.collectConfig();
    try {
      await api.connInit(cfg);
      this.isConnected = true;
      this.startPolling();
      this.updateUiState(true);
      
      const hint = document.getElementById('connectionHint');
      if (hint) {
        hint.textContent = 'Connected';
        hint.style.color = 'green';
        hint.style.fontWeight = 'normal';
      }
      
      //const overlay = document.getElementById('contentOverlay');
      //if (overlay) overlay.classList.add('hidden');
      console.log('Connecting...');
      const welcomeScreen = document.getElementById('welcome-screen');
      const mainContent   = document.getElementById('main-content');
      welcomeScreen.style.display = 'none';
      mainContent.style.display   = 'grid';
    } catch (e) {
      console.error('Connection init failed:', e);
      ui.showError('Connection init failed: ' + ui.formatError(e));
      const hint = document.getElementById('connectionHint');
      if (hint) {
        hint.textContent = 'Connection failed';
        hint.style.color = 'red';
        hint.style.fontWeight = 'bold';
      }
    }
  }

  async disconnect() {
    this.stopPolling();
    try {
      await api.connPower(false);
    } catch (e) {
      console.error('PWR0 failed:', e);
    }

    this.isConnected = false;
    this.updateUiState(false);

    const hint = document.getElementById('connectionHint');
    if (hint) {
      hint.textContent = 'Select connection type and press Connect';
      hint.style.color = '';
      hint.style.fontWeight = 'normal';
    }

    //const overlay = document.getElementById('contentOverlay');
    //if (overlay) overlay.classList.remove('hidden');
    console.log('Disconnecting...');
    const welcomeScreen = document.getElementById('welcome-screen');
    const mainContent   = document.getElementById('main-content');
    welcomeScreen.style.display = 'flex';
    mainContent.style.display   = 'none';
  }

  collectConfig() {
    const connType = document.getElementById('connType').value;
    const cfg = { type: connType };
    
    const currentEl = document.getElementById('currentLimit');
    if (currentEl) {
      const val = parseFloat(currentEl.value || '0');
      if (Number.isFinite(val)) cfg.current = val;
    }

    if (connType === 'RS485') {
      cfg.baud = document.getElementById('rs485-baud').value;
      cfg.id = document.getElementById('rs485-id').value;
      cfg.subtype = document.getElementById('rs485-subtype').value;
    } else if (connType === 'CAN') {
      cfg.bitrate = document.getElementById('can-bitrate').value;
      cfg.id = document.getElementById('can-id').value;
      const baseEl = document.getElementById('can-base-id');
      if (baseEl) cfg.baseId = baseEl.value;
    }
    return cfg;
  }

  updateUiState(connected) {
    const btn = document.getElementById('connectBtn');
    if (btn) btn.textContent = connected ? 'Disconnect' : 'Connect';

    const updateBtn = document.getElementById('updateBtn');
    if (updateBtn) updateBtn.disabled = connected;

    // Disable sidebar inputs
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      const controls = sidebar.querySelectorAll('select, input, button');
      controls.forEach(el => {
        if (el.id !== 'connectBtn') el.disabled = connected;
      });
    }
  }

  startPolling() {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = setInterval(() => this.poll(), this.POLL_INTERVAL_MS);
  }

  stopPolling() {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
    const supplyVal = document.getElementById('supplyValue');
    if (supplyVal) supplyVal.textContent = '--.-';
    const tempVal = document.getElementById('temperatureValue');
    if (tempVal) tempVal.textContent = '--.-';
  }

  async poll() {
    if (!this.isConnected) return;

    try {
      switch (this.pollStep) {
        // STEP 0: Voltage (GUS)
        case 0:
          const v = await api.readSupply(); // GUS
          const vEl = document.getElementById('supplyValue');
          if (vEl) vEl.textContent = (typeof v === 'number') ? v.toFixed(1) : '--.-';
          this.missedPolls = 0;
          break;

        // STEP 1: Temperature (GT)
        case 1:
          const t = await api.readTemperature(); // GT
          const tEl = document.getElementById('temperatureValue');
          if (tEl) tEl.textContent = (typeof t === 'number') ? t.toFixed(1) : '--.-';
          this.missedPolls = 0;
          break;

        // STEP 2: Status (GS)
        case 2:
          const s = await api.readStatus(); // GS
          if (s !== null) {
            this.missedPolls = 0;
            if ((s & 0x01) !== 0) {
              console.warn('Device reset detected');
              await this.disconnect();
              ui.showError('Device reset or not configured. Connection closed.');
            } else {
               const hint = document.getElementById('connectionHint');
               if (hint) {
                   const displayStatus = s & ~0x01;
                   if(displayStatus === 0) {
                       hint.textContent = 'Connected';
                       hint.style.color = 'green';
                   } else {
                       hint.textContent = 'ERROR Code: ' + displayStatus;
                       hint.style.color = 'red';
                   }
               }
            }
          } else {
            this.missedPolls++;
          }
          break;
      }
      
      // Cycle step
      this.pollStep = (this.pollStep + 1) % 3;

    } catch (e) {
      console.error('Poll step ' + this.pollStep + ' failed', e);
      this.missedPolls++;
    }

    if (this.missedPolls >= this.MAX_MISSED_POLLS) {
      console.warn('Max missed polls. Disconnecting.');
      await this.disconnect();
      ui.showError('Device not responding. Connection closed.');
      this.missedPolls = 0;
    }
  }

  updateStatusFields(data) {
    const vEl = document.getElementById('supplyValue');
    const cEl = document.getElementById('currentValue');
    const tEl = document.getElementById('temp1Value');
    // const t2El = document.getElementById('temp2Value'); // if you have it

    const fmt = (val) => (typeof val === 'number') ? val.toFixed(1) : '--.-';

    if (vEl) vEl.textContent = fmt(data.voltage);
    if (cEl) cEl.textContent = fmt(data.current);
    if (tEl) tEl.textContent = fmt(data.temp);
  }
}

module.exports = ConnectionManager;

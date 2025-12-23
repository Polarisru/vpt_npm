// src/renderer/js/eeprom-manager.js
const fs = require('fs');
const path = require('path');
const api = require('./api');
const ui = require('./ui-utils');

class EepromManager {
  constructor() {
    this.allDevices = [];
    this.currentDevice = null;
  }

  init() {
    this.loadDevicesJson();

    const devSelect = document.getElementById('deviceSelect');
    //if (devSelect) {
    //  devSelect.addEventListener('change', () => this.handleDeviceSelect(devSelect.value));
    //}
    if (devSelect) {
      devSelect.addEventListener('change', (e) => {
        console.log('Selection changed to:', e.target.value);  // Debug
        this.handleDeviceSelect(e.target.value);
      });
    }    

    // Listen to connection type changes to filter the list
    document.addEventListener('conn-type-changed', (e) => {
      this.fillDeviceSelect(e.detail);
    });

    // Initial fill
    const connType = document.getElementById('connType');
    if (connType) this.fillDeviceSelect(connType.value);

    // Buttons
    document.getElementById('readParamsBtn')?.addEventListener('click', () => this.readParams());
    document.getElementById('writeParamsBtn')?.addEventListener('click', () => this.writeParams());
    document.getElementById('saveToFileBtn')?.addEventListener('click', () => this.saveToFile());
    document.getElementById('loadFromFileBtn')?.addEventListener('click', () => this.loadFromFile());
    
    const loadInput = document.getElementById('loadFileInput');
    if (loadInput) loadInput.addEventListener('change', () => this.handleFileSelect(loadInput));
  }

  loadDevicesJson() {
    try {
      //const jsonPath = path.join(__dirname, '../../devices.json');
      // Let's assume it is in the same folder as main.html
      const p = path.join(process.cwd(), 'devices.json'); 
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        this.allDevices = JSON.parse(raw).devices || [];
      } else {
          // Fallback if running from a different context
          console.warn('devices.json not found at', p);
      }
    } catch (e) {
      console.error('Failed to load devices.json:', e);
      this.allDevices = [];
    }
  }

  fillDeviceSelect(type) {
    const deviceSelect = document.getElementById('deviceSelect');
    if (!deviceSelect) return;

    deviceSelect.innerHTML = '<option value="">Select device…</option>';
    const filtered = this.allDevices.filter(d => d.type === type);
    
    filtered.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.name;
      opt.textContent = d.name;
      deviceSelect.appendChild(opt);
    });
    
    // Reset table
    this.clearParamTable();
    this.setRightButtonsEnabled(false);
  }

  handleDeviceSelect(name) {
    // clear the table first
    this.clearParamTable();
    const dev = this.allDevices.find(d => d.name === name);
    if (dev) {
      this.buildParamTable(dev);
      this.setRightButtonsEnabled(true);
    } else {
      this.setRightButtonsEnabled(false);
    }
  }


  setRightButtonsEnabled(enabled) {
    ['readParamsBtn', 'writeParamsBtn', 'saveToFileBtn', 'loadFromFileBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !enabled;
    });
  }

  clearParamTable() {
    const tbody = document.querySelector('#paramTable tbody');
    if (tbody) tbody.innerHTML = '';
  }

  buildParamTable(device) {
    this.currentDevice = device;
    const tbody = document.querySelector('#paramTable tbody');
    if (!tbody || !device.eeprom) return;
    tbody.innerHTML = '';

    device.eeprom.forEach(param => {
      const tr = document.createElement('tr');
      
      const nameTd = document.createElement('td');
      nameTd.textContent = param.unit ? `${param.name}, ${param.unit}` : param.name;
      
      const valueTd = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'number';
      
      const mult = (param.mult || 1);
      const div = (param.div || 1);
      const offset = (param.offset || 0);

      input.dataset.address = param.address;
      input.dataset.type = param.type;
      input.dataset.name = param.name;
      input.dataset.mult = mult;
      input.dataset.div = div;
      input.dataset.offset = offset;
      if (param.min !== undefined) input.dataset.min = param.min;
      if (param.max !== undefined) input.dataset.max = param.max;

      // Default value
      if (typeof param.dflt !== 'undefined') {
        const displayVal = this.rawToDisplay(param.dflt, mult, div, offset);
        input.value = displayVal;
      }

      // Input validation on blur
      input.addEventListener('blur', () => {
         let val = parseFloat(input.value);
         if (isNaN(val)) return; 
         // Logic to clamp based on raw min/max could go here
         // For now, just keeping the value
      });

      valueTd.appendChild(input);
      tr.appendChild(nameTd);
      tr.appendChild(valueTd);
      tbody.appendChild(tr);
    });
  }
  
  rawToDisplay(raw, mult, div, offset) {
    const scaled = raw / mult;
    return (scaled / div) + offset;
  }

  displayToRaw(display, mult, div, offset) {
    const scaled = (display - offset) * div;
    return scaled * mult;
  }

  async readParams() {
    const inputs = document.querySelectorAll('#paramTable tbody input');
    if (!inputs.length) return;

    const btn = document.getElementById('readParamsBtn');
    if(btn) btn.disabled = true;
    ui.showProgress('Reading EEPROM', 'Please wait...');

    try {
      let count = 0;
      for (const inp of inputs) {
        const addr = Number(inp.dataset.address);
        const type = inp.dataset.type;
        
        let raw = await api.readByte(addr);
        if (type === 'uint16' || type === 'int16') {
          const high = await api.readByte(addr + 1);
          raw = (high << 8) | raw;
          if (type === 'int16' && raw >= 0x8000) raw -= 0x10000;
        }

        const mult = Number(inp.dataset.mult);
        const div = Number(inp.dataset.div);
        const offset = Number(inp.dataset.offset);
        
        inp.value = String(this.rawToDisplay(raw, mult, div, offset));
        
        count++;
        ui.updateProgress(count, inputs.length);
      }
    } catch (e) {
      console.error(e);
      ui.showError('Read failed: ' + ui.formatError(e));
    } finally {
      ui.hideProgress();
      if(btn) btn.disabled = false;
    }
  }

  async writeParams() {
    const inputs = document.querySelectorAll('#paramTable tbody input');
    if (!inputs.length) return;

    const btn = document.getElementById('writeParamsBtn');
    if(btn) btn.disabled = true;
    ui.showProgress('Writing EEPROM', 'Please wait...');

    try {
      let count = 0;
      for (const inp of inputs) {
        const addr = Number(inp.dataset.address);
        const type = inp.dataset.type;
        const mult = Number(inp.dataset.mult);
        const div = Number(inp.dataset.div);
        const offset = Number(inp.dataset.offset);
        
        const displayVal = parseFloat(inp.value || '0');
        const raw = this.displayToRaw(displayVal, mult, div, offset);

        await api.writeParam({ address: addr, type, value: raw });
        
        count++;
        ui.updateProgress(count, inputs.length);
      }
      console.log('Write complete');
    } catch (e) {
      console.error(e);
      ui.showError('Write failed: ' + ui.formatError(e));
    } finally {
      ui.hideProgress();
      if(btn) btn.disabled = false;
    }
  }

  saveToFile() {
    const inputs = document.querySelectorAll('#paramTable tbody input');
    const params = Array.from(inputs).map(inp => {
        const mult = Number(inp.dataset.mult);
        const div = Number(inp.dataset.div);
        const offset = Number(inp.dataset.offset);
        const displayVal = Number(inp.value);
        const raw = this.displayToRaw(displayVal, mult, div, offset);

        return {
            name: inp.dataset.name,
            address: Number(inp.dataset.address),
            value: raw
        };
    });

    const data = {
        device: document.getElementById('deviceSelect').value,
        params
    };
    
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `params-${data.device}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  loadFromFile() {
    const input = document.getElementById('loadFileInput');
    if (input) {
        input.value = '';
        input.click();
    }
  }

  handleFileSelect(input) {
    const file = input.files && input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            if (!data.params) throw new Error('Invalid JSON');
            
            const inputs = document.querySelectorAll('#paramTable tbody input');
            data.params.forEach(p => {
                const match = Array.from(inputs).find(
                    inp => inp.dataset.name === p.name && Number(inp.dataset.address) === p.address
                );
                
                if (match) {
                    const mult = Number(match.dataset.mult);
                    const div = Number(match.dataset.div);
                    const offset = Number(match.dataset.offset);
                    match.value = String(this.rawToDisplay(p.value, mult, div, offset));
                }
            });
        } catch (e) {
            ui.showError('Load failed: ' + e.message);
        }
    };
    reader.readAsText(file);
  }
}

module.exports = EepromManager;

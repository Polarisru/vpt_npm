// main-renderer.js

const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');

let allDevices = [];
let currentConnType = 'PWM';

// ---------- Helpers ----------

function collectConnectionConfig() {
  const connType = document.getElementById('connType').value;
  const cfg = { type: connType };

  if (connType === 'RS485') {
    cfg.baud = document.getElementById('rs485-baud').value;
    cfg.id = document.getElementById('rs485-id').value;
  } else if (connType === 'CAN') {
    cfg.bitrate = document.getElementById('can-bitrate').value;
    cfg.id = document.getElementById('can-id').value;
  }

  return cfg;
}

function fillDeviceSelectForType(type) {
  const deviceSelect = document.getElementById('deviceSelect');
  if (!deviceSelect) return;
  deviceSelect.innerHTML = '<option value="">Select device…</option>';

  const filtered = allDevices.filter(d => d.type === type);
  filtered.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.name;
    opt.textContent = d.name;
    deviceSelect.appendChild(opt);
  });
}

function clearParamTable() {
  const tbody = document.querySelector('#paramTable tbody');
  if (tbody) tbody.innerHTML = '';
}

function buildParamTable(device) {
  const tbody = document.querySelector('#paramTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!device || !Array.isArray(device.eeprom)) {
    return;
  }

  device.eeprom.forEach(param => {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.textContent = param.name;

    const valueTd = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';

    if (typeof param.min === 'number') input.min = param.min;
    if (typeof param.max === 'number') input.max = param.max;
    if (typeof param.dflt !== 'undefined') input.value = param.dflt;

    input.dataset.address = param.address;
    input.dataset.type = param.type;
    input.dataset.min = param.min;
    input.dataset.max = param.max;
    input.dataset.name = param.name;

    input.addEventListener('input', () => {
      const min = Number(input.dataset.min);
      const max = Number(input.dataset.max);
      let val = input.value === '' ? NaN : Number(input.value);

      if (!isNaN(val)) {
        if (!isNaN(min) && val < min) val = min;
        if (!isNaN(max) && val > max) val = max;
        input.value = String(val);
      }
    });

    input.addEventListener('blur', () => {
      const min = Number(input.dataset.min);
      const max = Number(input.dataset.max);
      let val = input.value === '' ? NaN : Number(input.value);

      if (isNaN(val)) {
        if (typeof param.dflt !== 'undefined') {
          val = param.dflt;
        } else if (!isNaN(min)) {
          val = min;
        } else if (!isNaN(max)) {
          val = max;
        } else {
          return;
        }
      }

      if (!isNaN(min) && val < min) val = min;
      if (!isNaN(max) && val > max) val = max;

      input.value = String(val);
    });

    valueTd.appendChild(input);
    tr.appendChild(nameTd);
    tr.appendChild(valueTd);
    tbody.appendChild(tr);
  });
}

// left sidebar enable/disable (except Connect)
function setSidebarEnabled(enabled) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const controls = sidebar.querySelectorAll('select, input, button');
  controls.forEach(el => {
    if (el.id === 'connectBtn') return;
    el.disabled = !enabled;
  });
}

// right-panel 4 buttons
function getRightButtons() {
  return [
    document.getElementById('readParamsBtn'),
    document.getElementById('writeParamsBtn'),
    document.getElementById('saveToFileBtn'),
    document.getElementById('loadFromFileBtn')
  ];
}

function setRightButtonsEnabled(enabled) {
  getRightButtons().forEach(btn => {
    if (btn) btn.disabled = !enabled;
  });
}

// collect param values from table
function collectCurrentParams() {
  const inputs = document.querySelectorAll('#paramTable tbody input');
  return Array.from(inputs).map(inp => ({
    name: inp.dataset.name,
    address: Number(inp.dataset.address),
    type: inp.dataset.type,
    min: Number(inp.dataset.min),
    max: Number(inp.dataset.max),
    value: Number(inp.value)
  }));
}

// download JSON from renderer
function downloadJsonFile(filename, jsonStr) {
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// random text helper for info-block fields
function randomText(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

// ---------- DOM Init ----------

document.addEventListener('DOMContentLoaded', () => {
  const rs485Id = document.getElementById('rs485-id');
  const canId = document.getElementById('can-id');
  const connType = document.getElementById('connType');
  const rs485Settings = document.getElementById('rs485-settings');
  const canSettings = document.getElementById('can-settings');
  const deviceSelect = document.getElementById('deviceSelect');

  const slider = document.getElementById('positionSlider');
  const positionLabel = document.getElementById('positionLabel');
  const positionMinBtn = document.getElementById('positionMinBtn');
  const positionMaxBtn = document.getElementById('positionMaxBtn');

  const connectBtn = document.getElementById('connectBtn');
  const readBtn = document.getElementById('readParamsBtn');
  const writeBtn = document.getElementById('writeParamsBtn');
  const saveBtn = document.getElementById('saveToFileBtn');
  const loadBtn = document.getElementById('loadFromFileBtn');
  const loadFileInput = document.getElementById('loadFileInput');
  const contentOverlay = document.getElementById('contentOverlay');
  const connectionHint = document.getElementById('connectionHint');

  const currentValueEl = document.getElementById('currentValue');
  const voltageValueEl = document.getElementById('voltageValue');
  const temp1ValueEl = document.getElementById('temp1Value');
  const temp2ValueEl = document.getElementById('temp2Value');
  const readLiveBtn = document.getElementById('readLiveBtn');

  const infoBlock = document.getElementById('infoBlock');
  const serialInput = document.getElementById('serialNumber');
  const fwInput = document.getElementById('fwVersion');
  const hwInput = document.getElementById('hwRevision');
  const pnInput = document.getElementById('pnNumber');
  const serialReadBtn = document.getElementById('serialReadBtn');
  const fwReadBtn = document.getElementById('fwReadBtn');
  const hwReadBtn = document.getElementById('hwReadBtn');
  const pnReadBtn = document.getElementById('pnReadBtn');

  const sineAmpInput = document.getElementById('sineAmplitude');
  const sineFreqInput = document.getElementById('sineFrequency');
  const sineStartStop = document.getElementById('sineStartStopBtn');
  const sineWaveform = document.getElementById('sineWaveform');

  const fwFileName  = document.getElementById('fwFileName');
  const fwBrowseBtn = document.getElementById('fwBrowseBtn');
  const fwFileInput = document.getElementById('fwFileInput');
  const fwUploadBtn = document.getElementById('fwUploadBtn');

  let isConnected = false;

  // RS485 IDs
  if (rs485Id) {
    for (let i = 1; i <= 31; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = String(i);
      rs485Id.appendChild(opt);
    }
  }

  // CAN IDs
  if (canId) {
    for (let i = 1; i <= 15; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = String(i);
      canId.appendChild(opt);
    }
  }

  // connection type (only device list + table, not right buttons except reset)
  if (connType) {
    connType.addEventListener('change', () => {
      if (rs485Settings) rs485Settings.classList.add('hidden');
      if (canSettings) canSettings.classList.add('hidden');

      if (connType.value === 'RS485' && rs485Settings) {
        rs485Settings.classList.remove('hidden');
      }

      if (connType.value === 'CAN' && canSettings) {
        canSettings.classList.remove('hidden');
      }

      // show info only for RS485 and CAN
      if (infoBlock) {
        if (connType.value === 'RS485' || connType.value === 'CAN') {
          infoBlock.style.display = 'block';
        } else {
          infoBlock.style.display = 'none';
        }
      }

      currentConnType = connType.value;
      fillDeviceSelectForType(currentConnType);
      clearParamTable();
      if (deviceSelect) deviceSelect.value = '';
      setRightButtonsEnabled(false);
    });

    currentConnType = connType.value;

    // initial state on load
    if (infoBlock) {
      if (currentConnType === 'RS485' || currentConnType === 'CAN') {
        infoBlock.style.display = 'block';
      } else {
        infoBlock.style.display = 'none';
      }
    }
  }


  // slider + label + Min/Max + shared label updater
  let updatePositionLabel = null;

  if (slider && positionLabel) {
    updatePositionLabel = () => {
      positionLabel.textContent = slider.value + '°';
    };

    updatePositionLabel();

    slider.addEventListener('input', updatePositionLabel);

    if (positionMinBtn) {
      positionMinBtn.addEventListener('click', () => {
        slider.value = slider.min ?? '0';
        updatePositionLabel();
        slider.dispatchEvent(new Event('input'));
      });
    }

    if (positionMaxBtn) {
      positionMaxBtn.addEventListener('click', () => {
        slider.value = slider.max ?? '0';
        updatePositionLabel();
        slider.dispatchEvent(new Event('input'));
      });
    }
  }

  // --- Sinus/rectangle/sawtooth movement driving the slider ---
  let sineTimer = null;
  let sineStartTime = null;
  let sineRunning = false;

  function stopSine() {
    if (sineTimer) {
      clearInterval(sineTimer);
      sineTimer = null;
    }
    sineRunning = false;
    if (sineStartStop) sineStartStop.textContent = 'Start';
    // re-enable controls
    if (sineWaveform) sineWaveform.disabled = false;
    if (sineAmpInput) sineAmpInput.disabled = false;
    if (sineFreqInput) sineFreqInput.disabled = false;
  }

  if (sineStartStop && slider && updatePositionLabel) {
    sineStartStop.addEventListener('click', () => {
      if (!sineRunning) {
        // Start
        let amp = parseFloat(sineAmpInput?.value || '0');
        let freq = parseFloat(sineFreqInput?.value || '0');
        let wave = sineWaveform?.value || 'sine';

        if (!Number.isFinite(amp) || amp < 0) amp = 0;
        if (!Number.isFinite(freq) || freq < 0.1) freq = 0.1;

        // Clamp amplitude to slider range
        const minVal = parseFloat(slider.min ?? '-90');
        const maxVal = parseFloat(slider.max ?? '90');
        const center = (minVal + maxVal) / 2;
        const maxAmp = Math.min(Math.abs(maxVal - center), Math.abs(center - minVal));
        if (amp > maxAmp) amp = maxAmp;

        if (sineAmpInput) sineAmpInput.value = amp.toString();
        if (sineFreqInput) sineFreqInput.value = freq.toString();
        if (sineWaveform && !['sine', 'rect', 'saw'].includes(wave)) {
          wave = 'sine';
          sineWaveform.value = 'sine';
        }

        // disable controls while running
        if (sineWaveform) sineWaveform.disabled = true;
        if (sineAmpInput) sineAmpInput.disabled = true;
        if (sineFreqInput) sineFreqInput.disabled = true;

        sineRunning = true;
        sineStartTime = performance.now();
        sineStartStop.textContent = 'Stop';

        // 50 Hz -> 20 ms
        sineTimer = setInterval(() => {
          const tSec = (performance.now() - sineStartTime) / 1000;
          const phase = (freq * tSec) % 1; // 0..1 within each period
          let offset = 0;

          if (wave === 'sine') {
            // -1..1
            offset = Math.sin(2 * Math.PI * phase);
          } else if (wave === 'rect') {
            // +1 for first half, -1 for second half
            offset = phase < 0.5 ? 1 : -1;
          } else if (wave === 'saw') {
            // ramps from -1 to +1 over period
            offset = 2 * phase - 1;
          }

          const angle = center + amp * offset;

          slider.value = angle.toFixed(1);
          updatePositionLabel();
          slider.dispatchEvent(new Event('input'));
        }, 20);
      } else {
        // Stop
        stopSine();
      }
    });
  }

  // random-text READs for info-block

  if (serialReadBtn && serialInput) {
    serialReadBtn.addEventListener('click', () => {
      // TODO later: replace with UART read
      serialInput.value = randomText(16); // e.g. 16 chars, <= 32
    });
  }

  if (fwReadBtn && fwInput) {
    fwReadBtn.addEventListener('click', () => {
      // Example like "v1.2.3-BUILD123"
      fwInput.value =
        'v' +
        (1 + Math.floor(Math.random() * 3)) +
        '.' +
        Math.floor(Math.random() * 10) +
        '.' +
        Math.floor(Math.random() * 10) +
        '-' +
        randomText(6);
    });
  }

  if (hwReadBtn && hwInput) {
    hwReadBtn.addEventListener('click', () => {
      // Example like "REV-A3"
      hwInput.value =
        'REV-' +
        String.fromCharCode(65 + Math.floor(Math.random() * 3)) +
        Math.floor(Math.random() * 10);
    });
  }

  if (pnReadBtn && pnInput) {
    pnReadBtn.addEventListener('click', () => {
      // Example PN like "PN-1234-ABCD"
      pnInput.value =
        'PN-' +
        String(Math.floor(Math.random() * 9000) + 1000) +
        '-' +
        randomText(4);
    });
  }

  if (fwBrowseBtn && fwFileInput && fwFileName) {
    fwBrowseBtn.addEventListener('click', () => {
      fwFileInput.value = '';
      fwFileInput.click();
    });

    fwFileInput.addEventListener('change', () => {
      const file = fwFileInput.files && fwFileInput.files[0];
      if (!file) {
        fwFileName.textContent = 'No file selected';
        return;
      }
      fwFileName.textContent = file.name;
    });
  }

  if (fwUploadBtn && fwFileInput) {
    fwUploadBtn.addEventListener('click', async () => {
      const file = fwFileInput.files && fwFileInput.files[0];
      if (!file) {
        console.log('No HEX file selected for upload');
        return;
      }

      console.log('HEX upload requested for file:', file.name);

      // open modal progress window (simulated upload)
      try {
        await ipcRenderer.invoke('fw-open-upload-window');
      } catch (e) {
        console.error('Failed to open upload window:', e);
      }
    });
  }

  // load devices.json
  try {
    const jsonPath = path.join(__dirname, 'devices.json');
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    allDevices = parsed.devices || [];
  } catch (e) {
    console.error('Failed to load devices.json:', e);
    allDevices = [];
  }

  fillDeviceSelectForType(currentConnType);

  // start: buttons disabled
  setRightButtonsEnabled(false);

  // deviceSelect controls the 4 buttons
  if (deviceSelect) {
    deviceSelect.addEventListener('change', () => {
      const name = deviceSelect.value;
      const dev = allDevices.find(d => d.name === name);

      if (dev) {
        buildParamTable(dev);
        setRightButtonsEnabled(true); // ONLY here: enable!
      } else {
        clearParamTable();
        setRightButtonsEnabled(false);
      }
    });
  }

  // connect/disconnect – DOES NOT touch right buttons
	if (connectBtn) {
	  connectBtn.addEventListener('click', async () => {
		if (!isConnected) {
		  const cfg = collectConnectionConfig();
		  try {
			await ipcRenderer.invoke('conn-init', cfg);
			isConnected = true;
			connectBtn.textContent = 'Disconnect';
			if (contentOverlay) contentOverlay.classList.add('hidden');
			if (connectionHint) connectionHint.textContent = 'Connected';
			setSidebarEnabled(false);
		  } catch (e) {
			console.error('Connection init failed:', e);
			if (connectionHint) connectionHint.textContent = 'Connection failed';
		  }
		} else {
		  // send PWR0 to disable device
		  try {
			await ipcRenderer.invoke('conn-power', false);
		  } catch (e) {
			console.error('PWR0 failed:', e);
		  }

		  isConnected = false;
		  connectBtn.textContent = 'Connect';
		  if (contentOverlay) contentOverlay.classList.remove('hidden');
		  if (connectionHint)
			connectionHint.textContent = 'Select connection and press Connect';
		  setSidebarEnabled(true);
		}
	  });
	}



  // middle panel READ (random demo values for current/voltage/temps)
  if (readLiveBtn && currentValueEl && voltageValueEl && temp1ValueEl && temp2ValueEl) {
    readLiveBtn.addEventListener('click', () => {
      // TODO later: replace with real device read via IPC
      const current = (Math.random() * 10).toFixed(2); // 0–10 A
      const voltage = (12 + Math.random() * 2).toFixed(2); // 12–14 V
      const temp1 = (20 + Math.random() * 30).toFixed(1); // 20–50 °C
      const temp2 = (20 + Math.random() * 30).toFixed(1); // 20–50 °C

      currentValueEl.textContent = `${current}`;
      voltageValueEl.textContent = `${voltage}`;
      temp1ValueEl.textContent = `${temp1}`;
      temp2ValueEl.textContent = `${temp2}`;
    });
  }

  // WRITE
  if (writeBtn) {
    writeBtn.addEventListener('click', () => {
      const paramsToWrite = collectCurrentParams();
      console.log('WRITE parameters:', paramsToWrite);
    });
  }

  // READ
  if (readBtn) {
    readBtn.addEventListener('click', () => {
      const inputs = document.querySelectorAll('#paramTable tbody input');
      const paramsToRead = Array.from(inputs).map(inp => ({
        name: inp.dataset.name,
        address: Number(inp.dataset.address),
        type: inp.dataset.type
      }));
      console.log('READ parameters:', paramsToRead);
    });
  }

  // SAVE TO FILE
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const deviceName = deviceSelect ? deviceSelect.value : '';
      if (!deviceName) return;

      const params = collectCurrentParams();
      const data = {
        device: deviceName,
        params: params.map(p => ({
          name: p.name,
          address: p.address,
          value: p.value
        }))
      };

      const jsonStr = JSON.stringify(data, null, 2);
      const safeName = deviceName.replace(/[^a-z0-9_\-]+/gi, '_');
      const filename = `params-${safeName}.json`;
      downloadJsonFile(filename, jsonStr);
    });
  }

  // LOAD FROM FILE
  if (loadBtn && loadFileInput) {
    loadBtn.addEventListener('click', () => {
      loadFileInput.value = '';
      loadFileInput.click();
    });

    loadFileInput.addEventListener('change', () => {
      const file = loadFileInput.files && loadFileInput.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = reader.result.toString();
          const data = JSON.parse(text);
          if (!data || !Array.isArray(data.params)) {
            console.error('Invalid JSON format');
            return;
          }

          const inputs = document.querySelectorAll('#paramTable tbody input');
          data.params.forEach(p => {
            const match = Array.from(inputs).find(
              inp =>
                inp.dataset.name === String(p.name) &&
                Number(inp.dataset.address) === Number(p.address)
            );

            if (match && typeof p.value !== 'undefined') {
              match.value = String(p.value);
              match.dispatchEvent(new Event('blur'));
            }
          });
        } catch (e) {
          console.error('Error parsing JSON file:', e);
        }
      };
      reader.readAsText(file, 'utf8');
    });
  }

  // port name from small window
  ipcRenderer.on('selected-port', (_event, data) => {
	const { portPath, fwVersion } = typeof data === 'string' ? { portPath: data, fwVersion: null } : data;
    
	const portLabel = document.getElementById('portName');
    if (portLabel) {
		portLabel.textContent = portPath;
	}
	
	if (fwVersion) {
		const vptVerElem = document.getElementById('vptVer');
		if (vptVerElem) {
			vptVerElem.textContent = 'Ver. ' + fwVersion;
		}
	}	
  });
});

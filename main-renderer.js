// main-renderer.js

const ScriptRunner = require('./script-runner.js');

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
    const baseEl = document.getElementById('can-base-id');
    if (baseEl) {
      const val = parseInt(baseEl.value || '0', 16);
      if (Number.isFinite(val)) cfg.baseId = val;
    }
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
	  const label = param.unit ? `${param.name}, ${param.unit}` : param.name;
	  nameTd.textContent = label;

	  const valueTd = document.createElement('td');
	  const input = document.createElement('input');
	  input.type = 'number';

	  // store multiplier (default 1)
	  const mult = typeof param.mult === 'number' && param.mult > 0 ? param.mult : 1;

	  // limits in raw units
	  if (typeof param.min === 'number') input.min = (param.min * mult).toString();
	  if (typeof param.max === 'number') input.max = (param.max * mult).toString();

	  // default value in scaled units
	  if (typeof param.dflt !== 'undefined') {
		input.value = (param.dflt * mult).toString();
	  }

	  input.dataset.address = param.address;
	  input.dataset.type = param.type;
	  input.dataset.min = param.min;
	  input.dataset.max = param.max;
	  input.dataset.name = param.name;
	  input.dataset.mult = String(mult);

	  // clamp in scaled domain
	  input.addEventListener('input', () => {
		const min = Number(input.dataset.min);
		const max = Number(input.dataset.max);
		const m = Number(input.dataset.mult) || 1;

		let val = input.value === '' ? NaN : Number(input.value);
		if (!isNaN(val)) {
		  let raw = val / m;
		  if (!isNaN(min) && raw < min) raw = min;
		  if (!isNaN(max) && raw > max) raw = max;
		  input.value = String(raw * m);
		}
	  });

	  input.addEventListener('blur', () => {
		const min = Number(input.dataset.min);
		const max = Number(input.dataset.max);
		const m = Number(input.dataset.mult) || 1;

		let val = input.value === '' ? NaN : Number(input.value);
		if (isNaN(val)) {
		  let raw;
		  if (typeof param.dflt !== 'undefined') {
			raw = param.dflt;
		  } else if (!isNaN(min)) {
			raw = min;
		  } else if (!isNaN(max)) {
			raw = max;
		  } else {
			return;
		  }
		  input.value = String(raw * m);
		  return;
		}

		let raw2 = val / m;
		if (!isNaN(min) && raw2 < min) raw2 = min;
		if (!isNaN(max) && raw2 > max) raw2 = max;
		input.value = String(raw2 * m);
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
  return Array.from(inputs).map(inp => {
    const mult = Number(inp.dataset.mult) || 1;
    const scaled = Number(inp.value);
    const raw = scaled / mult;
    return {
      name: inp.dataset.name,
      address: Number(inp.dataset.address),
      type: inp.dataset.type,
      min: Number(inp.dataset.min),
      max: Number(inp.dataset.max),
      value: raw
    };
  });
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

function updateStatusFields(voltage, temperature) {
  const voltageElem = document.getElementById('supplyValue');
  const tempElem = document.getElementById('temperatureValue');

  if (voltageElem) {
    voltageElem.textContent =
      typeof voltage === 'number' ? voltage.toFixed(1) : '--.-';
  }
  if (tempElem) {
    tempElem.textContent =
      typeof temperature === 'number' ? temperature.toFixed(1) : '--.-';
  }
}

function updatePositionSliderRange(type) {
  const slider = document.getElementById('positionSlider');
  if (!slider) return;

  if (type === 'PWM') {
    slider.min = '-45';
    slider.max = '45';
  } else if (type === 'RS485' || type === 'CAN') {
    slider.min = '-170';
    slider.max = '170';
  }

  // clamp current value into new range
  const v = parseFloat(slider.value || '0');
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const clamped = Math.min(Math.max(v, min), max);
  slider.value = String(clamped);

  if (typeof updatePositionLabel === 'function') {
    updatePositionLabel();
  }
}

async function readParamFromDevice(address, type) {
  // returns raw numeric value (no mult applied)
  const low = await ipcRenderer.invoke('read-byte', address);

  if (type === 'uint16' || type === 'int16') {
    const high = await ipcRenderer.invoke('read-byte', address + 1);
    let raw = (high << 8) | low;

    if (type === 'int16' && raw >= 0x8000) {
      raw = raw - 0x10000; // sign-extend
    }
    return raw;
  }

  return low;
}

function parseHexBytes(str, expectedLen) {
  const clean = str.replace(/[\s,]+/g, '').toUpperCase();
  if (!/^[0-9A-F]*$/.test(clean)) {
    throw new Error('Only HEX digits 0-9, A-F are allowed');
  }
  if (clean.length !== expectedLen * 2) {
    throw new Error(`Enter exactly ${expectedLen} bytes (${expectedLen * 2} hex digits)`);
  }
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return bytes;
}

function collectConnectionConfig() {
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
  } else if (connType === 'CAN') {
    cfg.bitrate = document.getElementById('can-bitrate').value;
    cfg.id = document.getElementById('can-id').value;
  }

  return cfg;
}

let statusTimer = null;
let sineRunning = false; // set this true/false together with sine Start/Stop

async function pollStatusOnce() {
  console.log('Tick');
  if (!isConnected || sineRunning) return;

  try {
    const [v, t] = await Promise.all([
      ipcRenderer.invoke('read-supply'),
      ipcRenderer.invoke('read-temperature'),
	    //ipcRenderer.invoke('read-status')
    ]);
    updateStatusFields(v, t);
	if (connectionHint) {
      if (typeof s === 'number' && s === 0) {
        connectionHint.textContent = 'Connected';
      } else {
        connectionHint.textContent = 'ERROR';
      }
    }
  } catch (e) {
    console.error('Status poll failed:', e);
    updateStatusFields(null, null);
	if (connectionHint) connectionHint.textContent = 'ERROR';
  }
}

function startStatusPolling() {
  console.log('Timer started');
  if (statusTimer) clearInterval(statusTimer);
  statusTimer = setInterval(pollStatusOnce, 1000);
}

function stopStatusPolling() {
  console.log('Timer stopped');
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
}

async function readInfoField(start, end) {
  const txt = await ipcRenderer.invoke('read-ascii-range', { start, end });
  return txt.trim();
}

// ---------- DOM Init ----------

document.addEventListener('DOMContentLoaded', () => {
  const rs485Id = document.getElementById('rs485-id');
  const canId = document.getElementById('can-id');
  const canBaseIdInput = document.getElementById('can-base-id');
  const connType = document.getElementById('connType');
  const rs485Settings = document.getElementById('rs485-settings');
  const canSettings = document.getElementById('can-settings');
  const deviceSelect = document.getElementById('deviceSelect');

  const slider = document.getElementById('positionSlider');
  const positionLabel = document.getElementById('positionLabel');
  const positionMinBtn = document.getElementById('positionMinBtn');
  const positionMaxBtn = document.getElementById('positionMaxBtn');
  const devicePositionLabel = document.getElementById('devicePositionLabel');

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
  const pnInput = document.getElementById('pnNumber');
  const fwInput = document.getElementById('fwVersion');
  const hwInput = document.getElementById('hwRevision');
  const serialReadBtn = document.getElementById('serialReadBtn');
  const fwReadBtn = document.getElementById('fwReadBtn');
  const hwReadBtn = document.getElementById('hwReadBtn');
  const pnReadBtn = document.getElementById('pnReadBtn');

  const revText = document.getElementById('revText');
  const revReadBtn = document.getElementById('revReadBtn');

  const workingTimeInput = document.getElementById('workingTime');
  const wtReadBtn = document.getElementById('wtReadBtn');
  
  const sineAmpInput = document.getElementById('sineAmplitude');
  const sineFreqInput = document.getElementById('sineFrequency');
  const sineStartStop = document.getElementById('sineStartStopBtn');
  const sineWaveform = document.getElementById('sineWaveform');

  const rawBlock = document.getElementById('rawBlock');
  const rawCommandInput = document.getElementById('rawCommandInput');
  const rawSendBtn = document.getElementById('rawSendBtn');

  const fwFileName  = document.getElementById('fwFileName');
  const fwBrowseBtn = document.getElementById('fwBrowseBtn');
  const fwFileInput = document.getElementById('fwFileInput');
  const fwUploadBtn = document.getElementById('fwUploadBtn');
  
  const updateBtn = document.getElementById('updateBtn');  
  
  const scriptFileInput = document.getElementById('scriptFileInput');
  const scriptBrowseBtn = document.getElementById('scriptBrowseBtn');
  const scriptRunBtn = document.getElementById('scriptRunBtn');
  const scriptSaveOutputBtn = document.getElementById('scriptSaveOutputBtn');
  const scriptInput = document.getElementById('scriptInput');
  const scriptOutput = document.getElementById('scriptOutput');

  const errorOverlay = document.getElementById('errorOverlay');
  const errorMessage = document.getElementById('errorMessage');
  const errorCloseBtn = document.getElementById('errorCloseBtn');
  
  const progressOverlay = document.getElementById('progressOverlay');
  const progressTitle = document.getElementById('progressTitle');
  const progressText = document.getElementById('progressText');
  const progressBar = document.getElementById('progressBar');  

  let isConnected = false;

  // Function to update the Update button state based on isConnected
  function updateUpdateButtonState() {
    if (!updateBtn) return;
    updateBtn.disabled = !isConnected;
  }

  function showError(message) {
    if (!errorOverlay || !errorMessage) {
      alert(message); // fallback
      return;
    }
    errorMessage.textContent = message;
    errorOverlay.classList.remove('hidden');
  }

  if (errorCloseBtn && errorOverlay) {
    errorCloseBtn.addEventListener('click', () => {
      errorOverlay.classList.add('hidden');
    });
  }
  
  function showProgress(title, message) {
    if (!progressOverlay || !progressTitle || !progressBar) return;
    progressTitle.textContent = title || 'Progress';
    if (progressText) progressText.textContent = message || '';
    progressBar.style.width = '0%';
    progressOverlay.classList.remove('hidden');
  }

  function updateProgress(currentStep, totalSteps) {
    if (!progressBar || !totalSteps || totalSteps <= 0) return;
    const ratio = Math.max(0, Math.min(1, currentStep / totalSteps));
    progressBar.style.width = (ratio * 100).toFixed(1) + '%';
  }

  function hideProgress() {
    if (!progressOverlay) return;
    progressOverlay.classList.add('hidden');
  }
  
  function stopScriptAndResetUI() {
    if (scriptRunning && currentRunner) {
      currentRunner.stop();
    }
    scriptRunning = false;
    currentRunner = null;
    
    if (scriptRunBtn) scriptRunBtn.textContent = 'Run';
    if (scriptBrowseBtn) scriptBrowseBtn.disabled = false;
    if (scriptSaveOutputBtn) scriptSaveOutputBtn.disabled = false;
    if (scriptRunBtn) scriptRunBtn.disabled = false;
  }

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
  
	if (canBaseIdInput) {
	  // initialize safely: 0x3E0 with lower 5 bits cleared
	  let baseVal = 0x3E0 & ~0x1F;
	  canBaseIdInput.value = baseVal.toString(16).toUpperCase();

	  canBaseIdInput.addEventListener('input', () => {
		// 1) keep only hex digits
		let v = canBaseIdInput.value.toUpperCase().replace(/[^0-9A-F]/g, '');
		if (v === '') {
		  canBaseIdInput.value = '';
		  return;
		}

		// 2) parse as hex
		let num = parseInt(v, 16);
		if (isNaN(num)) {
		  num = baseVal;
		}

		// 3) clamp to [0x000, 0x7E0]
		if (num > 0x7E0) num = 0x7E0;
		if (num < 0) num = 0;

		// 4) force lower 5 bits to 0
		num &= ~0x1F;

		// 5) remember and show as uppercase HEX
		baseVal = num;
		canBaseIdInput.value = num.toString(16).toUpperCase();
	  });

	  canBaseIdInput.addEventListener('blur', () => {
		// ensure non-empty, valid HEX on blur
		if (!canBaseIdInput.value) {
		  canBaseIdInput.value = baseVal.toString(16).toUpperCase();
		}
	  });
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
      
      if (rawBlock) {
        if (connType.value === 'RS485' || connType.value === 'CAN') {
          rawBlock.classList.remove('hidden');
        } else {
          rawBlock.classList.add('hidden');
        }
      }

      currentConnType = connType.value;
      fillDeviceSelectForType(currentConnType);
      updatePositionSliderRange(currentConnType);
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
    const sendPosition = async () => {
      if (!isConnected) return;
      const degrees = parseFloat(slider.value || '0');
      try {
        await ipcRenderer.invoke('set-position', degrees);
        // optional: handle success
      } catch (e) {
        console.error('Failed to set position:', e);
        // optional: show error in UI
      }
    };

    updatePositionLabel = () => {
      positionLabel.textContent = parseFloat(slider.value).toFixed(1) + '°';
    };

    updatePositionLabel();

    // on manual slider move
    slider.addEventListener('input', () => {
      updatePositionLabel();
      sendPosition();
    });

    if (positionMinBtn) {
      positionMinBtn.addEventListener('click', () => {
        slider.value = slider.min ?? '0';
        updatePositionLabel();
        sendPosition();
      });
    }

    if (positionMaxBtn) {
      positionMaxBtn.addEventListener('click', () => {
        slider.value = slider.max ?? '0';
        updatePositionLabel();
        sendPosition();
      });
    }
	
    // click on label -> set position to 0
    positionLabel.addEventListener('click', () => {
      slider.value = '0';
      updatePositionLabel();
      sendPosition();
    });	
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
    serialReadBtn.addEventListener('click', async () => {
      const serial = await readInfoField(0x100, 0x12F);
	  serialInput.value = serial;
    });
  }

  if (pnReadBtn && pnInput) {
    pnReadBtn.addEventListener('click', async () => {
	  const pn = await readInfoField(0x130, 0x15F);
	  pnInput.value = pn;
    });
  }

  if (fwReadBtn && fwInput) {
    fwReadBtn.addEventListener('click', async () => {
	  const fw = await readInfoField(0x160, 0x18F);
	  fwInput.value = fw
    });
  }

  if (hwReadBtn && hwInput) {
    hwReadBtn.addEventListener('click', async () => {
      const hw = await readInfoField(0x190, 0x1BF);
	  hwInput.value = hw;
    });
  }

	// --- Revision String (GVS -> VS:string_response) ---
	if (revReadBtn && revText) {
	  revReadBtn.addEventListener('click', async () => {
		if (!isConnected) {
		  showError ? showError('Not connected') : alert('Not connected');
		  return;
		}

		revReadBtn.disabled = true;
		const oldLabel = revReadBtn.textContent;
		revReadBtn.textContent = 'Reading…';

		try {
		  // Ask main process to send GVS and return the raw text response
		  const line = await ipcRenderer.invoke('send-text-command', 'GVS');

		  // Expect "VS:some text"
		  let txt = typeof line === 'string' ? line.trim() : '';
		  if (txt.startsWith('VS:')) {
			txt = txt.slice(3);          // strip "VS:"
		  }

		  revText.value = txt || '';
		} catch (e) {
		  //console.error('Revision read failed:', e);
		  //revText.value = 'Error reading revision';
      showError ? showError('Revision read failed: ' + e) : alert('Revision read failed: ' + e);
		} finally {
		  revReadBtn.disabled = false;
		  revReadBtn.textContent = oldLabel;
		}
	  });
	}
	
	// --- Working Time (GWT -> WT:hhhh:mm:ss) ---
	if (wtReadBtn && workingTimeInput) {
	  wtReadBtn.addEventListener('click', async () => {
		if (!isConnected) {
		  showError ? showError('Not connected') : alert('Not connected');
		  return;
		}

		wtReadBtn.disabled = true;
		const oldLabel = wtReadBtn.textContent;
		wtReadBtn.textContent = 'Reading…';

		try {
		  // ask main to send GWT and return the response line as string
		  const line = await ipcRenderer.invoke('send-text-command', 'GWT');

		  let txt = typeof line === 'string' ? line.trim() : '';

		  // expect WT:hhhh:mm:ss
		  if (txt.startsWith('WT:')) {
			txt = txt.slice(3); // remove "WT:"
		  }

		  // basic validation/normalization
		  const parts = txt.split(':');
		  if (parts.length === 3) {
			let [h, m, s] = parts;
			h = h.padStart(4, '0');
			m = m.padStart(2, '0');
			s = s.padStart(2, '0');
			workingTimeInput.value = `${h}:${m}:${s}`;
		  } else {
			workingTimeInput.value = '0000:00:00';
			showError && showError('Invalid working time format from device.');
		  }
		} catch (e) {
		  console.error('Working time read failed:', e);
		  workingTimeInput.value = '0000:00:00';
		  showError ? showError('Error reading working time.') : alert('Error reading working time.');
		} finally {
		  wtReadBtn.disabled = false;
		  wtReadBtn.textContent = oldLabel;
		}
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

		// Read file content in renderer (or in main if you prefer)
		let hexContent;
		try {
		  hexContent = await ipcRenderer.invoke('read-file', file.path);
		} catch (e) {
		  console.error('Failed to read HEX file:', e);
		  showError && showError('Failed to read HEX file: ' + e.message);
		  return;
		}

		fwUploadBtn.disabled = true;

		// Show modal progress
		showProgress('Firmware update', `Uploading ${file.name}…`);
		updateProgress(0, 100);

		try {
		  // Ask main to perform update (it will emit progress events)
		  await ipcRenderer.invoke('perform-update', hexContent);

		  updateProgress(100, 100);
		} catch (e) {
		  console.error('Firmware upload failed:', e);
		  showError ? showError('Firmware upload failed: ' + e.message)
					: alert('Firmware upload failed: ' + e.message);
		} finally {
		  hideProgress();
		  fwUploadBtn.disabled = false;
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

	// Modify your connectBtn click handler to call updateUpdateButtonState()
	if (connectBtn) {
	  connectBtn.addEventListener('click', async () => {
    console.log('connectBtn click');
		if (!isConnected) {
		  const cfg = collectConnectionConfig();
		  try {
			await ipcRenderer.invoke('conn-init', cfg);
			isConnected = true;
			//startStatusPolling();
			connectBtn.textContent = 'Disconnect';
			if (contentOverlay) contentOverlay.classList.add('hidden');
			if (connectionHint) connectionHint.textContent = 'Connected';
			setSidebarEnabled(false);

			// Enable/disable Update button according to new state
			updateUpdateButtonState();
		  } catch (e) {
      console.log('catch block entered');
			console.error('Connection init failed:', e);
			if (connectionHint) connectionHint.textContent = '111';//'Connection failed';
		  }
		} else {
      stopScriptAndResetUI();
		  try {
			await ipcRenderer.invoke('conn-power', false);
		  } catch (e) {
			console.error('PWR0 failed:', e);
		  }

		  isConnected = false;
		  stopStatusPolling();
		  updateStatusFields(null, null);
		  connectBtn.textContent = 'Connect';
		  if (contentOverlay) contentOverlay.classList.remove('hidden');
		  if (connectionHint)
			connectionHint.textContent = 'Select connection and press Connect';
		  setSidebarEnabled(true);

		  // Enable/disable Update button according to new state
		  updateUpdateButtonState();
		}
	  });
	}

  devicePositionLabel.addEventListener('click', async () => {
    try {
      const resp = await ipcRenderer.invoke('read-device-position');
      // Parse response: "PS:xxx.x"
      const match = resp.trim().match(/^PS:(-?\d+\.\d+)$/);
      if (!match) {
        devicePositionLabel.textContent = '--.-°';
        return;
      }

      const num = Number(match[1]);        // removes leading zeros
      const value = num.toFixed(1);        // keep one decimal

      devicePositionLabel.textContent = value + '°';
    } catch (e) {
      devicePositionLabel.textContent = '--.-°';
      console.error('Failed to read device position:', e);
    }
  });

  // middle panel READ (random demo values for current/voltage/temps)
  if (readLiveBtn && voltageValueEl && currentValueEl && temp1ValueEl) {
    readLiveBtn.addEventListener('click', async () => {
	  try {
	    const voltageResp = await ipcRenderer.invoke('uart-send-command', 'GUM');
	    const currentResp = await ipcRenderer.invoke('uart-send-command', 'GCS');
	    const tempResp = await ipcRenderer.invoke('uart-send-command', 'GTS');

	    function parseResponse(prefix, response) {
		  if (!response) return '--.-';
		  response = response.trim();
		  if (response === 'E.H') return '--.-';
		  const re = new RegExp(`^${prefix}:(\\d+\\.\\d+)$`);
		  const m = response.match(re);
		  return m ? m[1] : '--.-';
	    }

	    const voltage = parseResponse('UM', voltageResp);
	    const current = parseResponse('CS', currentResp);
	    const temp = parseResponse('TS', tempResp);

	    voltageValueEl.textContent = voltage;
	    currentValueEl.textContent = current;
	    temp1ValueEl.textContent = temp;
	  } catch (e) {
	    console.error('Failed to read live data:', e);
	    voltageValueEl.textContent = '--.-';
	    currentValueEl.textContent = '--.-';
	    temp1ValueEl.textContent = '--.-';
	  }
    });
  }

  // WRITE
	if (writeBtn) {
	  writeBtn.addEventListener('click', async () => {
		const paramsToWrite = collectCurrentParams();
		if (!paramsToWrite.length) return;

		writeBtn.disabled = true;

		showProgress('Writing parameters', 'Writing EEPROM parameters…');
		const total = paramsToWrite.length;
		let step = 0;

		try {
		  for (const p of paramsToWrite) {
			await ipcRenderer.invoke('write-param', {
			  address: p.address,
			  type: p.type,
			  value: p.value
			});

			step += 1;
			updateProgress(step, total);
		  }
		  console.log('All parameters written successfully');
		} catch (e) {
		  console.error('Write failed:', e);
		  showError ? showError('Error while writing parameters: ' + e.message)
					: alert('Error while writing parameters: ' + e.message);
		} finally {
		  hideProgress();
		  writeBtn.disabled = false;
		}
	  });
	}

  // READ
	if (readBtn) {
	  readBtn.addEventListener('click', async () => {
		const inputs = document.querySelectorAll('#paramTable tbody input');
		if (!inputs.length) return;

		readBtn.disabled = true;
    
		showProgress('Reading parameters', 'Reading EEPROM parameters…');
		const total = inputs.length;
		let step = 0;    

		try {
		  for (const inp of Array.from(inputs)) {
			const address = Number(inp.dataset.address);
			const type = inp.dataset.type;
			const mult = Number(inp.dataset.mult) || 1;

			const raw = await readParamFromDevice(address, type);
			const scaled = raw * mult;

			inp.value = String(scaled);
			inp.dispatchEvent(new Event('blur')); // reuse clamping/formatting
      
      step += 1;
			updateProgress(step, total);
		  }
		  console.log('All parameters read from device');
		} catch (e) {
		  console.error('Read failed:', e);
		  alert('Error while reading parameters: ' + e.message);
		} finally {
      hideProgress();
		  readBtn.disabled = false;
		}
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
  
  if (rawCommandInput && connType) {
    rawCommandInput.addEventListener('input', () => {
      // 1) keep only HEX digits and spaces, and uppercase
      let v = rawCommandInput.value.toUpperCase().replace(/[^0-9A-F\s]/g, '');

      // 2) remove spaces for length check
      const clean = v.replace(/\s+/g, '');

      const type = connType.value;           // PWM / RS485 / CAN
      const maxBytes = type === 'CAN' ? 8 : 4; // 8 bytes CAN, 4 bytes RS485
      const maxHexChars = maxBytes * 2;

      // 3) clip to allowed hex length
      let clipped = clean.slice(0, maxHexChars);

      // 4) reinsert space every 2 hex chars for readability
      clipped = clipped.match(/.{1,2}/g)?.join(' ') ?? '';

      rawCommandInput.value = clipped;
    });
  }

  if (rawSendBtn && rawCommandInput) {
    rawSendBtn.addEventListener('click', async () => {
      try {
        if (!isConnected) {
          showError ? showError('Not connected') : alert('Not connected');
          return;
        }

        const connTypeEl = document.getElementById('connType');
        const type = connTypeEl ? connTypeEl.value : 'PWM';

        const expectedBytes = type === 'CAN' ? 8 : 4;
        const bytes = parseHexBytes(rawCommandInput.value, expectedBytes);

        rawSendBtn.disabled = true;

        await ipcRenderer.invoke('send-raw-command', { bytes });
        // optional: some UI feedback
      } catch (e) {
        //alert('Raw command error: ' + e.message);
        //console.error('Raw command failed:', e);
        showError ? showError('Raw command error: ' + e.message) : alert('Raw command error: ' + e.message);
      } finally {
        rawSendBtn.disabled = false;
      }
    });
  }
  
  // Browse and load script
  if (scriptBrowseBtn && scriptFileInput) {
    scriptBrowseBtn.addEventListener('click', () => {
      scriptFileInput.click();
    });

    scriptFileInput.addEventListener('change', async () => {
      const file = scriptFileInput.files && scriptFileInput.files[0];
      if (!file) return;

      try {
        const reader = new FileReader();
        
        reader.onload = (e) => {
          if (scriptInput) {
            scriptInput.value = e.target.result;
            // Clear previous output
            if (scriptOutput) scriptOutput.value = '';
          }
        };
        
        reader.onerror = (e) => {
          console.error('Failed to read script file:', e);
          showError && showError('Failed to read script file');
        };
        
        reader.readAsText(file);
      } catch (e) {
        console.error('Failed to read script file:', e);
        showError && showError('Failed to read script file: ' + e.message);
      }
    });
  }
  
  let currentRunner = null;
  let scriptRunning = false;

  // Run script
  if (scriptRunBtn && scriptInput && scriptOutput) {
    scriptRunBtn.addEventListener('click', async () => {
      // If script is already running -> this acts as Stop
      if (scriptRunning && currentRunner) {
        currentRunner.stop();           // uses ScriptRunner.stop()
        scriptRunning = false;
        scriptRunBtn.textContent = 'Run';
        // Re-enable other buttons
        if (scriptBrowseBtn) scriptBrowseBtn.disabled = false;
        if (scriptSaveOutputBtn) scriptSaveOutputBtn.disabled = false;
        return;
      }

      // Start script
      if (!isConnected) {
        showError && showError('Not connected');
        return;
      }

      const script = scriptInput.value.trim();
      if (!script) {
        showError && showError('Script is empty');
        return;
      }

      // Disable browse & save, but keep Run (now "Stop") enabled
      if (scriptBrowseBtn) scriptBrowseBtn.disabled = true;
      if (scriptSaveOutputBtn) scriptSaveOutputBtn.disabled = true;
      scriptRunBtn.textContent = 'Stop';
      scriptRunning = true;

      // Clear previous output
      scriptOutput.value = '';

      const logFn = (msg) => {
        scriptOutput.value += msg + '\n';
        scriptOutput.scrollTop = scriptOutput.scrollHeight;
      };

      const uartWrapper = {
        isOpen: () => isConnected,
        send: async (command) => {
          await ipcRenderer.invoke('uart-send', command);
        },
        sendAndWait: async (command, matcher, timeout) => {
          return await ipcRenderer.invoke('uart-send-wait', command, timeout || 3000);
        },
        emitter: {
          on: () => {},
          removeListener: () => {}
        }
      };

      try {
        currentRunner = new ScriptRunner(script, uartWrapper, logFn);
        await currentRunner.run();
      } catch (e) {
        console.error('Script execution failed:', e);
        logFn(`ERROR: ${e.message}`);
      } finally {
        // Script finished or failed
        scriptRunning = false;
        scriptRunBtn.textContent = 'Run';
        currentRunner = null;
        if (scriptBrowseBtn) scriptBrowseBtn.disabled = false;
        if (scriptSaveOutputBtn) scriptSaveOutputBtn.disabled = false;
      }
    });
  }
  
  // Save output to file
  if (scriptSaveOutputBtn && scriptOutput) {
    scriptSaveOutputBtn.addEventListener('click', async () => {
      const output = scriptOutput.value;
      if (!output) {
        showError && showError('No output to save');
        return;
      }

      try {
        const { canceled, filePath } = await ipcRenderer.invoke('save-dialog', {
          title: 'Save Script Output',
          defaultPath: 'script-output.txt',
          filters: [{ name: 'Text Files', extensions: ['txt'] }]
        });

        if (canceled || !filePath) return;

        await ipcRenderer.invoke('write-file', { path: filePath, content: output });
      } catch (e) {
        console.error('Failed to save output:', e);
        showError && showError('Failed to save output: ' + e.message);
      }
    });
  }

	updateBtn.addEventListener('click', async () => {
	  try {
		const { canceled, filePaths } = await ipcRenderer.invoke('select-hex-file');
		if (canceled || !filePaths || filePaths.length === 0) {
		  return;
		}
		const filePath = filePaths[0];

		const hexContent = await ipcRenderer.invoke('read-file', filePath);

		// Show modal progress in main window
		showProgress('Firmware update', 'Uploading firmware…');
		// Start at 0
		updateProgress(0, 100); // will be updated by events

		// Tell main to start update; it will emit progress events
		await ipcRenderer.invoke('perform-update', hexContent);

		// On success, optionally fill bar to 100%
		updateProgress(100, 100);
	  } catch (e) {
		console.error('Firmware update failed:', e);
		showError ? showError('Firmware update failed: ' + e.message)
				  : alert('Firmware update failed: ' + e.message);
	  } finally {
		hideProgress();
	  }
	});   

	ipcRenderer.on('update-progress', (_event, payload) => {
	  // payload: { current, total, text? } or { percent }
	  if (!progressBar) return;

	  if (payload && typeof payload.percent === 'number') {
		progressBar.style.width = `${Math.max(0, Math.min(100, payload.percent))}%`;
	  } else if (payload && typeof payload.current === 'number' && typeof payload.total === 'number') {
		updateProgress(payload.current, payload.total);
	  }

	  if (payload && payload.text && progressText) {
		progressText.textContent = payload.text;
	  }
	});

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
  
  // Tab switching
  document.querySelectorAll('.tab-link').forEach(btn => {
    btn.addEventListener('click', function() {
      stopScriptAndResetUI();
      document.querySelectorAll('.tab-link').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      document.getElementById(this.dataset.tab).classList.add('active');
    });
  });  
});

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
    if (baseEl) {
      //const val = parseInt(baseEl.value || '0', 16);
      //if (Number.isFinite(val)) cfg.baseId = val;
      cfg.baseId = baseEl.value;
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

  if (!device || !Array.isArray(device.eeprom)) return;

  device.eeprom.forEach(param => {
    const tr = document.createElement('tr');

    // Name column
    const nameTd = document.createElement('td');
    const label = param.unit ? `${param.name}, ${param.unit}` : param.name;
    nameTd.textContent = label;

    // Value column
    const valueTd = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';

    // Scaling parameters
    const mult = (typeof param.mult === 'number' && param.mult !== 0) ? param.mult : 1;
    const div = (typeof param.div === 'number' && param.div !== 0) ? param.div : 1;
    const offset = (typeof param.offset === 'number') ? param.offset : 0;
    
    // Helper: raw -> displayed
    function rawToDisplay(raw) {
      // raw is in device units already; apply mult, then offset/div if present
      const scaled = raw / mult;
      return (scaled / div) + offset;
    }

    // Helper: displayed -> raw
    function displayToRaw(display) {
      const scaled = (display - offset) * div;
      return scaled * mult;
    }

    // Set min/max for browser validation based on displayed units
    if (typeof param.min === 'number') {
      input.min = param.min.toString();//rawToDisplay(param.min).toString();
    }
    if (typeof param.max === 'number') {
      input.max = param.max.toString();//rawToDisplay(param.max).toString();
    }

    // Set default value in displayed units
    if (typeof param.dflt !== 'undefined') {
      input.value = param.dflt.toString();//rawToDisplay(param.dflt).toString();
    }

    // Store metadata
    input.dataset.address = param.address;
    input.dataset.type = param.type;
    input.dataset.min = param.min;
    input.dataset.max = param.max;
    input.dataset.name = param.name;
    input.dataset.mult = String(mult);
    input.dataset.div = String(div);
    input.dataset.offset = String(offset);

    // Remove 'input' event listener - allow free editing
    // Only validate on 'blur' when user finishes editing
    input.addEventListener('blur', () => {
      const min = Number(input.dataset.min);
      const max = Number(input.dataset.max);
      const m = Number(input.dataset.mult) || 1;
      const d = Number(input.dataset.div) || 1;
      const off = Number(input.dataset.offset) || 0;

      // Local helpers reusing same math as above
      const rawToDisplay = (raw) => {
        const scaled = raw / m;
        return (scaled / d) + off;
      };
      const displayToRaw = (display) => {
        const scaled = (display - off) * d;
        return scaled * m;
      };

      let displayVal = input.value === '' ? NaN : Number(input.value);
      if (isNaN(displayVal)) {
        // Restore default or min/max, using raw
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
        input.value = String(rawToDisplay(raw));
        return;
      }

      // Convert to raw, clamp in raw domain
      //let raw = displayToRaw(displayVal);
      let raw = displayVal;
      if (!isNaN(min) && raw < min) raw = min;
      if (!isNaN(max) && raw > max) raw = max;
      console.log('value=', raw, ' min=', min, ' max=', max);

      // Update with clamped display value
      //input.value = String(rawToDisplay(raw));
      input.value = String(raw);
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
    const div = Number(inp.dataset.div) || 1;
    const offset = Number(inp.dataset.offset) || 0;

    const displayVal = Number(inp.value);
    // value = (param - offset) / div per your definition, then * mult to go to raw
    const scaled = (displayVal - offset) * div;
    const raw = scaled * mult;

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

function parseHexBytes(str) {
  const clean = str.replace(/[\s,]+/g, '').toUpperCase();
  if (!/^[0-9A-F]*$/.test(clean)) {
    throw new Error('Only HEX digits 0-9, A-F are allowed');
  }
  if (clean.length === 0 || clean.length % 2 !== 0) {
    throw new Error('Enter an even number of hex digits (2 per byte)');
  }
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return bytes;
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
  const sineOffsetInput = document.getElementById('sineOffset');
  const sineFreqInput = document.getElementById('sineFrequency');
  const sineStartStop = document.getElementById('sineStartStopBtn');
  const sineWaveform = document.getElementById('sineWaveform');

  const rawBlock = document.getElementById('rawBlock');
  const rawCommandInput = document.getElementById('rawCommandInput');
  const rawCommandResponse = document.getElementById('rawCommandResponse');
  const rawSendBtn = document.getElementById('rawSendBtn');

  const fwFileName  = document.getElementById('fwFileName');
  const fwBrowseBtn = document.getElementById('fwBrowseBtn');
  const eeBrowseBtn = document.getElementById('eeBrowseBtn');
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
  
  const successOverlay   = document.getElementById('successOverlay');
  const successMessage   = document.getElementById('successMessage');
  const successCloseBtn  = document.getElementById('successCloseBtn');

  const progressOverlay = document.getElementById('progressOverlay');
  const progressTitle = document.getElementById('progressTitle');
  const progressText = document.getElementById('progressText');
  const progressBar = document.getElementById('progressBar');  

  let isConnected = false;
  let statusTimer = null;
  let pollStep = 0; // 0 = Voltage, 1 = Temp, 2 = Status

  async function pollStatusOnce() {
    if (!isConnected /*|| sineRunning*/) return;

    try {
      switch (pollStep) {
        // --- STEP 0: Voltage ---
        case 0:
          const v = await ipcRenderer.invoke('read-supply');
          // Update only the voltage element
          const vEl = document.getElementById('supplyValue'); 
          if (vEl) {
            vEl.textContent = (typeof v === 'number') ? v.toFixed(1) : '--.-';
          }
          // Success -> reset miss counter
          missedPolls = 0;
          break;

        // --- STEP 1: Temperature ---
        case 1:
          const t = await ipcRenderer.invoke('read-temperature');
          // Update only the temperature element
          const tEl = document.getElementById('temperatureValue');
          if (tEl) {
            tEl.textContent = (typeof t === 'number') ? t.toFixed(1) : '--.-';
          }
          missedPolls = 0;
          break;

        // --- STEP 2: Status ---
        case 2:
          const s = await ipcRenderer.invoke('read-status');
          if (s !== null) {
            // Got a valid status -> reset miss counter
            missedPolls = 0;
            if ((s & 0x01) !== 0) {
              console.warn('Device requested disconnect (Status Bit 0 set). Disconnecting...');
              // Trigger the disconnect logic (same as clicking the button)
              if (connectBtn && connectBtn.textContent === 'Disconnect') {
                connectBtn.click();
              }
              showError('Device reset or not configured. Connection closed.');
            } else {
              // DISPLAY OTHER ERRORS (Mask out Bit 0)
              // Pass (statusVal & ~0x01) to your visual indicator
              const displayStatus = s & ~0x01;
              
              // Update only connection hint
              if (connectionHint) {
                //if (typeof s === 'number' && s === 0) { // Adjust '0' if your logic differs
                if (displayStatus === 0) {
                  connectionHint.textContent = 'Connected';
                  connectionHint.style.color = '';      // '' to use CSS default
                  connectionHint.style.fontWeight = 'normal';
                } else {
                  connectionHint.textContent = 'ERROR';
                  connectionHint.style.color = 'red';
                  connectionHint.style.fontWeight = 'bold';
                }
              }
            }
          } else {
            // Treat null as a miss
            missedPolls++;
          }
          break;
      }

      // Cycle to the next step: 0 -> 1 -> 2 -> 0 ...
      pollStep = (pollStep + 1) % 3;

    } catch (e) {
      console.error('Status poll step ' + pollStep + ' failed:', e);
      // Any exception counting as a missed poll
      missedPolls++;
    }
    
      // If 9 consecutive polling failures, auto-disconnect
    if (missedPolls >= 6) {
      console.warn('No valid polling responses for 9 cycles. Disconnecting...');
      if (connectBtn && connectBtn.textContent === 'Disconnect') {
        connectBtn.click();
      }
      showError('Device not responding. Connection closed.');
      missedPolls = 0; // reset after disconnect
    }
  }

  function startStatusPolling() {
    console.log('Timer started');
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = setInterval(pollStatusOnce, 500);
  }

  function stopStatusPolling() {
    console.log('Timer stopped');
    if (statusTimer) {
      clearInterval(statusTimer);
      statusTimer = null;
    }
  }

  function showConnectTypeBlocks(connType) {
    // show info only for RS485 and CAN
    if (infoBlock) {
      if (connType === 'RS485' || connType === 'CAN') {
        infoBlock.style.display = 'block';
      } else {
        infoBlock.style.display = 'none';
      }
    }
    
    if (rawBlock) {
      if (connType === 'RS485' || connType === 'CAN') {
        rawBlock.style.display = 'block';
      } else {
        rawBlock.style.display = 'none';
      }
    }

    if (revBlock) {
      if (connType === 'RS485' || connType === 'CAN') {
        revBlock.style.display = 'block';
      } else {
        revBlock.style.display = 'none';
      }
    }
  }
  
  // Function to update the Update button state based on isConnected
  function updateUpdateButtonState() {
    if (!updateBtn) return;
    updateBtn.disabled = isConnected;
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

  function showSuccess(message) {
    if (!successOverlay || !successMessage) {
      alert(message); // fallback
      return;
    }
    successMessage.textContent = message;
    successOverlay.classList.remove('hidden');
  }

  if (successCloseBtn && successOverlay) {
    successCloseBtn.addEventListener('click', () => {
      successOverlay.classList.add('hidden');
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
        // allow user to clear and start typing
        return;
      }

      // 2) parse as hex
      let num = parseInt(v, 16);
      if (isNaN(num)) {
        // keep last good value, but don't overwrite while typing
        return;
      }

      // 3) clamp to [0x000, 0x7E0]
      if (num > 0x7E0) num = 0x7E0;
      if (num < 0)    num = 0;

      // 4) do NOT yet force lower 5 bits to 0 while typing
      //    so user can enter any hex value; enforce on blur/commit
      baseVal = num;
      // do not rewrite value here, let the user’s typing stay as-is
    });

    canBaseIdInput.addEventListener('blur', () => {
      // On commit, normalize and display canonical value
      let v = canBaseIdInput.value.toUpperCase().replace(/[^0-9A-F]/g, '');
      if (v === '') {
        // restore last valid value
        canBaseIdInput.value = baseVal.toString(16).toUpperCase();
        return;
      }

      let num = parseInt(v, 16);
      if (isNaN(num)) {
        num = baseVal;
      }

      if (num > 0x7E0) num = 0x7E0;
      if (num < 0)     num = 0;

      // force lower 5 bits to 0 only on blur
      num &= ~0x1F;

      baseVal = num;
      canBaseIdInput.value = num.toString(16).toUpperCase();
    });

    // Optional: keyboard arrows (Up/Down) to change base ID in 0x20 steps
    canBaseIdInput.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

      e.preventDefault();

      let num = parseInt(canBaseIdInput.value || '0', 16);
      if (isNaN(num)) num = baseVal;

      if (e.key === 'ArrowUp')   num += 0x20;
      if (e.key === 'ArrowDown') num -= 0x20;

      if (num > 0x7E0) num = 0x7E0;
      if (num < 0)     num = 0;

      num &= ~0x1F;
      baseVal = num;
      canBaseIdInput.value = num.toString(16).toUpperCase();
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

      currentConnType = connType.value;
      showConnectTypeBlocks(currentConnType);
      fillDeviceSelectForType(currentConnType);
      updatePositionSliderRange(currentConnType);
      clearParamTable();
      if (deviceSelect) deviceSelect.value = '';
      setRightButtonsEnabled(false);
    });

    currentConnType = connType.value;

    // initial state on load
    showConnectTypeBlocks(currentConnType);
    /*if (infoBlock) {
      if (currentConnType === 'RS485' || currentConnType === 'CAN') {
        infoBlock.style.display = 'block';
      } else {
        infoBlock.style.display = 'none';
      }
    }*/
  }


  // slider + label + Min/Max + shared label updater
  let updatePositionLabel = null;

  if (slider && positionLabel) {
    const sendPosition = async () => {
      if (!isConnected) return;
      
      const degrees = parseFloat(slider.value || '0');
      
      try {
        // Await the ACTUAL position returned by the device
        const actualPos = await ipcRenderer.invoke('set-position', degrees);

        // Update the label with the confirmed value from the device
        if (devicePositionLabel && typeof actualPos === 'number') {
          devicePositionLabel.textContent = actualPos.toFixed(1) + '°';
        }
        
      } catch (e) {
        console.error('Failed to set position:', e);
        devicePositionLabel.textContent = '--.-°';
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
    if (sineOffsetInput) sineOffsetInput.disabled = false;
    if (sineFreqInput) sineFreqInput.disabled = false;
  }

  if (sineStartStop && slider && updatePositionLabel) {
    sineStartStop.addEventListener('click', () => {
      if (!sineRunning) {
        // Start
        let amp = parseFloat(sineAmpInput?.value || '0');
        let freq = parseFloat(sineFreqInput?.value || '0');
        let offset = parseFloat(sineOffsetInput?.value || '0');
        let wave = sineWaveform?.value || 'sine';

        if (!Number.isFinite(amp) || amp < 0) amp = 0;
        if (!Number.isFinite(freq) || freq < 0.1) freq = 0.1;
        if (!Number.isFinite(offset)) offset = 0;

        // Clamp amplitude to slider range
        const minVal = parseFloat(slider.min ?? '-90');
        const maxVal = parseFloat(slider.max ?? '90');
        //const center = (minVal + maxVal) / 2;
        //const maxAmp = Math.min(Math.abs(maxVal - center), Math.abs(center - minVal));
        //if (amp > maxAmp) amp = maxAmp;
        
        // Ensure offset ± amp stays within bounds
        if (offset - amp < minVal) offset = minVal + amp;
        if (offset + amp > maxVal) offset = maxVal - amp;

        if (sineAmpInput) sineAmpInput.value = amp.toString();
        if (sineFreqInput) sineFreqInput.value = freq.toString();
        if (sineOffsetInput) sineOffsetInput.value = offset.toString();
        if (sineWaveform && !['sine', 'rect', 'tri', 'saw'].includes(wave)) {
          wave = 'sine';
          sineWaveform.value = 'sine';
        }

        // disable controls while running
        if (sineWaveform) sineWaveform.disabled = true;
        if (sineAmpInput) sineAmpInput.disabled = true;
        if (sineOffsetInput) sineOffsetInput.disabled = true;
        if (sineFreqInput) sineFreqInput.disabled = true;

        sineRunning = true;
        sineStartTime = performance.now();
        sineStartStop.textContent = 'Stop';

        // 50 Hz -> 20 ms
        sineTimer = setInterval(() => {
          const tSec = (performance.now() - sineStartTime) / 1000;
          const phase = (freq * tSec) % 1; // 0..1 within each period
          let waveValue = 0;

          if (wave === 'sine') {
            // -1..1
            waveValue = Math.sin(2 * Math.PI * phase);
          } else if (wave === 'rect') {
            // +1 for first half, -1 for second half
            waveValue = phase < 0.5 ? 1 : -1;
          } else if (wave === 'tri') {
            // triangle: -1 -> +1 in first half, +1 -> -1 in second half
            // phase in [0,1):
            // 0..0.5: -1 -> +1 (slope +4)
            // 0.5..1: +1 -> -1 (slope -4)
            if (phase < 0.5) {
              waveValue = -1 + 4 * phase;
            } else {
              waveValue = 3 - 4 * phase;
            }            
          } else if (wave === 'saw') {
            // ramps from -1 to +1 over period
            waveValue = 2 * phase - 1;
          }

          // offset is the center position, amp is the amplitude
          const angle = offset + amp * waveValue;

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

  // HEX parsing function (based on standard Intel HEX format)
  function parseIntelHexToPages(hexString) {
    const lines = hexString.trim().split(/\r?\n/);
    const memory = new Map(); // Address -> byte value
    let minAddress = Infinity;
    let segmentAddress = 0;

    for (const line of lines) {
      if (!line.startsWith(':')) continue;
      const byteCount = parseInt(line.substr(1, 2), 16);
      const addr = parseInt(line.substr(3, 4), 16);
      const recordType = parseInt(line.substr(7, 2), 16);
      const dataStr = line.substr(9, byteCount * 2);
      const checksum = parseInt(line.substr(9 + byteCount * 2, 2), 16);

      // Simple checksum validation (sum of all bytes + checksum == 0 mod 256)
      let sum = byteCount + addr + (addr >> 8) + recordType;
      for (let i = 0; i < byteCount; i++) {
        const byte = parseInt(dataStr.substr(i * 2, 2), 16);
        sum += byte;
      }
      sum += checksum;
      if ((sum & 0xFF) !== 0) {
        throw new Error(`Invalid checksum in line: ${line}`);
      }

      if (recordType === 0) {
        for (let i = 0; i < byteCount; i++) {
          const byte = parseInt(dataStr.substr(i * 2, 2), 16);
          let fullAddr = addr + i; // Handle extended linear address if needed (recordType 04)
          fullAddr = fullAddr + segmentAddress;
          if (fullAddr < minAddress) minAddress = fullAddr;
          fullAddr = fullAddr - minAddress;
          memory.set(fullAddr, byte);
        }
      }
      if (recordType === 1) {
        // End of file
        break;
      }
      if (recordType === 2) {
        // Handle "Extended Segment Address"
        segmentAddress = parseInt(dataStr, 16) << 4;
      }
      if (recordType === 4) {
        // Handle "Extended Linear Address" by updating segment address
        segmentAddress = parseInt(dataStr, 16) << 16;
      }
    }

    if (minAddress === Infinity) throw new Error('No valid data in HEX file');

    // Pad to 256-byte pages starting from minAddress (align to page boundary if needed)
    const pageSize = 256;
    const startPageAddr = Math.floor(minAddress / pageSize) * pageSize;
    const totalPages = Math.ceil(memory.size / pageSize);
    const pages = [];

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
      const pageAddr = (pageIndex * pageSize);
      const page = new Uint8Array(pageSize);
      let hasData = false;
      for (let offset = 0; offset < pageSize; offset++) {
        const addr = pageAddr + offset;
        const byte = memory.get(addr);
        if (byte !== undefined) {
          page[offset] = byte;
          hasData = true;
        } else {
          page[offset] = 0xFF; // Erase value, adjust if device expects different
        }
      }
      if (hasData) pages.push({ index: pageIndex, data: page, addr: pageAddr });
    }

    return { pages, totalPages: pages.length, startAddress: startPageAddr };
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
		  //const line = await ipcRenderer.invoke('send-text-command', 'GVS');
      const line = await ipcRenderer.invoke('send-text-command', { cmd: 'GVS', prefix: 'VS:' });

		  // Expect "VS:some text"
		  let txt = typeof line === 'string' ? line.trim() : '';
		  if (txt.startsWith('VS:')) {
			txt = txt.slice(3);          // strip "VS:"
		  }

		  revText.value = txt || '';
		} catch (e) {
      const cleanMessage = e.message.split('Error: ').pop();
      showError ? showError('Revision read failed: ' + cleanMessage) 
          : alert('Revision read failed: ' + cleanMessage);
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
		  //const line = await ipcRenderer.invoke('send-text-command', 'GWT');
      const line = await ipcRenderer.invoke('send-text-command', { cmd: 'GWT', prefix: 'WT:' });

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
		  showError ? showError('Error reading working time.') 
          : alert('Error reading working time.');
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
  
  if (eeBrowseBtn && eeFileInput && eeFileName) {
    eeBrowseBtn.addEventListener('click', () => {
      eeFileInput.value = '';
      eeFileInput.click();
    });

    eeFileInput.addEventListener('change', () => {
      const file = eeFileInput.files && eeFileInput.files[0];
      if (!file) {
        eeFileName.textContent = 'No file selected';
        return;
      }
      eeFileName.textContent = file.name;
    });
  }
  

  // FW upload button listener
  if (fwUploadBtn && fwFileInput) {
    fwUploadBtn.addEventListener('click', async () => {
      const file = fwFileInput.files && fwFileInput.files[0];
      if (!file) {
        console.log('No HEX file selected for upload');
        return;
      }

      // 1. Read file content
      let hexContent;
      try {
        hexContent = await ipcRenderer.invoke('read-file', file.path);
      } catch (e) {
        console.error('Failed to read HEX file:', e);
        showError('Failed to read HEX file: ' + e.message);
        return;
      }

      // 2. Parse HEX to pages
      try {
        // Assuming parseIntelHexToPages is available in scope
        const { pages, totalPages } = parseIntelHexToPages(hexContent);
        
        if (pages.length === 0) {
          showError('Invalid HEX file: No data records found.');
          return;
        }

        fwUploadBtn.disabled = true;
        showProgress('Firmware update', `Uploading ${file.name}…`);
        updateProgress(0, totalPages);

        // 3. Invoke the NEW handler
        await ipcRenderer.invoke('perform-upload', pages, totalPages);

        updateProgress(totalPages, totalPages);
        hideProgress();
        if (typeof showSuccess === 'function') {
           showSuccess('Firmware upload completed successfully.', true);
        } else {
           alert('Firmware upload completed successfully.');
        }

      } catch (e) {
        console.error('Firmware upload failed:', e);
        const cleanMessage = e.message.split('Error: ').pop() || e.message;
        showError(`Firmware upload failed: ${cleanMessage}`);
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
			startStatusPolling();
			connectBtn.textContent = 'Disconnect';
			if (contentOverlay) contentOverlay.classList.add('hidden');
			if (connectionHint) connectionHint.textContent = 'Connected';
			setSidebarEnabled(false);

			// Enable/disable Update button according to new state
			updateUpdateButtonState();
		  } catch (e) {
      console.log('catch block entered');
			console.error('Connection init failed:', e);
			if (connectionHint) connectionHint.textContent = 'Connection failed';
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
      stopSine();
		  updateStatusFields(null, null);
		  connectBtn.textContent = 'Connect';
		  if (contentOverlay) 
        contentOverlay.classList.remove('hidden');
		  if (connectionHint) {
        connectionHint.textContent = 'Select connection type and press Connect';
        connectionHint.style.color = '';      // '' to use CSS default
        connectionHint.style.fontWeight = 'normal';
      }
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
      const cleanMessage = e.message.split('Error: ').pop();
		  showError ? showError('Error while writing parameters: ' + cleanMessage)
					: alert('Error while writing parameters: ' + cleanMessage);
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

      const raw = await readParamFromDevice(address, type);
      const mult = Number(inp.dataset.mult) || 1;
      const div = Number(inp.dataset.div) || 1;
      const offset = Number(inp.dataset.offset) || 0;

      // param (display) = value / div + offset, and value = raw / mult
      const displayVal = (raw / mult) / div + offset;
      console.log('Addr: ', address, ' raw=', raw, ' disp=', displayVal);
      inp.value = String(displayVal);
      inp.dispatchEvent(new Event('blur'));
      
      step += 1;
			updateProgress(step, total);
		  }
		  console.log('All parameters read from device');
		} catch (e) {
		  console.error('Read failed:', e);
      // Get just the last part after "Error: "
      const cleanMessage = e.message.split('Error: ').pop();
		  showError ? showError('Error while reading parameters: ' + cleanMessage) 
          : alert('Error while reading parameters: ' + cleanMessage);
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

  function formatHexWithSpaces(hexString) {
    // Remove any existing spaces
    const clean = hexString.replace(/\s+/g, '');
    // Add space every 2 characters
    return clean.match(/.{1,2}/g)?.join(' ') ?? '';
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

        const bytes = parseHexBytes(rawCommandInput.value);

        if (type === 'CAN') {
          // 1..8 bytes allowed
          if (bytes.length < 1 || bytes.length > 8) {
            throw new Error('CAN raw command must be 1 to 8 bytes (2–16 hex digits)');
          }
        } else {
          // RS485 and others: fixed 4 bytes
          if (bytes.length !== 4) {
            throw new Error('RS485 raw command must be exactly 4 bytes (8 hex digits)');
          }
        }

        rawSendBtn.disabled = true;

        const response = await ipcRenderer.invoke('send-raw-command', { bytes });
        rawCommandResponse.value = formatHexWithSpaces(response);
      } catch (e) {
        console.error('Raw command failed:', e);
        const cleanMessage = e.message.split('Error: ').pop();
        showError ? showError('Raw command error: ' + cleanMessage) 
                  : alert('Raw command error: ' + cleanMessage);
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
          // Allow re-selecting the same file later
          scriptFileInput.value = '';
        };
        
        reader.onerror = (e) => {
          console.error('Failed to read script file:', e);
          showError && showError('Failed to read script file');
          scriptFileInput.value = ''; // also clear on error
        };
        
        reader.readAsText(file);
      } catch (e) {
        console.error('Failed to read script file:', e);
        const cleanMessage = e.message.split('Error: ').pop();
        showError ? showError('Failed to read script file: ' + cleanMessage)
            : alert('Failed to read script file: ' + cleanMessage);
        scriptFileInput.value = '';
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
        const cleanMessage = e.message.split('Error: ').pop();
        showError ? showError('Failed to save output: ' + cleanMessage)
            : alert('Failed to save output: ' + cleanMessage);
      }
    });
  }

  updateBtn.addEventListener('click', async () => {
    try {
      const { canceled, filePaths } = await ipcRenderer.invoke('select-hex-file');
      if (canceled || !filePaths || filePaths.length === 0) return;

      const filePath = filePaths[0];
      const hexContent = await ipcRenderer.invoke('read-file', filePath);

      // Parse HEX file to binary pages (256 bytes each)
      const { pages, totalPages, startAddress } = parseIntelHexToPages(hexContent);
      if (pages.length === 0) {
        showError('Invalid HEX file: No data records found.');
        return;
      }

      showProgress('Firmware Update', `Preparing ${totalPages} pages...`);
      updateProgress(0, totalPages);

      // Invoke main process for flashing
      await ipcRenderer.invoke('perform-update', pages, totalPages);

      updateProgress(totalPages, totalPages);
      hideProgress();
      showSuccess('Firmware update completed successfully.', true); // Success variant if you add one
    } catch (e) {
      console.error('Firmware update failed:', e);
      const cleanMessage = e.message.split('Error: ').pop() || e.message;
      showError(`Firmware update failed: ${cleanMessage}`);
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

      // CHECK FOR 00.00 VERSION (Recovery Mode)
      if (fwVersion === '00.00') {
        const connType = document.getElementById('connType');
        const currentLimit = document.getElementById('currentLimit');
        const connectBtn = document.getElementById('connectBtn');
        const updateBtn = document.getElementById('updateBtn');

        if (connType) connType.disabled = true;
        if (currentLimit) currentLimit.disabled = true;
        if (connectBtn) connectBtn.disabled = true;

        // Force enable update button even if not "connected" in the normal sense
        if (updateBtn) {
          updateBtn.disabled = false;
        }      
      }
    }
  });
  
  ipcRenderer.on('app-version', (event, ver) => {
    const swVerElem = document.getElementById('swVer');
    if (swVerElem) {
      swVerElem.textContent = `Ver. ${ver}`;
    }
  });  
  
  // Tab switching
  document.querySelectorAll('.tab-link').forEach(btn => {
    btn.addEventListener('click', function() {
      stopScriptAndResetUI();

      // If we are leaving the Main tab, stop periodic movement
      const targetTabId = this.dataset.tab; // 'main-tab', 'eeprom-tab', 'info-tab', 'script-tab'
      if (typeof stopSine === 'function' && targetTabId !== 'main-tab') {
        stopSine();
      }

      document.querySelectorAll('.tab-link').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      this.classList.add('active');
      document.getElementById(targetTabId).classList.add('active');
    });
  }); 
});

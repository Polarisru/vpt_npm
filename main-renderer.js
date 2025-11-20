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
        return; // this device has no parameters
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

        // clamp while typing
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

        // clamp on blur
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
    const connectBtn = document.getElementById('connectBtn');
    const readBtn = document.getElementById('readParamsBtn');
    const writeBtn = document.getElementById('writeParamsBtn');

    // Fill RS485 IDs 1..31
    if (rs485Id) {
        for (let i = 1; i <= 31; i++) {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = String(i);
            rs485Id.appendChild(opt);
        }
    }

    // Fill CAN IDs 1..15
    if (canId) {
        for (let i = 1; i <= 15; i++) {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = String(i);
            canId.appendChild(opt);
        }
    }

    // Connection type logic
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
            fillDeviceSelectForType(currentConnType);
            clearParamTable();
        });

        currentConnType = connType.value;
    }

    // Slider label
    if (slider && positionLabel) {
        positionLabel.textContent = slider.value + '°';
        slider.addEventListener('input', () => {
            positionLabel.textContent = slider.value + '°';
        });
    }

    // Load devices.json
    try {
        const jsonPath = path.join(__dirname, 'devices.json');
        const raw = fs.readFileSync(jsonPath, 'utf8');
        const parsed = JSON.parse(raw);
        allDevices = parsed.devices || [];
    } catch (e) {
        console.error('Failed to load devices.json:', e);
        allDevices = [];
    }

    // Initial device list filtered by connection type
    fillDeviceSelectForType(currentConnType);

    // Device selection → build table
    if (deviceSelect) {
        deviceSelect.addEventListener('change', () => {
            const name = deviceSelect.value;
            const dev = allDevices.find(d => d.name === name);
            buildParamTable(dev);
        });
    }

    // Connect button: config only (UART logic later)
    if (connectBtn) {
        connectBtn.addEventListener('click', () => {
            const cfg = collectConnectionConfig();
            console.log('Connect requested with config:', cfg);
            // Later: send ID command using selected UART/CAN and parameters
        });
    }

    // Write parameters: collect table values
    if (writeBtn) {
        writeBtn.addEventListener('click', () => {
            const inputs = document.querySelectorAll('#paramTable tbody input');
            const paramsToWrite = Array.from(inputs).map(inp => ({
                name: inp.dataset.name,
                address: Number(inp.dataset.address),
                type: inp.dataset.type,
                min: Number(inp.dataset.min),
                max: Number(inp.dataset.max),
                value: Number(inp.value)
            }));
            console.log('WRITE parameters:', paramsToWrite);

            // Later: ipcRenderer.invoke('write-params', paramsToWrite)
        });
    }

    // Read parameters: addresses only
    if (readBtn) {
        readBtn.addEventListener('click', () => {
            const inputs = document.querySelectorAll('#paramTable tbody input');
            const paramsToRead = Array.from(inputs).map(inp => ({
                name: inp.dataset.name,
                address: Number(inp.dataset.address),
                type: inp.dataset.type
            }));
            console.log('READ parameters:', paramsToRead);

            // Later: ipcRenderer.invoke('read-params', paramsToRead).then(update inputs)
        });
    }

    // Port name from first window
    ipcRenderer.on('selected-port', (_event, port) => {
        const portLabel = document.getElementById('portName');
        if (portLabel) portLabel.textContent = port;
        console.log('Main window got selected port:', port);
    });
});

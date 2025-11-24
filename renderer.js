// renderer.js  (small first window)

console.log('Renderer script started');

const { SerialPort } = require('serialport');
const { ipcRenderer } = require('electron');

let statusLabel = null;

// List ports when page loads
SerialPort.list()
    .then(ports => {
        console.log('Ports received:', ports);
        const select = document.getElementById('portSelect');

        if (!select) return;

        if (ports.length === 0) {
            select.innerHTML = '<option>No ports found</option>';
        } else {
            select.innerHTML = '';
            ports.forEach(port => {
                const option = document.createElement('option');
                option.value = port.path;
                option.text = port.path;
                select.appendChild(option);
            });
        }
    })
    .catch(err => {
        console.error('Error listing ports:', err);
        const select = document.getElementById('portSelect');
        if (select) {
            select.innerHTML = '<option>Error: ' + err.message + '</option>';
        }
    });

document.addEventListener('DOMContentLoaded', () => {
    const connectBtn = document.getElementById('connectBtn');
    const portSelect = document.getElementById('portSelect');
    statusLabel = document.getElementById('statusLabel');

    if (!connectBtn || !portSelect) return;

    connectBtn.addEventListener('click', () => {
        const selectedPort = portSelect.value;
        if (!selectedPort || selectedPort === 'No ports found') return;

        if (statusLabel) {
            statusLabel.textContent = 'Checking device...';
            statusLabel.classList.remove('ok', 'error');
            statusLabel.classList.add('info');
        }

        console.log('Selected port:', selectedPort);
        ipcRenderer.send('port-selected', selectedPort);
    }); 
});

// Error from main when device not available / timeout / access denied
ipcRenderer.on('port-check-failed', (_event, message) => {
  console.log('Port check failed:', message);
  if (statusLabel) {
    statusLabel.textContent = message || 'VPT not connected';
    statusLabel.classList.remove('ok', 'info');
    statusLabel.classList.add('error');
  }
});

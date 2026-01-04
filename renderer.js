// src/renderer/js/renderer.js

const api = require('./api');

document.addEventListener('DOMContentLoaded', async () => {
    const portSelect = document.getElementById('portSelect');
    const connectBtn = document.getElementById('connectBtn');
    const statusLabel = document.getElementById('statusLabel');

    // 1. Populate Port List
    if (portSelect) {
        //portSelect.innerHTML = '<option>Loading ports...</option>';
        try {
            const ports = await api.listPorts();
            
            if (ports.length === 0) {
                portSelect.innerHTML = '<option>No ports found</option>';
            } else {
                portSelect.innerHTML = '';
                ports.forEach(port => {
                    const option = document.createElement('option');
                    option.value = port.path;
                    option.text = port.friendlyName || port.path;
                    portSelect.appendChild(option);
                });
            }
        } catch (err) {
            console.error('Error listing ports:', err);
            portSelect.innerHTML = '<option>Error loading ports</option>';
        }
    }

    // 2. Handle Connect Button
    if (connectBtn && portSelect) {
        connectBtn.addEventListener('click', () => {
            const selectedPort = portSelect.value;
            const isRecovery = document.getElementById('recoveryMode')?.checked || false;

            if (!selectedPort || selectedPort === 'No ports found' || selectedPort.startsWith('Error')) {
                return;
            }

            if (statusLabel) {
                statusLabel.textContent = isRecovery ? 'Opening (Recovery)...' : 'Connecting...';
                statusLabel.className = 'info';
            }

            // Call API to handle connection/navigation
            api.selectPort(selectedPort, isRecovery);
        });
    }

    // 3. Handle Errors (Electron specific feedback)
    api.onPortCheckFailed((message) => {
        console.log('Port check failed:', message);
        if (statusLabel) {
            statusLabel.textContent = message || 'Connection failed';
            statusLabel.className = 'error';
        }
    });
});

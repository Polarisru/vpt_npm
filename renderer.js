const { SerialPort } = require('serialport');
const { ipcRenderer } = require('electron');

console.log('Renderer script started');

// List ports when page loads
SerialPort.list()
    .then(ports => {
        console.log('Ports received:', ports);
        const select = document.getElementById('portSelect');
        
        if (ports.length === 0) {
            select.innerHTML = '<option>No ports found</option>';
        } else {
            select.innerHTML = '';  // Clear loading message
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
        select.innerHTML = '<option>Error: ' + err.message + '</option>';
    });

// Handle connect button click
const connectBtn = document.getElementById('connectBtn');
connectBtn.addEventListener('click', () => {
    const portSelect = document.getElementById('portSelect');
    const selectedPort = portSelect.value;
    
    if (selectedPort && selectedPort !== 'No ports found') {
        console.log('Sending port to main:', selectedPort);
        // Tell main process to open new window and close this one
        ipcRenderer.send('port-selected', selectedPort);
    }
});

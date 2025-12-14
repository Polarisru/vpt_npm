// src/renderer/js/app.js
const api = require('./api');
const ui = require('./ui-utils');
const ConnectionManager = require('./connection-manager');
const EepromManager = require('./eeprom-manager');
const PositionControl = require('./position-control');
const FirmwareManager = require('./firmware-manager');
const InfoManager = require('./info-manager');
const ScriptManager = require('./script-manager');
const MonitorManager = require('./monitor-manager');

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Managers
  const conn = new ConnectionManager();
  const eeprom = new EepromManager();
  const pos = new PositionControl();
  const fw = new FirmwareManager();
  const info = new InfoManager();
  const script = new ScriptManager();
  const monitor = new MonitorManager();
  
  pos.setConnectionManager(conn);
  script.setConnectionManager(conn);

  conn.init();
  eeprom.init();
  pos.init();
  fw.init();
  info.init();
  script.init();
  monitor.init();

  // 1. Listen for App Version from main process
  api.on('app-version', (event, version) => {
    const el = document.getElementById('swVer');
    if (el) {
      el.textContent = `Ver. ${version}`;
    }
  });

  // Listeners from Main Process
  api.on('update-progress', (event, data) => {
    if (data.current === 0) ui.showProgress(data.text);
    ui.updateProgress(data.current, data.total);
    if (data.current === data.total) {
        setTimeout(() => ui.hideProgress(), 1000);
    }
  });

  api.on('port-check-failed', (event, msg) => {
    ui.showError(msg);
    conn.disconnect();
  });

  // Tab Switching Logic (Simple)
  const tabs = document.querySelectorAll('.tab-link');
  const panes = document.querySelectorAll('.tab-pane');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        // Remove active class
        tabs.forEach(t => t.classList.remove('active'));
        panes.forEach(p => p.classList.remove('active'));
        
        // Add active
        tab.classList.add('active');
        const targetId = tab.dataset.tab;
        document.getElementById(targetId)?.classList.add('active');
        
        // Stop sine wave if leaving main tab
        if (targetId !== 'main-tab') {
            pos.stopSine();
        }
    });
  });

  // Close buttons for overlays
  document.getElementById('errorCloseBtn')?.addEventListener('click', () => {
      document.getElementById('errorOverlay').classList.add('hidden');
  });
  document.getElementById('successCloseBtn')?.addEventListener('click', () => {
      document.getElementById('successOverlay').classList.add('hidden');
  });
});

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
const FaqManager = require('./faq-manager');

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Managers
  const conn = new ConnectionManager();
  const eeprom = new EepromManager();
  const pos = new PositionControl();
  const fw = new FirmwareManager();
  const info = new InfoManager();
  const script = new ScriptManager();
  const monitor = new MonitorManager();
  const faqMgr = new FaqManager();

  pos.setConnectionManager(conn);
  script.setConnectionManager(conn);
  fw.setConnectionManager(conn);

  conn.init();
  eeprom.init();
  pos.init();
  fw.init();
  info.init();
  script.init();
  monitor.init();
  faqMgr.init();

  // 1. Listen for App Version from main process
  api.on('app-version', (event, version) => {
    const el = document.getElementById('swVer');
    if (el) {
      el.textContent = `SW Ver. ${version}`;
    }
  });

  api.on('selected-port', (event, data) => {
    const { portPath, fwVersion } = typeof data === 'string' ? { portPath: data, fwVersion: null } : data;
    
    // Display Port Name
    const portLabel = document.getElementById('portName');
    if (portLabel) {
      portLabel.textContent = portPath || 'Unknown';
    }

    // Display VPT Version & Handle Recovery Mode
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
        // Disable Disconnect/Connect toggling in recovery mode
        if (connectBtn) connectBtn.disabled = true;

        // Force enable update button even if not "connected" in the normal sense
        if (updateBtn) {
          updateBtn.disabled = false;
        }      
        
        ui.showError('Device in Recovery Mode (v00.00). Please update firmware.');
      }
    }
  });

  // Listeners from Main Process
  api.on('update-progress', (event, data) => {
    // --- CHANGED: Map step to current, handle start overlay logic ---
    const current = data.step || data.current; // Handle both just in case
    const total = data.total;

    if (current === 1 || current === 0) { 
         if (document.getElementById('progressOverlay').classList.contains('hidden')) {
             ui.showProgress('Updating Firmware...');
         }
    }

    ui.updateProgress(current, total);

    if (current >= total) {
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
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const targetId = tab.dataset.tab;
      document.getElementById(targetId)?.classList.add('active');
      if (targetId !== 'main-tab') {
        pos.stopSine();
      }
    });
  });

  document.getElementById('errorCloseBtn')?.addEventListener('click', () => {
    document.getElementById('errorOverlay').classList.add('hidden');
  });
  document.getElementById('successCloseBtn')?.addEventListener('click', () => {
    document.getElementById('successOverlay').classList.add('hidden');
  });
  document.getElementById('scriptResultCloseBtn')?.addEventListener('click', () => {
    document.getElementById('scriptResultOverlay').classList.add('hidden');
  });  
});

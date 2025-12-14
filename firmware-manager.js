// src/renderer/js/firmware-manager.js
const api = require('./api');
const ui = require('./ui-utils');

class FirmwareManager {
  constructor() {
    this.connManager = null;
  }

  // --- Added Method ---
  setConnectionManager(conn) {
    this.connManager = conn;
  }  
  
  init() {
    // Browse Buttons
    this.setupBrowse('fwBrowseBtn', 'fwFileInput', 'fwFileName');
    this.setupBrowse('eeBrowseBtn', 'eeFileInput', 'eeFileName');

    // Upload Button (EEPROM / Config Upload)
    const uploadBtn = document.getElementById('fwUploadBtn');
    const fileInput = document.getElementById('fwFileInput');
    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', () => this.handleUpload(fileInput));
    }

    // --- MISSING LISTENER ADDED HERE ---
    // Update Button (Main Firmware Update)
    const updateBtn = document.getElementById('updateBtn');
    if (updateBtn) {
        updateBtn.addEventListener('click', () => this.handleUpdate());
    }
  }

  setupBrowse(btnId, inputId, labelId) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    const label = document.getElementById(labelId);
    if (btn && input) {
      btn.addEventListener('click', () => { input.value = ''; input.click(); });
      input.addEventListener('change', () => {
        if (input.files[0] && label) label.textContent = input.files[0].name;
      });
    }
  }

  async handleUpdate() {
    const res = await api.selectHexFile();
    if (res.canceled || !res.filePaths.length) return;
    
    const filePath = res.filePaths[0];
    ui.showProgress('VPT Firmware Update', 'Parsing...');

    try {
        const content = await api.readFile(filePath);
        
        // Use the robust parser
        const { pages, totalPages, startAddress } = this.parseIntelHex(content);
        
        if (pages.length === 0) throw new Error('No data');

        ui.showProgress('VPT Firmware Update', `Updating ${totalPages} pages...`);
        
        await api.performUpdate(pages, totalPages);
        ui.showSuccess('VPT Update Complete');
    } catch(e) {
        ui.showError(e.message);
    } finally {
        ui.hideProgress();
    }
  }
  
  async handleUpload(fileInput) {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      ui.showError('No HEX file selected');
      return;
    }

    const btn = document.getElementById('fwUploadBtn');
    if (btn) btn.disabled = true;
    
    // --- 1. STOP POLLING ---
    if (this.connManager) this.connManager.stopPolling();

    ui.showProgress('Uploading Servo Firmware', `Parsing ${file.name}...`);

    try {
      const text = await this.readFileFromInput(file);
      // Use the corrected parseIntelHex from our previous fix
      const { pages, totalPages } = this.parseIntelHex(text);
      
      if (pages.length === 0) throw new Error('No valid data in HEX');

      ui.showProgress('Uploading Servo Firmware', 'Starting upload...');
      await api.performUpload(pages, totalPages);
      ui.showSuccess('Upload Complete');
    } catch (e) {
      console.error(e);
      ui.showError('Upload failed: ' + e.message);
    } finally {
      ui.hideProgress();
      if (btn) btn.disabled = false;
      
      // --- 2. RESUME POLLING ---
      if (this.connManager) this.connManager.startPolling();
    }
  }

  readFileFromInput(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = e => reject(e);
      reader.readAsText(file);
    });
  }

  parseIntelHex(hexString) {
    const lines = hexString.trim().split(/\r?\n/);
    const memory = new Map();
    let minAddress = Infinity;
    let maxAddress = 0;
    let segmentAddress = 0;

    // 1. Parse (Same as before)
    for (const line of lines) {
      if (!line.startsWith(':')) continue;
      const byteCount = parseInt(line.substr(1, 2), 16);
      const addr = parseInt(line.substr(3, 4), 16);
      const recordType = parseInt(line.substr(7, 2), 16);
      const dataStr = line.substr(9, byteCount * 2);

      if (recordType === 0) {
        for (let i = 0; i < byteCount; i++) {
          const byte = parseInt(dataStr.substr(i * 2, 2), 16);
          const fullAddr = segmentAddress + addr + i;
          memory.set(fullAddr, byte);
          if (fullAddr < minAddress) minAddress = fullAddr;
          if (fullAddr > maxAddress) maxAddress = fullAddr;
        }
      } 
      else if (recordType === 1) break;
      else if (recordType === 2) segmentAddress = parseInt(dataStr, 16) << 4;
      else if (recordType === 4) segmentAddress = parseInt(dataStr, 16) << 16;
    }

    if (memory.size === 0) return { pages: [], totalPages: 0, startAddress: 0 };

    // 2. Normalize and Paginate
    const PAGE_SIZE = 256;
    
    // We want the first page to be index 0.
    // So we treat minAddress as offset 0.
    // However, we must align minAddress to a page boundary relative to itself?
    // Usually, we align minAddress down to the nearest page start, 
    // and then subtract that base from everything.
    
    const baseAddress = Math.floor(minAddress / PAGE_SIZE) * PAGE_SIZE;
    const totalBytes = maxAddress - baseAddress + 1;
    const totalPages = Math.ceil(totalBytes / PAGE_SIZE);

    const pages = [];

    for (let i = 0; i < totalPages; i++) {
      const pageOffset = i * PAGE_SIZE; // Relative offset (0, 256, 512...)
      const physicalAddrStart = baseAddress + pageOffset;
      
      const pageData = new Uint8Array(PAGE_SIZE).fill(0xFF);
      let hasData = false;

      for (let j = 0; j < PAGE_SIZE; j++) {
        const addr = physicalAddrStart + j;
        if (memory.has(addr)) {
          pageData[j] = memory.get(addr);
          hasData = true;
        }
      }

      if (hasData) {
        pages.push({
          index: i, // ALWAYS relative index (0, 1, 2...)
          data: Array.from(pageData)
        });
      }
    }

    return { 
        pages, 
        totalPages: pages.length, 
        startAddress: baseAddress 
    };
  }
}

module.exports = FirmwareManager;

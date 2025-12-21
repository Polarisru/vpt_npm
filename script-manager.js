const api = require('./api');
const ui = require('./ui-utils');
const { ipcRenderer } = require('electron'); // Need direct access for the specific wait logic
const ScriptRunner = require('./script-runner');

class ScriptManager {
  constructor() {
    this.currentRunner = null;
    this.scriptRunning = false;
    this.connManager = null;
  }

  setConnectionManager(conn) {
    this.connManager = conn;
  }

  init() {
    this.setupBrowse();
    this.setupRun();
    this.setupSave();
  }

  setupBrowse() {
    const browseBtn = document.getElementById('scriptBrowseBtn');
    const fileInput = document.getElementById('scriptFileInput');
    const scriptInput = document.getElementById('scriptInput');
    const scriptOutput = document.getElementById('scriptOutput');

    if (browseBtn && fileInput) {
      browseBtn.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
      });

      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
          if (scriptInput) scriptInput.value = e.target.result;
          if (scriptOutput) scriptOutput.value = ''; 
        };
        reader.onerror = (e) => {
          ui.showError('Failed to read script file');
        };
        reader.readAsText(file);
      });
    }
  }

  setupRun() {
    const runBtn = document.getElementById('scriptRunBtn');
    const scriptInput = document.getElementById('scriptInput');
    const scriptOutput = document.getElementById('scriptOutput');

    if (runBtn && scriptInput && scriptOutput) {
      runBtn.addEventListener('click', async () => {
        if (this.scriptRunning && this.currentRunner) {
          this.currentRunner.stop();
          this.scriptRunning = false;
          runBtn.textContent = 'Run';
          this.setButtonsEnabled(true);
          if (this.connManager) this.connManager.startPolling();
          return;
        }

        const script = scriptInput.value.trim();
        if (!script) {
          ui.showError('Script is empty');
          return;
        }

        if (this.connManager) this.connManager.stopPolling();

        this.setButtonsEnabled(false);
        runBtn.textContent = 'Stop';
        this.scriptRunning = true;
        scriptOutput.value = '';

        const logFn = (msg) => {
          scriptOutput.value += msg + '\n';
          scriptOutput.scrollTop = scriptOutput.scrollHeight;
        };

        const uartWrapper = {
          isOpen: () => true,
          send: async (cmd) => {
              // Send blind
              await api.sendTextCommand(cmd, ''); 
          },
          // sendAndWait: async (cmd, matcher, timeout) => {
             // // Wait for "OK" explicitly using the new main.js logic
             // try {
                 // const res = await ipcRenderer.invoke('uart-send-wait', cmd, 'OK', timeout || 3000);
                 // return res; 
             // } catch(e) {
                 // return false; // ScriptRunner expects false/null on failure?
             // }
          // },
          sendAndWait: async (cmd, matcherHint, timeout) => {
              // Pass matcherHint directly (it is now 'OK' or null)
              return await ipcRenderer.invoke('uart-send-wait', cmd, matcherHint, timeout);
          },         
          emitter: { on: () => {}, removeListener: () => {} }
        };

        try {
          this.currentRunner = new ScriptRunner(script, uartWrapper, logFn);
          const resultText = await this.currentRunner.run();
          
          if (resultText && resultText.trim()) {
            const overlay = document.getElementById('scriptResultOverlay');
            const msgEl = document.getElementById('scriptResultMessage');
            if (overlay && msgEl) {
              msgEl.textContent = resultText;
              overlay.classList.remove('hidden');
            }
          }          
        } catch (e) {
          console.error('Script failed:', e);
          logFn(`ERROR: ${e.message}`);
        } finally {
          this.scriptRunning = false;
          runBtn.textContent = 'Run';
          this.currentRunner = null;
          this.setButtonsEnabled(true);
          if (this.connManager) this.connManager.startPolling();
        }
      });
    }
  }

  setupSave() {
    const saveBtn = document.getElementById('scriptSaveOutputBtn');
    const scriptOutput = document.getElementById('scriptOutput');
    if (saveBtn && scriptOutput) {
      saveBtn.addEventListener('click', async () => {
        const content = scriptOutput.value;
        if (!content) {
          ui.showError('No output to save');
          return;
        }
        try {
          const { canceled, filePath } = await api.saveDialog({
            title: 'Save Script Output',
            defaultPath: 'script-output.txt',
            filters: [{ name: 'Text Files', extensions: ['txt'] }]
          });
          if (!canceled && filePath) {
            await api.writeFile(filePath, content);
          }
        } catch (e) {
          ui.showError('Save failed: ' + e.message);
        }
      });
    }
  }

  setButtonsEnabled(enabled) {
    const browse = document.getElementById('scriptBrowseBtn');
    const save = document.getElementById('scriptSaveOutputBtn');
    if (browse) browse.disabled = !enabled;
    if (save) save.disabled = !enabled;
  }
}

module.exports = ScriptManager;

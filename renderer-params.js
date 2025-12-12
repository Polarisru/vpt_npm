// renderer-params.js

module.exports = function initParamsTab(ctx) {
  const { readBtn, writeBtn, saveBtn, loadBtn, formatError, showError } = ctx;
  const { readParamFromDevice, collectCurrentParams, buildParamTable, clearParamTable } = ctx.paramsApi;

  if (writeBtn) {
    writeBtn.addEventListener('click', async () => {
      const paramsToWrite = collectCurrentParams();
      if (!paramsToWrite.length) return;

      writeBtn.disabled = true;
      ctx.showProgress && ctx.showProgress('Writing parameters', 'Writing EEPROM parameters...');
      const total = paramsToWrite.length;
      let step = 0;

      try {
        for (const p of paramsToWrite) {
          await ctx.devApi.writeParam(p.address, p.type, p.value); // or ipcRenderer.invoke('write-param')
          step += 1;
          ctx.updateProgress && ctx.updateProgress(step, total);
        }
        console.log('All parameters written successfully');
      } catch (e) {
        console.error('Write failed:', e);
        const cleanMessage = formatError(e);
        showError ? showError('Error while writing parameters: ' + cleanMessage)
                  : alert('Error while writing parameters: ' + cleanMessage);
      } finally {
        ctx.hideProgress && ctx.hideProgress();
        writeBtn.disabled = false;
      }
    });
  }

  if (readBtn) {
    readBtn.addEventListener('click', async () => {
      const inputs = document.querySelectorAll('#paramTable tbody input');
      if (!inputs.length) return;

      readBtn.disabled = true;
      ctx.showProgress && ctx.showProgress('Reading parameters', 'Reading EEPROM parameters...');
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

          const displayVal = (raw / mult) / div + offset;
          inp.value = String(displayVal);
          inp.dispatchEvent(new Event('blur'));

          step += 1;
          ctx.updateProgress && ctx.updateProgress(step, total);
        }
        console.log('All parameters read from device');
      } catch (e) {
        console.error('Read failed:', e);
        const cleanMessage = formatError(e);
        showError ? showError('Error while reading parameters: ' + cleanMessage)
                  : alert('Error while reading parameters: ' + cleanMessage);
      } finally {
        ctx.hideProgress && ctx.hideProgress();
        readBtn.disabled = false;
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const deviceName = ctx.deviceSelect ? ctx.deviceSelect.value : '';
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
      const safeName = deviceName.replace(/[^a-z0-9-]/gi, '_');
      const filename = `params-${safeName}.json`;
      ctx.downloadJsonFile && ctx.downloadJsonFile(filename, jsonStr);
    });
  }

  if (loadBtn && ctx.loadFileInput) {
    loadBtn.addEventListener('click', () => {
      ctx.loadFileInput.value = '';
      ctx.loadFileInput.click();
    });

    ctx.loadFileInput.addEventListener('change', () => {
      const file = ctx.loadFileInput.files && ctx.loadFileInput.files[0];
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
            const match = Array.from(inputs).find(inp =>
              String(inp.dataset.name) === String(p.name) &&
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
};

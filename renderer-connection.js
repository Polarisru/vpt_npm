// renderer-connection.js

module.exports = function initConnectionTab(ctx) {
  const {
    devApi,
    connectBtn,
    connectionHint,
    contentOverlay,
    setConnected,
    isConnected,
    setSidebarEnabled,
    updateUpdateButtonState
  } = ctx;

  if (!connectBtn) return;

  let statusTimer = null;
  let pollStep = 0;
  let missedPolls = 0;
  const POLL_INTERVAL_MS = 1000;
  const MAX_MISSED_POLLS = 9;

  function startStatusPolling() {
    if (statusTimer) return;
    console.log('Status timer started');
    statusTimer = setInterval(pollStatusOnce, POLL_INTERVAL_MS);
  }

  function stopStatusPolling() {
    if (!statusTimer) return;
    console.log('Status timer stopped');
    clearInterval(statusTimer);
    statusTimer = null;
  }

  function disconnectWithMessage(message) {
    console.warn(message);

    if (connectBtn && connectBtn.textContent === 'Disconnect') {
      connectBtn.click();
    }
    if (connectionHint) {
      connectionHint.textContent = message;
      connectionHint.style.color = 'red';
      connectionHint.style.fontWeight = 'bold';
    }
  }

  async function pollStatusOnce() {
    if (!isConnected()) return;

    try {
      switch (pollStep) {
        case 0: { // Voltage
          const v = await devApi.readSupply();
          const vEl = document.getElementById('supplyValue');
          if (vEl) {
            vEl.textContent = (typeof v === 'number') ? v.toFixed(1) : '--.-';
          }
          missedPolls = 0;
          break;
        }
        case 1: { // Temperature
          const t = await devApi.readTemperature();
          const tEl = document.getElementById('temperatureValue');
          if (tEl) {
            tEl.textContent = (typeof t === 'number') ? t.toFixed(1) : '--.-';
          }
          missedPolls = 0;
          break;
        }
        case 2: { // Status
          const s = await devApi.readStatus();
          if (s !== null && typeof s === 'number') {
            missedPolls = 0;

            // Bit0 -> device requests disconnect
            if ((s & 0x01) !== 0) {
              disconnectWithMessage('Device reset or not configured. Connection closed.');
              return;
            }

            const displayStatus = s & ~0x01;
            if (connectionHint) {
              if (displayStatus === 0) {
                connectionHint.textContent = 'Connected';
                connectionHint.style.color = '';
                connectionHint.style.fontWeight = 'normal';
              } else {
                connectionHint.textContent = 'ERROR';
                connectionHint.style.color = 'red';
                connectionHint.style.fontWeight = 'bold';
              }
            }
          } else {
            missedPolls++;
          }
          break;
        }
      }

      pollStep = (pollStep + 1) % 3;
    } catch (e) {
      console.error('Status poll step ' + pollStep + ' failed:', e);
      missedPolls++;
    }

    if (missedPolls >= MAX_MISSED_POLLS) {
      disconnectWithMessage('Device not responding. Connection closed.');
      missedPolls = 0;
    }
  }

  // Expose start/stop to other tabs (e.g. firmware)
  ctx.startStatusPolling = startStatusPolling;
  ctx.stopStatusPolling = stopStatusPolling;

  connectBtn.addEventListener('click', async () => {
    console.log('connectBtn click');

    if (!isConnected()) {
      // Connect
      const cfg = ctx.collectConnectionConfig();
      try {
        await devApi.connInit(cfg);
        setConnected(true);
        startStatusPolling();
        connectBtn.textContent = 'Disconnect';
        if (contentOverlay) contentOverlay.classList.add('hidden');
        if (connectionHint) connectionHint.textContent = 'Connected';
        if (setSidebarEnabled) setSidebarEnabled(false);
        if (updateUpdateButtonState) updateUpdateButtonState();
      } catch (e) {
        console.log('catch block entered');
        console.error('Connection init failed:', e);
        if (connectionHint) connectionHint.textContent = 'Connection failed';
      }
    } else {
      // Disconnect
      if (ctx.stopScriptAndResetUI) ctx.stopScriptAndResetUI();
      try {
        await devApi.connPower(false);
      } catch (e) {
        console.error('PWR0 failed:', e);
      }

      setConnected(false);
      stopStatusPolling();
      if (ctx.stopSine) ctx.stopSine();
      if (ctx.updateStatusFields) ctx.updateStatusFields(null, null);

      connectBtn.textContent = 'Connect';
      if (contentOverlay) contentOverlay.classList.remove('hidden');
      if (connectionHint) {
        connectionHint.textContent = 'Select connection and press Connect';
        connectionHint.style.color = '';
        connectionHint.style.fontWeight = 'normal';
      }
      if (setSidebarEnabled) setSidebarEnabled(true);
      if (updateUpdateButtonState) updateUpdateButtonState();
    }
  });
};

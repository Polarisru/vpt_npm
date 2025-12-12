// renderer-motion.js

module.exports = function initMotionTab(ctx) {
  const { devApi, position } = ctx;
  if (!position) return;

  const {
    slider,
    label,
    minBtn,
    maxBtn,
    devicePositionLabel,
    sineAmpInput,
    sineOffsetInput,
    sineFreqInput,
    sineWaveform,
    sineStartStopBtn
  } = position;

  if (!slider || !label) return;

  // --- position label updater ---
  let updatePositionLabel = null;

  updatePositionLabel = () => {
    label.textContent = parseFloat(slider.value || '0').toFixed(1);
  };

  async function sendPosition() {
    if (!ctx.isConnected()) return;
    const degrees = parseFloat(slider.value || '0');
    try {
      await devApi.setPosition(degrees);
      // success is ignored in UI
    } catch (e) {
      console.error('Failed to set position:', e);
      // optional: ctx.showError && ctx.showError('Failed to set position: ' + ctx.formatError(e));
    }
  }

  // manual slider move
  slider.addEventListener('input', () => {
    updatePositionLabel();
    sendPosition();
  });

  // min/max buttons
  if (minBtn) {
    minBtn.addEventListener('click', () => {
      slider.value = slider.min ?? '0';
      updatePositionLabel();
      sendPosition();
    });
  }

  if (maxBtn) {
    maxBtn.addEventListener('click', () => {
      slider.value = slider.max ?? '0';
      updatePositionLabel();
      sendPosition();
    });
  }

  // label click -> 0
  label.addEventListener('click', () => {
    slider.value = '0';
    updatePositionLabel();
    sendPosition();
  });

  // --- read device position (GPS/PS) ---
  if (devicePositionLabel) {
    devicePositionLabel.addEventListener('click', async () => {
      try {
        const resp = await devApi.readDevicePosition();
        const match = resp.trim().match(/^PS:(-?\d+\.\d+)$/);
        if (!match) {
          devicePositionLabel.textContent = '--.-°';
          return;
        }
        const num = Number(match[1]);
        const value = num.toFixed(1);
        devicePositionLabel.textContent = value + '°';
      } catch (e) {
        devicePositionLabel.textContent = '--.-°';
        console.error('Failed to read device position:', e);
      }
    });
  }

  // --- sinus/rect/saw movement driving the slider ---
  let sineTimer = null;
  let sineStartTime = null;
  let sineRunning = false;

  function stopSine() {
    if (sineTimer) {
      clearInterval(sineTimer);
      sineTimer = null;
    }
    sineRunning = false;
    if (sineStartStopBtn) sineStartStopBtn.textContent = 'Start';

    // re-enable controls
    if (sineWaveform) sineWaveform.disabled = false;
    if (sineAmpInput) sineAmpInput.disabled = false;
    if (sineOffsetInput) sineOffsetInput.disabled = false;
    if (sineFreqInput) sineFreqInput.disabled = false;
  }

  if (sineStartStopBtn) {
    sineStartStopBtn.addEventListener('click', () => {
      if (!sineRunning) {
        // Start
        let amp = parseFloat(sineAmpInput?.value || '0');
        let freq = parseFloat(sineFreqInput?.value || '0');
        let offset = parseFloat(sineOffsetInput?.value || '0');
        let wave = sineWaveform?.value || 'sine';

        if (!Number.isFinite(amp)) amp = 0;
        if (!Number.isFinite(freq) || freq <= 0) freq = 0.1;
        if (!Number.isFinite(offset)) offset = 0;

        // Clamp amplitude to slider range
        const minVal = parseFloat(slider.min ?? '-90');
        const maxVal = parseFloat(slider.max ?? '90');
        const center = (minVal + maxVal) / 2;
        const maxAmp = Math.min(Math.abs(maxVal - center), Math.abs(center - minVal));

        if (amp > maxAmp) amp = maxAmp;

        // Ensure offset ± amp stays within bounds
        if (offset - amp < minVal) offset = minVal + amp;
        if (offset + amp > maxVal) offset = maxVal - amp;

        if (sineAmpInput) sineAmpInput.value = amp.toString();
        if (sineFreqInput) sineFreqInput.value = freq.toString();
        if (sineOffsetInput) sineOffsetInput.value = offset.toString();
        if (!['sine', 'rect', 'saw'].includes(wave)) {
          wave = 'sine';
          if (sineWaveform) sineWaveform.value = wave;
        }

        // disable controls while running
        if (sineWaveform) sineWaveform.disabled = true;
        if (sineAmpInput) sineAmpInput.disabled = true;
        if (sineOffsetInput) sineOffsetInput.disabled = true;
        if (sineFreqInput) sineFreqInput.disabled = true;

        sineRunning = true;
        sineStartTime = performance.now();
        sineStartStopBtn.textContent = 'Stop';

        // 50 Hz -> 20 ms period for timer
        sineTimer = setInterval(() => {
          if (!sineRunning || !ctx.isConnected()) {
            stopSine();
            return;
          }

          const tSec = (performance.now() - sineStartTime) / 1000;
          const phase = (freq * tSec) % 1; // 0..1 each period
          let waveValue = 0;

          if (wave === 'sine') {
            waveValue = Math.sin(2 * Math.PI * phase);   // -1..1
          } else if (wave === 'rect') {
            waveValue = phase < 0.5 ? 1 : -1;
          } else if (wave === 'saw') {
            waveValue = 2 * phase - 1;                  // -1..1
          }

          const angle = offset + amp * waveValue;
          slider.value = angle.toFixed(1);
          updatePositionLabel();
          slider.dispatchEvent(new Event('input')); // will call sendPosition
        }, 20);
      } else {
        // Stop
        stopSine();
      }
    });
  }

  // ensure initial label is in sync
  updatePositionLabel();
};

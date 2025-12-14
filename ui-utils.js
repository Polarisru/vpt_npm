// src/renderer/js/ui-utils.js
module.exports = {
  showError(message) {
    const overlay = document.getElementById('errorOverlay');
    const msgEl = document.getElementById('errorMessage');
    if (overlay && msgEl) {
      msgEl.textContent = message;
      overlay.classList.remove('hidden');
    } else {
      alert(message);
    }
  },

  showSuccess(message) {
    const overlay = document.getElementById('successOverlay');
    const msgEl = document.getElementById('successMessage');
    if (overlay && msgEl) {
      msgEl.textContent = message;
      overlay.classList.remove('hidden');
    } else {
      alert(message);
    }
  },

  showProgress(title, message) {
    const overlay = document.getElementById('progressOverlay');
    const titleEl = document.getElementById('progressTitle');
    const textEl = document.getElementById('progressText');
    const bar = document.getElementById('progressBar');

    if (overlay) {
      if (titleEl) titleEl.textContent = title || 'Progress';
      if (textEl) textEl.textContent = message || '';
      if (bar) bar.style.width = '0%';
      overlay.classList.remove('hidden');
    }
  },

  updateProgress(current, total) {
    const bar = document.getElementById('progressBar');
    if (bar && total > 0) {
      const ratio = Math.max(0, Math.min(1, current / total));
      bar.style.width = (ratio * 100).toFixed(1) + '%';
    }
  },

  hideProgress() {
    const overlay = document.getElementById('progressOverlay');
    if (overlay) overlay.classList.add('hidden');
  },

  formatError(e) {
    if (!e) return 'Unknown error';
    const msg = e.message || String(e);
    const parts = msg.split('Error: ');
    return parts[parts.length - 1] || msg;
  }
};

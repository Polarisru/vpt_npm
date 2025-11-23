// upload-renderer.js

document.addEventListener('DOMContentLoaded', () => {
  const bar = document.getElementById('uploadBar');
  const percentLabel = document.getElementById('uploadPercent');

  let progress = 0;
  const stepMs = 80; // ~8s total

  const timer = setInterval(() => {
    progress += 2; // 2% per tick
    if (progress > 100) progress = 100;

    if (bar) bar.style.width = progress + '%';
    if (percentLabel) percentLabel.textContent = progress + '%';

    if (progress >= 100) {
      clearInterval(timer);
      setTimeout(() => {
        window.close();   // close this BrowserWindow
      }, 400);
    }
  }, stepMs);
});

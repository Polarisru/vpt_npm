// src/renderer/js/faq-manager.js
const api = require('./api');
const ui = require('./ui-utils');

class FaqManager {
  init() {
    const container = document.querySelector('#faq-tab .faq-container');
    if (!container) return;

    const questions = container.querySelectorAll('.faq-question');

    questions.forEach(q => {
      const answer = q.nextElementSibling;
      if (!answer || !answer.classList.contains('faq-answer')) return;

      // hide all answers initially
      answer.style.display = 'none';

      q.addEventListener('click', () => {
        const isVisible = answer.style.display === 'block';
        answer.style.display = isVisible ? 'none' : 'block';
      });
    });
  }
}

module.exports = FaqManager;

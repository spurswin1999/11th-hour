'use strict';

const statusEl = document.getElementById('status');

chrome.storage.session.get(['capturedPDF', 'capturedText', 'capturedAt', 'pageUrl'], (result) => {
  const age = Math.round((Date.now() - result.capturedAt) / 60000);
  const ageStr = age < 1 ? 'just now' : age + 'm ago';
  const set = (cls, msg) => {
    statusEl.className = `status ${cls}`;
    statusEl.innerHTML = `<span class="dot"></span><span>${msg}</span>`;
  };
  if (result.capturedPDF) {
    const kb = Math.round(atob(result.capturedPDF).length / 1024);
    set('ok', `Document captured — ${kb} KB PDF, ${ageStr}`);
  } else if (result.capturedText) {
    const kb = Math.round(result.capturedText.length / 1024);
    set('ok', `Document captured — ${kb} KB text, ${ageStr}`);
  } else {
    set('warn', 'No document captured yet. Navigate to a DocuSign signing page first.');
  }
});

document.getElementById('btn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('compare.html') });
});

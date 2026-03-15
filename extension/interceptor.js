// interceptor.js — injected directly into page context to patch fetch/XHR
(function () {
  'use strict';
  if (window.__eleventhHourInstalled) return;
  window.__eleventhHourInstalled = true;

  function looksLikePDF(url, contentType) {
    if (contentType && contentType.includes('pdf')) return true;
    if (url && /\/(content|pdf|document|download)\b/i.test(url)) return true;
    return false;
  }

  function dispatch(buffer, source) {
    if (!buffer || buffer.byteLength < 500) return;
    console.log(`[11th Hour] dispatching PDF: ${(buffer.byteLength / 1024).toFixed(0)} KB from ${source}`);
    window.postMessage({ type: 'ELEVENTH_HOUR_PDF_CAPTURED', buffer: buffer }, '*', [buffer]);
  }

  // ── Patch fetch ─────────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0]
      : args[0] instanceof Request ? args[0].url : '';
    let response;
    response = await origFetch.apply(this, args);

    try {
      const ct = response.headers.get('content-type') || '';
      const cl = parseInt(response.headers.get('content-length') || '0', 10);

      if (cl > 50000 || looksLikePDF(url, ct)) {
        console.log(`[11th Hour] large fetch: ${url.substring(0, 100)} | type=${ct} | size=${cl}`);
      }

      // When we see the envelope API call, capture the JSON and extract base URL (first call only)
      if (!window.__eleventhHourEnvelopeCaptured && (url.includes('/Signing/envelope') || url.includes('/Signing/Envelope'))) {
        window.__eleventhHourEnvelopeCaptured = true;
        const base = url.replace(/\/[Ee]nvelope.*$/, '');
        response.clone().json().then(data => {
          console.log('[11th Hour] envelope keys:', Object.keys(data).join(', '));
          window.postMessage({ type: 'ELEVENTH_HOUR_ENVELOPE_DATA', base, data }, '*');
        }).catch(e => {
          // JSON parse failed — just send base URL
          window.postMessage({ type: 'ELEVENTH_HOUR_SIGNING_BASE', base }, '*');
        });
      }

      if (looksLikePDF(url, ct)) {
        response.clone().arrayBuffer().then(buf => dispatch(buf, 'fetch')).catch(() => {});
      }
    } catch (_) {}
    return response;
  };

  // ── Patch XHR ───────────────────────────────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__psUrl = url;
    return origOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('readystatechange', function () {
      if (this.readyState !== 4) return;
      try {
        const ct = this.getResponseHeader('content-type') || '';
        const url = this.__psUrl || '';
        const size = this.response?.byteLength || 0;

        if (size > 50000 || looksLikePDF(url, ct)) {
          console.log(`[11th Hour] large XHR: ${url.substring(0, 100)} | type=${ct} | size=${size}`);
        }

        if (looksLikePDF(url, ct) && this.response instanceof ArrayBuffer) {
          dispatch(this.response.slice(0), 'xhr');
        }
      } catch (_) {}
    });
    return origSend.apply(this, args);
  };

  // ── Detect Workers ──────────────────────────────────────────────────────────
  const OrigWorker = window.Worker;
  window.Worker = function (url, opts) {
    console.log('[11th Hour] Worker created:', String(url).substring(0, 100));
    return new OrigWorker(url, opts);
  };
  window.Worker.prototype = OrigWorker.prototype;
})();

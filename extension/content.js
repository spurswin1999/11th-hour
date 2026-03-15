'use strict';

const IN_IFRAME = window !== window.top;

console.log(`[11th Hour] content script loaded | ${IN_IFRAME ? 'IFRAME' : 'MAIN'} | ${location.href.substring(0, 80)}`);

// ── 1. Inject fetch/XHR interceptor immediately ───────────────────────────────
const script = document.createElement('script');
script.src = chrome.runtime.getURL('interceptor.js');
script.onload = () => {
  console.log(`[11th Hour] interceptor injected | ${IN_IFRAME ? 'IFRAME' : 'MAIN'}`);
  script.remove();

  if (!IN_IFRAME) tryProactiveFetch();

  if (document.readyState !== 'loading') { scanDOM(); if (IN_IFRAME) scheduleDOMExtraction(); }
  else document.addEventListener('DOMContentLoaded', () => { scanDOM(); if (IN_IFRAME) scheduleDOMExtraction(); });
};
(document.head || document.documentElement).appendChild(script);

// ── 2. Proactive fetch — try DocuSign signing API PDF and envelope endpoints ──
// DocuSign signing sessions use a `ti` token. With an active session cookie,
// the server returns the PDF when we request the download endpoint.
// We also try fetching the envelope JSON directly — this catches cases where
// the interceptor missed the fetch (e.g. because of authenticate→sign redirect).
function tryProactiveFetch() {
  const params = new URLSearchParams(window.location.search);
  const ti = params.get('ti');
  if (!ti) return;

  // Extract region from the `site` query param (e.g. "NA4.docusign.net" → "na4")
  const site = params.get('site') || '';
  const regionMatch = site.match(/^([^.]+)/);
  const region = regionMatch ? regionMatch[1].toLowerCase() : null;

  console.log(`[11th Hour] proactive fetch | ti=${ti.substring(0, 12)}... | region=${region || 'unknown'}`);

  (async () => {
    // First: try the envelope JSON directly using the known region
    if (region) {
      try {
        const envelopeUrl = `/api/esign/${region}/Signing/envelope?ti=${ti}&insession=1`;
        const r = await fetch(envelopeUrl, { credentials: 'include' });
        const ct = r.headers.get('content-type') || '';
        console.log(`[11th Hour] envelope fetch ${envelopeUrl} → ${r.status} ${ct}`);
        if (r.ok && ct.includes('json')) {
          const data = await r.json();
          console.log('[11th Hour] envelope fetched directly | keys:', Object.keys(data).join(', '));
          const base = `/api/esign/${region}/Signing`;
          tryFromEnvelopeData(base, data);
          return;
        }
      } catch (e) {
        console.log(`[11th Hour] envelope direct fetch failed: ${e.message}`);
      }
    }

    // Fallback: try common PDF download URL patterns
    const candidates = [
      `/sign/api/pdf?ti=${ti}&insession=1`,
      `/sign/download?ti=${ti}&insession=1`,
      `/sign/print?ti=${ti}&insession=1`,
      `/sign/api/download?ti=${ti}&insession=1`,
    ];
    for (const path of candidates) {
      try {
        const r = await fetch(path, { credentials: 'include' });
        const ct = r.headers.get('content-type') || '';
        console.log(`[11th Hour] proactive fetch ${path} → ${r.status} ${ct}`);
        if (r.ok && ct.includes('pdf')) {
          const buf = await r.arrayBuffer();
          if (buf.byteLength > 1000) {
            captureBuffer(new Uint8Array(buf));
            console.log(`[11th Hour] proactive fetch succeeded: ${(buf.byteLength / 1024).toFixed(0)} KB`);
            return;
          }
        }
      } catch (e) {
        console.log(`[11th Hour] proactive fetch ${path} failed: ${e.message}`);
      }
    }
    console.log('[11th Hour] proactive fetch exhausted — will rely on interceptor');
  })();
}

// ── 3. DOM scan ───────────────────────────────────────────────────────────────
function scanDOM() {
  document.querySelectorAll('iframe').forEach((f, i) => {
    console.log(`[11th Hour] iframe[${i}] src=${f.src || '(no src)'}`);
  });
  document.querySelectorAll('embed, object').forEach((e, i) => {
    const src = e.src || e.data || '(no src)';
    console.log(`[11th Hour] embed[${i}] src=${src}`);
    if (src.toLowerCase().includes('pdf') || (e.type || '').includes('pdf')) {
      directFetch(src);
    }
  });
}

// ── 4. Receive messages from interceptor ─────────────────────────────────────
window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  // PDF captured directly via fetch/XHR intercept
  if (event.data?.type === 'ELEVENTH_HOUR_PDF_CAPTURED') {
    const buffer = event.data.buffer;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 500) return;
    console.log(`[11th Hour] PDF captured via interceptor | ${(buffer.byteLength / 1024).toFixed(0)} KB`);
    captureBuffer(new Uint8Array(buffer));
    if (IN_IFRAME) chrome.runtime.sendMessage({ type: 'PDF_CAPTURED_IN_FRAME' });
    else setButtonState('ready');
  }

  // Interceptor found the signing API base URL from the envelope fetch
  if (event.data?.type === 'ELEVENTH_HOUR_SIGNING_BASE' && !IN_IFRAME) {
    _envelopeBase = event.data.base;
    trySigningApiDownload(event.data.base);
  }

  // Interceptor captured the full envelope JSON
  if (event.data?.type === 'ELEVENTH_HOUR_ENVELOPE_DATA' && !IN_IFRAME) {
    const { base, data } = event.data;
    _envelopeBase = base;
    console.log('[11th Hour] envelope data:', JSON.stringify(data).substring(0, 500));
    tryFromEnvelopeData(base, data);
  }
});

// ── 4b. Try real DocuSign signing API download endpoints ──────────────────────
async function trySigningApiDownload(base) {
  const ti = new URLSearchParams(window.location.search).get('ti');
  if (!ti) return;

  // Try likely download paths under the discovered signing API base
  const candidates = [
    `${base}/download?ti=${ti}&insession=1`,
    `${base}/Download?ti=${ti}&insession=1`,
    `${base}/pdf?ti=${ti}&insession=1`,
    `${base}/Pdf?ti=${ti}&insession=1`,
    `${base}/Print?ti=${ti}&insession=1`,
  ];

  console.log(`[11th Hour] trying signing API endpoints under ${base}`);

  for (const url of candidates) {
    try {
      const r = await fetch(url, { credentials: 'include' });
      const ct = r.headers.get('content-type') || '';
      console.log(`[11th Hour] signing API ${url.replace(base, '')} → ${r.status} ${ct}`);
      if (r.ok && ct.includes('pdf')) {
        const buf = await r.arrayBuffer();
        if (buf.byteLength > 1000) {
          console.log(`[11th Hour] signing API capture succeeded: ${(buf.byteLength / 1024).toFixed(0)} KB`);
          captureBuffer(new Uint8Array(buf));
          return;
        }
      }
    } catch (e) {
      console.log(`[11th Hour] signing API fetch error: ${e.message}`);
    }
  }
  console.log('[11th Hour] signing API exhausted — will capture on Download click');
}

// ── 4c. Extract text from htmlDocuments embedded in envelope JSON ─────────────
// DocuSign embeds the full document HTML inside the envelope JSON as:
//   ["{{<json metadata>}}\n<div...actual html content...>"]
// Strip the {{...}} template prefix and parse the HTML to get clean text.
function extractFromHtmlDocuments(htmlDocs) {
  const parts = [];
  for (const htmlStr of htmlDocs) {
    if (typeof htmlStr !== 'string') continue;
    // The HTML content starts at the first "\n<" after the template metadata
    const htmlStart = htmlStr.indexOf('\n<');
    const htmlContent = htmlStart >= 0 ? htmlStr.substring(htmlStart + 1) : htmlStr;
    try {
      const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
      // Remove hidden elements (DocuSign renders tab placeholders as hidden spans)
      doc.querySelectorAll('[style*="display:none"], [style*="display: none"], [aria-hidden="true"]')
        .forEach(el => el.remove());
      let text = doc.body.innerText.trim();
      // Strip DocuSign tab JSON placeholders: {"tabId":"...", "tabType":"SignHere"} etc.
      text = text.replace(/\{[^}]*"tabId"\s*:[^}]*\}/g, '').replace(/\s{2,}/g, ' ').trim();
      if (text.length > 100) parts.push(text);
    } catch (_) {
      // Fallback: strip tags manually
      const text = htmlContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text.length > 100) parts.push(text);
    }
  }
  const combined = parts.join('\n\n').trim();
  return combined.length > 200 ? combined : null;
}

// ── 4d. Try doc ID endpoints and envelope metadata ────────────────────────────
async function tryFromEnvelopeData(base, data) {
  const ti = new URLSearchParams(window.location.search).get('ti');
  if (!ti) return;

  // Log menuItems — this contains the DocuSign download menu action URLs
  if (data.menuItems) {
    console.log('[11th Hour] menuItems:', JSON.stringify(data.menuItems).substring(0, 1000));
  }

  // Extract document text from embedded HTML in htmlDocuments array
  if (data.htmlDocuments?.length) {
    const text = extractFromHtmlDocuments(data.htmlDocuments);
    if (text) {
      console.log(`[11th Hour] document text extracted from envelope htmlDocuments | ${text.length} chars`);
      captureText(text);
      return; // done — no need for DOM scanning or API calls
    }
  }

  // Walk the envelope data looking for document arrays and IDs
  // DocuSign envelope responses vary — log what we find
  const docs = data.documents || data.documentList || data.envelopeDocuments
    || data.Documents || data.Signers?.[0]?.documents || [];

  if (docs.length > 0) {
    console.log('[11th Hour] found documents in envelope:', JSON.stringify(docs).substring(0, 300));
  }

  // Look for any URL fields that might be download links
  const str = JSON.stringify(data);
  const urlMatches = str.match(/https?:[^"]+\.(pdf|aspx)[^"]*/gi) || [];
  urlMatches.forEach(u => console.log('[11th Hour] URL in envelope data:', u.substring(0, 120)));

  // Try constructing download URLs using doc IDs found
  for (const doc of docs.slice(0, 3)) {
    const docId = doc.documentId || doc.DocumentId || doc.id || doc.Id;
    if (!docId) continue;
    const candidates = [
      `${base}/documents/${docId}?ti=${ti}&insession=1`,
      `${base}/Document/${docId}?ti=${ti}&insession=1`,
    ];
    for (const url of candidates) {
      try {
        const r = await fetch(url, { credentials: 'include' });
        const ct = r.headers.get('content-type') || '';
        console.log(`[11th Hour] doc fetch ${url.replace(base, '')} → ${r.status} ${ct}`);
        if (r.ok && ct.includes('pdf')) {
          const buf = await r.arrayBuffer();
          if (buf.byteLength > 1000) {
            console.log(`[11th Hour] doc fetch succeeded: ${(buf.byteLength / 1024).toFixed(0)} KB`);
            captureBuffer(new Uint8Array(buf));
            return;
          }
        }
      } catch (_) {}
    }
  }
}

// ── 5. DOM text extraction ────────────────────────────────────────────────────
// DocuSign renders HTML documents inline — extract the text directly from the DOM.
let _domExtractionDone = false;

function scheduleDOMExtraction() {
  // Don't use chrome.storage inside setTimeout — it fails in some contexts.
  // Use a module-level flag to avoid redundant extractions.
  [1000, 3000, 7000].forEach(delay => {
    setTimeout(() => { if (!_domExtractionDone) extractDocText(); }, delay);
  });
}

function extractDocText() {
  if (_domExtractionDone) return;

  // Log top-5 elements by text length so we can identify the right selector
  const allEls = Array.from(document.querySelectorAll('div, section, article, main'));
  const top5 = allEls
    .map(el => ({ tag: el.tagName, cls: el.className.toString().substring(0, 60), len: (el.innerText || '').length }))
    .filter(x => x.len > 200)
    .sort((a, b) => b.len - a.len)
    .slice(0, 5);
  console.log('[11th Hour] DOM top elements by text length:', JSON.stringify(top5));

  // Selectors that DocuSign may use for the document viewer
  const SELECTORS = [
    '[class*="DocumentContentView"]',
    '[class*="documentContent"]',
    '[class*="document-content"]',
    '[class*="signingDocument"]',
    '[class*="signing-document"]',
    '[class*="htmlDocument"]',
    '[class*="html-document"]',
    '[class*="PageContent"]',
    '[class*="page-content"]',
    '[class*="docContent"]',
    '[class*="doc-content"]',
    '[class*="HtmlDoc"]',
    '#docContent',
    '#signingDocument',
    'main article',
    '[role="document"]',
    '[role="main"]',
  ];

  for (const sel of SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 200) {
        console.log(`[11th Hour] DOM extraction via "${sel}" | ${el.innerText.length} chars`);
        _domExtractionDone = true;
        captureText(el.innerText);
        return;
      }
    } catch (_) {}
  }

  // Heuristic: find the element with the most text and fewest buttons (= least UI chrome)
  let best = null, bestScore = 0;
  allEls.forEach(el => {
    const len = (el.innerText || '').length;
    if (len < 500 || len > 300000 || el === document.body) return;
    const btnCount = el.querySelectorAll('button, [role="button"]').length;
    const score = len - btnCount * 2000;
    if (score > bestScore) { bestScore = score; best = el; }
  });

  if (best && (best.innerText || '').length > 1000) {
    console.log(`[11th Hour] DOM extraction heuristic: class="${best.className.toString().substring(0, 80)}" | ${best.innerText.length} chars`);
    _domExtractionDone = true;
    captureText(best.innerText);
    return;
  }

  console.log('[11th Hour] DOM extraction found nothing substantial yet');
}

// ── 5b. Direct fetch of a known URL ──────────────────────────────────────────
function directFetch(url) {
  fetch(url, { credentials: 'include' })
    .then(r => r.arrayBuffer())
    .then(buf => { if (buf?.byteLength > 500) captureBuffer(new Uint8Array(buf)); })
    .catch(e => console.log(`[11th Hour] direct fetch failed: ${e.message}`));
}

// ── 6. Helpers to persist captured data ──────────────────────────────────────
// chrome.storage.session is blocked on DocuSign pages. Route writes through
// the background service worker which has unrestricted storage access.
function storageSave(payload) {
  chrome.runtime.sendMessage({ type: 'STORE_CAPTURE', payload });
}

function captureBuffer(uint8) {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < uint8.length; i += chunk) {
    binary += String.fromCharCode(...uint8.subarray(i, i + chunk));
  }
  storageSave({ capturedPDF: btoa(binary), capturedAt: Date.now(), pageUrl: window.location.href });
  _hasCapturedContent = true;
  if (!IN_IFRAME) setButtonState('ready');
}

function captureText(text) {
  const trimmed = text.trim();
  if (trimmed.length < 200) return;
  storageSave({ capturedText: trimmed, capturedAt: Date.now(), pageUrl: window.location.href });
  _hasCapturedContent = true;
  console.log(`[11th Hour] text captured | ${trimmed.length} chars`);
  if (IN_IFRAME) {
    window.parent.postMessage({ type: 'ELEVENTH_HOUR_TEXT_CAPTURED', text: trimmed }, '*');
  } else {
    setButtonState('ready');
  }
}

// ── 7. Main frame: button + listeners ────────────────────────────────────────
let compareBtn = null;
let _hasCapturedContent = false; // true once PDF/text captured, so button can be set ready on inject
let _envelopeBase = null;        // signing API base URL, stored when interceptor captures envelope

if (!IN_IFRAME) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PDF_READY_IN_TAB') setButtonState('ready');
  });
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes.capturedPDF || changes.capturedText) setButtonState('ready');
  });

  // Receive text captured by content.js running in a sub-frame
  window.addEventListener('message', (ev) => {
    if (ev.source === window) return; // same-frame messages are handled by the interceptor listener above
    if (ev.data?.type === 'ELEVENTH_HOUR_TEXT_CAPTURED' && ev.data.text?.length > 200) {
      console.log(`[11th Hour] text received from sub-frame | ${ev.data.text.length} chars`);
      captureText(ev.data.text);
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectButtonWithRetry);
  else injectButtonWithRetry();

  setTimeout(() => { if (!compareBtn?.dataset.ready) setButtonState('failed'); }, 30000);
}

// ── Button injection ──────────────────────────────────────────────────────────
function injectButtonWithRetry() {
  if (injectButton()) return;
  const obs = new MutationObserver(() => { if (injectButton()) obs.disconnect(); });
  obs.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => { obs.disconnect(); injectFloating(); }, 8000);
}

function injectButton() {
  if (compareBtn) return true;

  const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));

  if (!window.__eleventhHourLogged && allButtons.length > 0) {
    window.__eleventhHourLogged = true;
    console.log('[11th Hour] buttons found:', allButtons.map(b =>
      `"${(b.getAttribute('aria-label') || b.textContent || '').trim().substring(0, 40)}"`
    ).join(', '));
  }

  // Anchor next to "Finish" or "More Options" — whatever DocuSign shows
  const anchor = allButtons.find(el => {
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().toLowerCase();
    return label === 'finish' || label.includes('more options') || label.includes('more');
  });

  if (!anchor) return false;

  compareBtn = createButton();
  // Insert before Finish (our button goes left of it) or after More Options
  const label = (anchor.getAttribute('aria-label') || anchor.textContent || '').trim().toLowerCase();
  if (label === 'finish') {
    anchor.parentElement.insertBefore(compareBtn, anchor);
  } else {
    anchor.parentElement.insertBefore(compareBtn, anchor.nextSibling);
  }
  console.log(`[11th Hour] button injected near "${anchor.textContent.trim()}"`);
  if (_hasCapturedContent) setButtonState('ready');
  return true;
}

function injectFloating() {
  if (compareBtn) return;
  console.log('[11th Hour] using floating button fallback');
  compareBtn = createButton();
  compareBtn.style.position = 'fixed';
  compareBtn.style.bottom = '24px';
  compareBtn.style.right = '24px';
  compareBtn.style.zIndex = '2147483647';
  compareBtn.style.boxShadow = '0 4px 16px rgba(0,0,0,0.35)';
  document.body.appendChild(compareBtn);
  if (_hasCapturedContent) setButtonState('ready');
}

function createButton() {
  const btn = document.createElement('button');
  btn.id = 'eleventh-hour-compare-btn';
  btn.title = 'Checking for document…';
  btn.innerHTML = `<span style="font-weight:700;color:#fff;letter-spacing:-0.2px;">11th <span style="color:#2dd4bf;">Hour</span></span>`;
  styleBtn(btn, '#18181b');
  btn.addEventListener('click', fetchAndCompare);
  return btn;
}

// ── Fetch PDF on button click, then open compare ──────────────────────────────
async function fetchAndCompare() {
  const ti = new URLSearchParams(window.location.search).get('ti');

  // If we have a signing base and ti token, try to fetch the actual PDF now.
  // This runs on button click so the session is guaranteed active.
  if (ti && _envelopeBase) {
    setButtonState('loading');
    const candidates = [
      `${_envelopeBase}/download?ti=${ti}&insession=1`,
      `${_envelopeBase}/Download?ti=${ti}&insession=1`,
      `${_envelopeBase}/documents/combined?ti=${ti}&insession=1`,
      `${_envelopeBase}/print?ti=${ti}&insession=1`,
      `${_envelopeBase}/Print?ti=${ti}&insession=1`,
    ];
    for (const url of candidates) {
      try {
        const r = await fetch(url, { credentials: 'include' });
        const ct = r.headers.get('content-type') || '';
        console.log(`[11th Hour] button-click PDF fetch ${url.replace(_envelopeBase, '')} → ${r.status} ${ct}`);
        if (r.ok && ct.includes('pdf')) {
          const buf = await r.arrayBuffer();
          if (buf.byteLength > 1000) {
            console.log(`[11th Hour] PDF fetched on button click: ${(buf.byteLength / 1024).toFixed(0)} KB`);
            captureBuffer(new Uint8Array(buf));
            break;
          }
        }
      } catch (e) {
        console.log(`[11th Hour] button-click fetch failed: ${e.message}`);
      }
    }
  }

  chrome.runtime.sendMessage({ type: 'OPEN_COMPARE' });
}

function styleBtn(btn, bg) {
  btn.style.cssText = `
    margin: 0 6px; padding: 6px 14px;
    background: ${bg}; color: white; border: none;
    border-radius: 4px; font-size: 13px; font-weight: 600;
    cursor: pointer; font-family: inherit; vertical-align: middle;
    position: ${btn.style.position || 'static'};
    bottom: ${btn.style.bottom || 'auto'};
    right: ${btn.style.right || 'auto'};
    z-index: ${btn.style.zIndex || 'auto'};
    box-shadow: ${btn.style.boxShadow || 'none'};
  `;
}

function setBrandHTML(btn, prefix) {
  btn.innerHTML =
    (prefix ? `<span style="margin-right:5px;">${prefix}</span>` : '') +
    `<span style="font-weight:700;color:#fff;letter-spacing:-0.2px;">11th <span style="color:#2dd4bf;">Hour</span></span>`;
}

function setButtonState(state) {
  if (!compareBtn) return;
  const pos = { position: compareBtn.style.position, bottom: compareBtn.style.bottom, right: compareBtn.style.right, zIndex: compareBtn.style.zIndex, boxShadow: compareBtn.style.boxShadow };
  if (state === 'ready') {
    setBrandHTML(compareBtn, '⚡');
    compareBtn.title = 'Document captured — click to compare before signing';
    compareBtn.dataset.ready = '1';
    styleBtn(compareBtn, '#1a56db');
  } else if (state === 'loading') {
    setBrandHTML(compareBtn, '⏳');
    compareBtn.title = 'Fetching document…';
    styleBtn(compareBtn, '#52525b');
  } else if (state === 'failed') {
    setBrandHTML(compareBtn, '⚠');
    compareBtn.title = 'Could not auto-capture — click to upload manually';
    styleBtn(compareBtn, '#d97706');
  }
  Object.assign(compareBtn.style, pos);
}

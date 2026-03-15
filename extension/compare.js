'use strict';

// ── State ──────────────────────────────────────────────────────────────────────
let capturedB64   = null;   // base64 PDF from DocuSign
let capturedText  = null;   // plain text from envelope JSON
let refFile       = null;   // File object for reference doc
let llmSettings   = {};

// ── PDF.js worker ──────────────────────────────────────────────────────────────
// Must be set before any PDF is loaded.
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
}

// ── Load AI settings ───────────────────────────────────────────────────────────
const LLM_KEYS = ['llmProvider', 'llmApiKey', 'llmModel', 'llmRedFlagFocus', 'llmSummaryFormat', 'llmCustomPrompt'];
chrome.storage.local.get(LLM_KEYS, (r) => {
  llmSettings = r;
  renderAIStatus();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (LLM_KEYS.some(k => changes[k])) {
    chrome.storage.local.get(LLM_KEYS, (r) => {
      llmSettings = r;
      renderAIStatus();
    });
  }
});
function renderAIStatus() {
  const el = document.getElementById('ai-status');
  if (!el) return;
  const { llmProvider, llmApiKey, llmModel } = llmSettings;
  if (llmProvider && llmProvider !== 'none' && llmApiKey) {
    el.innerHTML = `<span class="dot"></span><span>AI: ${llmProvider} · ${llmModel || 'default model'}</span>`;
    el.className = 'ai-badge configured';
  } else {
    el.innerHTML = `<span class="dot"></span><span>No AI configured — click Settings to add your API key</span>`;
    el.className = 'ai-badge unconfigured';
  }
}
document.getElementById('settings-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ── Check for auto-captured document ──────────────────────────────────────────
chrome.storage.session.get(['capturedPDF', 'capturedText', 'capturedAt', 'pageUrl'], (r) => {
  const el     = document.getElementById('capture-status');
  const age    = Math.round((Date.now() - r.capturedAt) / 60000);
  const ageStr = age < 1 ? 'Just now' : age + ' min ago';

  if (r.capturedPDF) {
    const decoded = atob(r.capturedPDF);
    const kb = Math.round(decoded.length / 1024);
    capturedB64 = r.capturedPDF;
    window.__eleventhHourPDFDecoded = decoded;
    el.className = 'status-card green';
    el.innerHTML = `
      <span class="status-icon">✅</span>
      <div class="status-body">
        <strong>DocuSign document captured (${kb} KB PDF)</strong>
        <span>Captured ${ageStr}</span>
      </div>`;
  } else if (r.capturedText) {
    capturedText = r.capturedText;
    const kb = Math.round(capturedText.length / 1024);
    el.className = 'status-card green';
    el.innerHTML = `
      <span class="status-icon">✅</span>
      <div class="status-body">
        <strong>DocuSign document captured (${kb} KB text)</strong>
        <span>Captured ${ageStr}</span>
      </div>`;
  } else {
    el.className = 'status-card yellow';
    el.innerHTML = `
      <span class="status-icon">⚠️</span>
      <div class="status-body">
        <strong>No auto-captured document</strong>
        <span>Upload the DocuSign document manually below, or return to DocuSign and re-open this tool.</span>
      </div>`;
    document.getElementById('manual-box').style.display = 'block';
  }
  checkReady();
});

// ── Reference file picker ──────────────────────────────────────────────────────
document.getElementById('ref-file').addEventListener('change', (e) => {
  refFile = e.target.files[0];
  if (refFile) { document.getElementById('ref-name').textContent = '📄 ' + refFile.name; checkReady(); }
});
setupDrop('ref-zone', (file) => {
  refFile = file;
  document.getElementById('ref-name').textContent = '📄 ' + file.name;
  checkReady();
});

// ── Manual DocuSign upload ─────────────────────────────────────────────────────
document.getElementById('ds-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('ds-name').textContent = '📄 ' + file.name;
  fileToB64(file).then((b64) => { capturedB64 = b64; checkReady(); });
});
setupDrop('ds-zone', (file) => {
  document.getElementById('ds-name').textContent = '📄 ' + file.name;
  fileToB64(file).then((b64) => { capturedB64 = b64; checkReady(); });
});

// ── Button state ───────────────────────────────────────────────────────────────
function checkReady() {
  const btn    = document.getElementById('run-btn');
  const hasDoc = capturedB64 || capturedText;
  if (hasDoc && refFile) {
    btn.disabled    = false;
    btn.textContent = 'Compare Documents';
  } else if (!hasDoc) {
    btn.disabled    = true;
    btn.textContent = 'Waiting for DocuSign document…';
  } else {
    btn.disabled    = true;
    btn.textContent = 'Select your reference document';
  }
}

// ── Run comparison ─────────────────────────────────────────────────────────────
document.getElementById('run-btn').addEventListener('click', async () => {
  const btn       = document.getElementById('run-btn');
  const resultsEl = document.getElementById('results');
  btn.disabled    = true;
  resultsEl.innerHTML = '';

  const setStatus = (msg) => { btn.innerHTML = `<span class="spinner"></span> ${msg}`; };

  try {
    // 1. Extract execution doc text
    setStatus('Extracting document text…');
    let execText;
    if (capturedText) {
      execText = capturedText;
    } else {
      const decoded = window.__eleventhHourPDFDecoded || atob(capturedB64);
      const bytes   = Uint8Array.from(decoded, c => c.charCodeAt(0));
      execText = await extractPDF(bytes.buffer);
    }

    // 2. Extract reference doc text
    setStatus('Reading reference document…');
    const refBuf  = await refFile.arrayBuffer();
    const refText = await extractFile(refBuf, refFile.name);

    // 3. Normalize
    const execNorm = normalize(execText);
    const refNorm  = normalize(refText);

    const warnings = [];
    if (!execNorm) warnings.push('Execution document appears empty after extraction.');
    if (!refNorm)  warnings.push('Reference document appears empty after extraction.');

    const sim = similarityPct(execNorm, refNorm);
    if (sim < 20 && execNorm.length > 200 && refNorm.length > 200) {
      warnings.push(`Documents appear very different (similarity: ${sim}%). You may be comparing the wrong documents.`);
    }

    // 4. Diff
    setStatus('Computing diff…');
    const diff = computeDiff(refNorm, execNorm);

    // 5. AI summary — send all changes so LLM indices match redline group numbers
    let aiSummary = null;
    if (diff.all.length > 0) {
      setStatus('Getting AI analysis…');
      aiSummary = await callAI(diff.all);
    }

    renderResults({
      substantive_changes: diff.substantive,
      formatting_changes:  diff.formatting,
      redline:             diff.redline,
      ai_summary:          aiSummary,
      execution_chars:     execNorm.length,
      reference_chars:     refNorm.length,
      similarity_pct:      sim,
      extraction_warning:  warnings.length ? warnings.join(' ') : null,
    });

  } catch (e) {
    resultsEl.innerHTML = `
      <div class="alert red">
        <strong>Comparison failed</strong>
        <p>${esc(e.message)}</p>
      </div>`;
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Compare Documents';
  }
});

// ── Text extraction ────────────────────────────────────────────────────────────
async function extractFile(arrayBuffer, filename) {
  const name = filename.toLowerCase();
  if (name.endsWith('.docx') || name.endsWith('.doc'))            return extractDOCX(arrayBuffer);
  if (name.endsWith('.pdf')  || isPDFMagicBytes(arrayBuffer))    return extractPDF(arrayBuffer);
  return new TextDecoder('utf-8').decode(arrayBuffer);
}

function isPDFMagicBytes(buf) {
  const b = new Uint8Array(buf, 0, 4);
  return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
}

async function extractDOCX(arrayBuffer) {
  if (typeof mammoth === 'undefined') throw new Error('mammoth.js failed to load — try reloading the page.');
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

async function extractPDF(arrayBuffer) {
  if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js failed to load — try reloading the page.');
  const pdf   = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const parts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map(item => item.str).join(' '));
  }
  return parts.join('\n');
}

// ── Text normalization ─────────────────────────────────────────────────────────
function normalize(text) {
  text = text.replace(/\n\s*\d+\s*\n/g, '\n');   // standalone page numbers
  text = text.replace(/[ \t]+/g, ' ');             // collapse horizontal whitespace
  text = text.replace(/\n{3,}/g, '\n\n');          // collapse blank lines
  return text.split('\n').map(l => l.trim()).join('\n').trim();
}

// ── Diff + classification ──────────────────────────────────────────────────────
function isSubstantive(removed, added) {
  const combined = (removed || '') + (added || '');
  const trimmed = combined.trim();
  if (!trimmed) return false; // pure whitespace
  // Structural: pure section numbering / outline markers with no body text
  // e.g. "1.", "(a)", "i.", "1.2.3", "Section 2", "Article 1"
  if (/^(section\s+\d+|article\s+\d+|\d+(\.\d+)*\.?|\([a-z\d]+\)|[a-z]\.|[ivxlcdm]+\.)[\s.:–\-]*$/i.test(trimmed)) {
    return false;
  }
  return true;
}

function contextSnippet(text, pos, win = 70) {
  return text.slice(Math.max(0, pos - win), Math.min(text.length, pos + win))
    .replace(/\n/g, ' ').trim();
}

function computeDiff(textRef, textExec) {
  const dmp = new diff_match_patch(); // eslint-disable-line new-cap
  dmp.Diff_Timeout = 10.0;
  const diffs = dmp.diff_main(textRef, textExec);
  dmp.diff_cleanupSemantic(diffs);

  const redline     = diffs.map(d => ({ op: d[0], text: d[1] }));
  const all = [], substantive = [], formatting = [];
  let pos = 0, i = 0;

  while (i < diffs.length) {
    const op   = diffs[i][0];
    const data = diffs[i][1];
    if (op === 0) { pos += data.length; i++; continue; }

    let removed = '', added = '';
    if (op === -1) {
      removed = data;
      pos    += data.length;
      if (i + 1 < diffs.length && diffs[i + 1][0] === 1) { added = diffs[i + 1][1]; i += 2; }
      else i++;
    } else {
      added = data;
      i++;
    }

    if (!removed && !added) continue;
    const sub   = isSubstantive(removed, added);
    const entry = {
      removed:    removed.trim() || null,
      added:      added.trim()   || null,
      context:    contextSnippet(textRef, pos - removed.length),
      structural: !sub,
    };
    all.push(entry);
    (sub ? substantive : formatting).push(entry);
  }

  return { all, substantive, formatting, redline };
}

// ── Similarity ─────────────────────────────────────────────────────────────────
function similarityPct(a, b) {
  const trigrams = s => { const t = new Set(); for (let i = 0; i < s.length - 2; i++) t.add(s.slice(i, i+3)); return t; };
  const ta = trigrams(a), tb = trigrams(b);
  if (!ta.size && !tb.size) return 100;
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union ? Math.round(inter / union * 100) : 0;
}

// ── AI summary ─────────────────────────────────────────────────────────────────
function buildPrompt(changes) {
  const { llmCustomPrompt, llmRedFlagFocus, llmSummaryFormat } = llmSettings;
  const lines = changes.map((c, i) => {
    const tag = c.structural ? ' [structural/formatting — low priority]' : '';
    return `[${i + 1}]${tag} REMOVED: ${c.removed || '(nothing)'}\n    ADDED: ${c.added || '(nothing)'}\n    CONTEXT: …${c.context}…`;
  }).join('\n\n');

  // Full custom prompt overrides everything — but only if the user actually wrote it.
  // Ignore any auto-saved copy of the default (detected by the opening phrase).
  const userCustomPrompt = llmCustomPrompt && llmCustomPrompt.trim();
  const looksLikeDefault = userCustomPrompt && userCustomPrompt.startsWith('You are a legal expert');
  if (userCustomPrompt && !looksLikeDefault) {
    return userCustomPrompt.replace('{{CHANGES}}', lines);
  }

  const refInstruction =
    'Do NOT reference changes by their index numbers ([1], [2], etc.) anywhere in your response. ' +
    'Instead, identify each change by the clause or section name visible in the CONTEXT ' +
    '(e.g. "the Liability clause", "Section 5 — Governing Law", "the Warranties provision"). ' +
    'If no section name is apparent, describe the change by quoting the key phrase that changed.';

  const hasCustomFocus = llmRedFlagFocus && llmRedFlagFocus.trim();

  // If the user supplied custom focus instructions, inject them as a standalone
  // CRITICAL block so the AI treats them as a top-level command, not buried content.
  const redFlagFormatDirective = hasCustomFocus
    ? `CRITICAL INSTRUCTION — apply the following rules to the RED FLAGS section: ${llmRedFlagFocus.trim()}\n\n`
    : '';

  const redFlagBody =
    `Written description of every change that is particularly concerning and warrants legal review` +
    (hasCustomFocus
      ? ``
      : `, including any word that reverses clause meaning (e.g. adding or removing "not"), ` +
        `changes to governing law, warranty, liability, indemnification, or IP rights`) +
    `. Identify each by clause/section name, not by index number. ` +
    `Describe each red flag in its own bullet. Every change listed in RED_FLAG_INDICES must be described here. ` +
    `Quote the specific language that changed. If none, write 'None identified.'`;

  const formatClause = llmSummaryFormat && llmSummaryFormat.trim()
    ? `Additional formatting instructions: ${llmSummaryFormat.trim()}\n\n`
    : `Never characterize a change to legal obligations, rights, warranties, or liability as "minor". ` +
      `Lead with the most legally impactful change. Identify all changes by clause or section name, never by index number.\n\n`;

  return (
    'You are a legal expert helping someone review a contract before signing it.\n\n' +
    'Below are all substantive textual differences between the REFERENCE version ' +
    '(what was previously agreed or negotiated) and the EXECUTION version ' +
    '(what is now being presented for signature). ' +
    'Each entry is numbered (for internal reference only) and shows what was removed, what replaced it, and surrounding context.\n\n' +
    refInstruction + '\n\n' +
    'CHANGES:\n' + lines + '\n\n' +
    formatClause +
    'Respond in this exact format:\n\n' +
    'OVERALL: One sentence characterizing the nature of the redline.\n\n' +
    'KEY CHANGES:\n' +
    '• [Clause/section name] — [what changed and its practical impact on the signer; note if more or less favorable]\n' +
    '(3–5 bullets max, most significant first)\n\n' +
    redFlagFormatDirective +
    'RED FLAGS: ' + redFlagBody + '\n\n' +
    'RED_FLAG_INDICES: (numbers only, no text) Comma-separated list of the change numbers above ' +
    'that are red flags (e.g. "1, 3"). Write "none" if there are no red flags. ' +
    'This must be numbers only — the written description goes in RED FLAGS above.'
  );
}

async function callAI(changes) {
  const { llmProvider, llmApiKey, llmModel } = llmSettings;
  if (!llmProvider || llmProvider === 'none' || !llmApiKey || !changes.length) return null;
  const prompt = buildPrompt(changes);
  try {
    switch (llmProvider) {
      case 'gemini': return await callGemini(llmApiKey, llmModel || 'gemini-2.0-flash', prompt);
      case 'claude': return await callClaude(llmApiKey, llmModel || 'claude-sonnet-4-6',  prompt);
      case 'openai': return await callOpenAI(llmApiKey, llmModel || 'gpt-4o',            prompt);
      default: return null;
    }
  } catch (e) {
    return `(AI summary unavailable: ${e.message})`;
  }
}

async function callGemini(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function callClaude(apiKey, model, prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.content?.[0]?.text || null;
}

async function callOpenAI(apiKey, model, prompt) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.choices?.[0]?.message?.content || null;
}

// ── Render results ─────────────────────────────────────────────────────────────
let _currentChange = -1;

function renderResults(r) {
  _currentChange = -1;
  const el  = document.getElementById('results');
  const sub = r.substantive_changes || [];
  const fmt = r.formatting_changes  || [];
  const totalChanges = sub.length + fmt.length;

  let alertClass, alertTitle, alertSub;
  if (sub.length > 0) {
    alertClass = 'red';
    alertTitle = `${sub.length} substantive change${sub.length > 1 ? 's' : ''} detected`;
    alertSub   = 'Review the Redline tab to inspect each change inline.';
  } else if (fmt.length > 0) {
    alertClass = 'yellow';
    alertTitle = 'Whitespace / formatting differences only';
    alertSub   = 'No substantive text changes detected.';
  } else {
    alertClass = 'green';
    alertTitle = 'No text differences detected';
    alertSub   = 'Content appears identical. Verify key terms yourself before signing.';
  }

  const extractWarn = r.extraction_warning
    ? `<div class="alert yellow"><strong>Extraction warning</strong><p>${esc(r.extraction_warning)}</p></div>`
    : '';

  const execK = r.execution_chars ? (r.execution_chars / 1000).toFixed(1) + 'k' : '?';
  const refK  = r.reference_chars  ? (r.reference_chars  / 1000).toFixed(1) + 'k' : '?';
  const stats = `<div class="stats-bar">
    <span class="stat-pill">Execution <span class="stat-val">${execK}</span> chars</span>
    <span class="stat-pill">Reference <span class="stat-val">${refK}</span> chars</span>
    <span class="stat-pill">Similarity <span class="stat-val">${r.similarity_pct ?? '?'}%</span></span>
    <span class="stat-pill"><span class="stat-val">${totalChanges}</span> changes found</span>
  </div>`;

  const redFlags = parseRedFlags(r.ai_summary);
  const redFlagBanner = redFlags ? `
    <div class="alert red-flag">
      <div class="rf-title">🛑 Red Flag — Do Not Sign Without Review</div>
      <div class="rf-body">${esc(redFlags)}</div>
    </div>` : '';

  const aiBox = r.ai_summary ? `
    <div class="ai-panel">
      <div class="ai-panel-header">AI Analysis</div>
      <div class="ai-panel-body">${esc(r.ai_summary)}</div>
    </div>` : '';

  el.innerHTML = `
    ${redFlagBanner}
    <div class="alert ${alertClass}">
      <strong>${alertTitle}</strong>
      <p>${alertSub}</p>
    </div>
    ${extractWarn}
    ${stats}
    <div class="view-tabs">
      <button class="view-tab active" data-tab="summary">Summary</button>
      <button class="view-tab" data-tab="redline">Redline</button>
    </div>
    <div id="view-summary">${aiBox}</div>
    <div id="view-redline" style="display:none">
      ${buildRedline(r.redline, parseRedFlagIndices(r.ai_summary))}
    </div>
  `;

  el.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { switchTab(tab.dataset.tab, tab); return; }
    if (e.target.closest('[data-action="prev-change"]')) { goToChange(_currentChange - 1); return; }
    if (e.target.closest('[data-action="next-change"]')) { goToChange(_currentChange + 1); return; }
  });
}

function switchTab(name, btn) {
  document.getElementById('view-summary').style.display = name === 'summary' ? '' : 'none';
  document.getElementById('view-redline').style.display = name === 'redline' ? '' : 'none';
  btn.parentElement.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (name === 'redline' && _currentChange === -1) goToChange(0);
}

function goToChange(idx) {
  const groups = document.querySelectorAll('.change-group');
  if (!groups.length) return;
  _currentChange = Math.max(0, Math.min(idx, groups.length - 1));
  groups.forEach(g => g.classList.remove('active-change'));
  groups[_currentChange].classList.add('active-change');
  groups[_currentChange].scrollIntoView({ behavior: 'smooth', block: 'center' });
  const counter = document.getElementById('change-counter');
  if (counter) counter.textContent = `${_currentChange + 1} of ${groups.length}`;
  const prev = document.querySelector('[data-action="prev-change"]');
  const next = document.querySelector('[data-action="next-change"]');
  if (prev) prev.disabled = _currentChange === 0;
  if (next) next.disabled = _currentChange === groups.length - 1;
}

function parseRedFlags(aiText) {
  if (!aiText) return null;
  // Stop before RED_FLAG_INDICES line so it doesn't bleed into the banner
  const match = aiText.match(/RED FLAGS?:?\s*([\s\S]*?)(?:\nRED_FLAG_INDICES|\s*$)/i);
  if (!match) return null;
  const text = match[1].trim();
  if (!text || /^none identified\.?$/i.test(text)) return null;
  // If the AI wrote only a number (confused RED FLAGS with RED_FLAG_INDICES), don't show it
  if (/^[\d,\s]+$/.test(text)) return null;
  return text;
}

function parseRedFlagIndices(aiText) {
  if (!aiText) return new Set();
  const match = aiText.match(/RED_FLAG_INDICES:?\s*([^\n]+)/i);
  if (!match) return new Set();
  const raw = match[1].trim();
  if (/^none$/i.test(raw)) return new Set();
  const nums = raw.split(/[\s,]+/).map(n => parseInt(n, 10)).filter(n => !isNaN(n) && n > 0);
  return new Set(nums);
}

function buildRedline(segments, flaggedIndices) {
  if (!segments || !segments.length) return '<p style="color:#9ca3af;padding:16px">Redline data not available.</p>';
  const flagged = flaggedIndices || new Set();

  // Count ALL change groups — indices match the LLM's [1]..[N] numbering exactly,
  // since the LLM is now sent every change (structural ones labelled low-priority).
  let body = '';
  let changeCount = 0;
  let i = 0;
  while (i < segments.length) {
    if (segments[i].op === 0) {
      body += escRedline(segments[i].text);
      i++;
    } else {
      changeCount++;
      let groupBody = '';
      while (i < segments.length && segments[i].op !== 0) {
        const t = escRedline(segments[i].text);
        groupBody += segments[i].op === -1 ? `<del>${t}</del>` : `<ins>${t}</ins>`;
        i++;
      }
      const isFlagged = flagged.has(changeCount);
      const cls   = isFlagged ? 'change-group red-flag-group' : 'change-group';
      const badge = isFlagged ? '<span class="red-badge">🚩</span>' : '';
      body += `<span class="${cls}" id="cg-${changeCount}">${badge}${groupBody}</span>`;
    }
  }

  const navBar = changeCount > 0 ? `
    <div class="redline-nav">
      <button class="nav-btn" data-action="prev-change" disabled>← Prev</button>
      <span id="change-counter">— of ${changeCount}</span>
      <span class="nav-spacer"></span>
      <div class="redline-legend">
        <span><span class="legend-del">Removed</span></span>
        <span><span class="legend-ins">Added</span></span>
      </div>
      <button class="nav-btn" data-action="next-change">Next →</button>
    </div>` : '';

  return navBar + `<div class="redline-doc">${body}</div>`;
}

// ── Utilities ──────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escRedline(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const arr = new Uint8Array(e.target.result);
      let binary = '';
      const chunk = 8192;
      for (let i = 0; i < arr.length; i += chunk) binary += String.fromCharCode(...arr.subarray(i, i + chunk));
      resolve(btoa(binary));
    };
    reader.onerror = () => reject(new Error('Failed to read file: ' + file.name));
    reader.readAsArrayBuffer(file);
  });
}

function setupDrop(zoneId, onFile) {
  const zone = document.getElementById(zoneId);
  zone.addEventListener('dragover',  (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  });
}

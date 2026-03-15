'use strict';

const PROVIDER_INFO = {
  none:   { hint: '',                          note: '',                                               defaultModel: '' },
  gemini: { hint: 'Default: gemini-2.0-flash', note: 'Get a free API key at aistudio.google.com',    defaultModel: 'gemini-2.0-flash' },
  claude: { hint: 'Default: claude-sonnet-4-6',note: 'Get an API key at console.anthropic.com',      defaultModel: 'claude-sonnet-4-6' },
  openai: { hint: 'Default: gpt-4o',           note: 'Get an API key at platform.openai.com',        defaultModel: 'gpt-4o' },
};

// Default text for each prompt field — shown on first open so users have a starting point.
const DEFAULT_RED_FLAG_FOCUS =
  'any word or phrase that reverses or negates the meaning of a clause (e.g. adding or removing "not", "never", "no", "except", "unless" — even a single word can flip liability); ' +
  'changes to governing law or jurisdiction; ' +
  'changes to warranty, representation, or disclaimer language; ' +
  'changes to liability caps or limitations; ' +
  'changes to indemnification obligations; ' +
  'changes to payment terms or amounts; ' +
  'changes to IP ownership or licensing rights; ' +
  'changes to termination rights or notice periods; ' +
  'and any other change that shifts risk, obligations, or rights between parties';

const DEFAULT_SUMMARY_FORMAT =
  'Write in plain English. ' +
  'Never characterize a change to legal obligations, rights, warranties, or liability as "minor" — any such change is significant. ' +
  'Lead with the most legally impactful change. ' +
  'For each change, state explicitly whether it is more or less favorable to the signer and explain the practical legal consequence.';

// The canonical default prompt — kept here so the Reset button can restore it.
const DEFAULT_PROMPT =
  'You are a legal expert helping someone review a contract before signing it.\n\n' +
  'Below are all substantive textual differences between the REFERENCE version ' +
  '(what was previously agreed or negotiated) and the EXECUTION version ' +
  '(what is now being presented for signature). ' +
  'Each entry is numbered (for internal reference only) and shows what was removed, what replaced it, and surrounding context.\n\n' +
  'Do NOT reference changes by their index numbers ([1], [2], etc.) anywhere in your response. ' +
  'Instead, identify each change by the clause or section name visible in the CONTEXT (e.g. "the Liability clause", ' +
  '"Section 5 — Governing Law", "the Warranties provision"). ' +
  'If no section name is apparent, describe the change by quoting the key phrase that changed.\n\n' +
  'CHANGES:\n{{CHANGES}}\n\n' +
  'Additional instructions: Never characterize a change to legal obligations, rights, warranties, or liability as "minor". ' +
  'Lead with the most legally impactful change. Identify all changes by clause or section name, never by index number.\n\n' +
  'Respond in this exact format:\n\n' +
  'OVERALL: One sentence characterizing the nature of the redline.\n\n' +
  'KEY CHANGES:\n' +
  '• [Clause/section name] — [what changed and its practical impact on the signer; note if more or less favorable]\n' +
  '(3–5 bullets max, most significant first)\n\n' +
  'RED FLAGS: Written description of every change that is particularly concerning and warrants legal review — ' +
  'identify each by clause/section name, not by index number. Describe each red flag in its own bullet. ' +
  'Every change listed in RED_FLAG_INDICES must be described here. ' +
  'Quote the specific language that changed. If none, write \'None identified.\'\n\n' +
  'RED_FLAG_INDICES: (numbers only, no text) Comma-separated list of the change numbers above ' +
  'that are red flags (e.g. "1, 3"). Write "none" if there are no red flags. ' +
  'This must be numbers only — the written description goes in RED FLAGS above.';

const providerEl      = document.getElementById('provider');
const apiKeyEl        = document.getElementById('api-key');
const modelEl         = document.getElementById('model');
const modelHint       = document.getElementById('model-hint');
const providerNote    = document.getElementById('provider-note');
const redFlagFocusEl  = document.getElementById('red-flag-focus');
const summaryFormatEl = document.getElementById('summary-format');
const customPromptEl  = document.getElementById('custom-prompt');
const resetPromptBtn  = document.getElementById('reset-prompt-btn');
const saveBtn         = document.getElementById('save-btn');
const statusEl        = document.getElementById('status');

// ── Load saved settings ────────────────────────────────────────────────────────
const ALL_KEYS = ['llmProvider', 'llmApiKey', 'llmModel', 'llmRedFlagFocus', 'llmSummaryFormat', 'llmCustomPrompt'];
chrome.storage.local.get(ALL_KEYS, (r) => {
  providerEl.value      = r.llmProvider      || 'none';
  apiKeyEl.value        = r.llmApiKey        || '';
  modelEl.value         = r.llmModel         || '';
  redFlagFocusEl.value  = r.llmRedFlagFocus  || DEFAULT_RED_FLAG_FOCUS;
  summaryFormatEl.value = r.llmSummaryFormat || DEFAULT_SUMMARY_FORMAT;
  // Only show a custom prompt if the user actually wrote one.
  // If it was auto-saved as the default (before this fix), clear it so the
  // dynamic prompt logic in compare.js takes over.
  const stored = r.llmCustomPrompt || '';
  // Clear any auto-saved copy of the default prompt (any version) so the
  // dynamic prompt logic in compare.js takes over.
  const isAutoSavedDefault = stored.trim().startsWith('You are a legal expert');
  if (isAutoSavedDefault) {
    customPromptEl.value = '';
    chrome.storage.local.set({ llmCustomPrompt: '' });
  } else {
    customPromptEl.value = stored;
  }
  updateProviderUI();
});

// ── Update hints when provider changes ────────────────────────────────────────
providerEl.addEventListener('change', updateProviderUI);

function updateProviderUI() {
  const info = PROVIDER_INFO[providerEl.value] || PROVIDER_INFO.none;
  modelHint.textContent = info.hint;
  if (info.note) {
    providerNote.textContent = info.note;
    providerNote.style.display = '';
  } else {
    providerNote.style.display = 'none';
  }
  modelEl.placeholder = info.defaultModel || '';
}

// ── Reset prompt ───────────────────────────────────────────────────────────────
resetPromptBtn.addEventListener('click', () => {
  customPromptEl.value = DEFAULT_PROMPT;
});

// ── Save ───────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
  chrome.storage.local.set({
    llmProvider:      providerEl.value,
    llmApiKey:        apiKeyEl.value.trim(),
    llmModel:         modelEl.value.trim(),
    llmRedFlagFocus:  redFlagFocusEl.value.trim(),
    llmSummaryFormat: summaryFormatEl.value.trim(),
    llmCustomPrompt:  customPromptEl.value.trim(),
  }, () => {
    statusEl.textContent = '✅ Saved.';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });
});

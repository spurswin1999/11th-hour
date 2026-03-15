# 11th Hour — DocuSign Document Comparator

Compares the document you're about to sign against your reference version, directly from DocuSign's signing page. Runs entirely in your browser — no backend required.

## How it works

1. You're on a DocuSign signing page — the extension silently captures the PDF as DocuSign loads it.
2. A **⚡ 11th Hour** button appears next to DocuSign's native buttons.
3. Click it → a comparison page opens in a new tab.
4. Upload your reference document (last negotiated draft — PDF or .docx).
5. Get a diff report: substantive changes highlighted, formatting noise collapsed, AI plain-language summary.

DocuSign's own Download button is untouched.

---

## Install the extension (Chrome)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select `11th-hour/extension/`
4. Pin it to your toolbar

---

## AI Configuration

Open the extension's **Settings** page to configure an AI provider for document analysis:

- **Google Gemini** — free tier available at aistudio.google.com
- **Anthropic Claude** — console.anthropic.com
- **OpenAI** — platform.openai.com

Your API key is stored locally in your browser and never transmitted anywhere except the AI provider you choose.

---

## What it can and cannot detect

**Can detect:**
- Changed dollar amounts, dates, time periods, party names
- Added or removed sentences and clauses
- Changed obligation language (shall/must/may not)
- Jurisdiction changes

**Cannot detect:**
- Changes in scanned or image-based PDFs (no text to extract)
- Changes in exhibits or schedules not uploaded separately
- Intentional ambiguities that don't alter text
- Metadata or formatting changes with identical visible text

---

## File structure

```
11th-hour/
└── extension/
    ├── manifest.json         Chrome extension manifest (MV3)
    ├── interceptor.js        Patches fetch/XHR in page context to capture PDF
    ├── content.js            Injects interceptor, adds 11th Hour button to DocuSign UI
    ├── background.js         Service worker — opens compare tab on button click
    ├── compare.html/js       Main comparison UI (diff + AI summary, runs in-browser)
    ├── popup.html/js         Extension toolbar popup (capture status indicator)
    ├── options.html/js       Settings page (AI provider, API key, custom prompt)
    └── lib/
        ├── diff_match_patch.js
        ├── mammoth.browser.min.js
        ├── pdf.min.js
        └── pdf.worker.min.js
```

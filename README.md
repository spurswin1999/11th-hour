# 11th Hour — E-Signature Contract Comparator

Compare the contract you're about to sign against your negotiated version — before you sign. Catches unauthorized last-minute changes.

> **Platform support:** Full auto-capture (no downloading required) currently works on **DocuSign** only. Manual mode — where you download the document and upload it on the compare page — works with **any e-signature platform**: HelloSign, Adobe Sign, PandaDoc, or anything else.

---

## How it works

**Auto mode (DocuSign)**
1. Navigate to a signing page — the extension silently captures the document as the page loads.
2. An **⚡ 11th Hour** button appears next to the native signing buttons.
3. Click it → the compare page opens in a new tab.
4. Upload your reference document (last negotiated draft — PDF or .docx).
5. Get a diff report: substantive changes highlighted, formatting noise collapsed, AI plain-language summary.

**Manual mode (any platform)**
1. Download the document from your e-signature platform.
2. Open the extension popup and click **Open Compare Tool**.
3. Upload both the downloaded document and your reference version.
4. Get the same diff report.

---

## Install (Chrome)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder
4. Pin it to your toolbar

---

## AI Configuration

Open the extension's **Settings** page to configure an AI provider for plain-language change summaries:

- **Google Gemini** — free tier available at aistudio.google.com
- **Anthropic Claude** — console.anthropic.com
- **OpenAI** — platform.openai.com

Your API key is stored locally in your browser and never transmitted anywhere except the AI provider you choose. The diff works without AI — the summary is optional.

---

## What it can and cannot detect

**Can detect:**
- Changed dollar amounts, dates, time periods, party names
- Added or removed sentences and clauses
- Changed obligation language (shall/must/may not)
- Jurisdiction changes

**Cannot detect:**
- Changes in scanned or image-based PDFs (no text layer to extract)
- Changes in exhibits or schedules not uploaded separately
- Intentional ambiguities that don't alter text
- Metadata or formatting changes with identical visible text

---

## File structure

```
11th-hour/
└── extension/
    ├── manifest.json         Chrome extension manifest (MV3)
    ├── interceptor.js        Patches fetch/XHR in page context to auto-capture documents
    ├── content.js            Injects interceptor, adds 11th Hour button to signing UI
    ├── background.js         Service worker — opens compare tab on button click
    ├── compare.html/js       Comparison UI (diff + AI summary, runs entirely in-browser)
    ├── popup.html/js         Extension toolbar popup (capture status indicator)
    ├── options.html/js       Settings page (AI provider, API key, custom prompt)
    └── lib/
        ├── diff_match_patch.js
        ├── mammoth.browser.min.js
        ├── pdf.min.js
        └── pdf.worker.min.js
```

---

## License

MIT — see [LICENSE](LICENSE).

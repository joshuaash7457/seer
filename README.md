# Seer — Support-Driven Knowledge Base Gap Analysis for PTZOptics

Seer is a Windows desktop application that learns from PTZOptics customer support tickets what customers struggle with, then checks your local `docs.ptzoptics.com` Docusaurus repository to find where documentation is failing them.

> *"Where are customers contacting support because our self-service resources didn't help them, and what should we build or fix to change that?"*

---

## Core Capabilities

1. **Local PII Scrubber First (`electron/services/piiScrubber.ts`):**
   - Strips customer names, support agent names, emails, phone numbers, street addresses, serial numbers, MAC addresses, and public WAN IPs *before* saving to local storage or sending to an AI model.
   - Preserves private diagnostic camera LAN IPs (e.g., `192.168.100.88`, `192.168.1.x`, `10.x.x.x`) needed to diagnose cross-subnet setup issues.
   - Includes a live **PII Verifier Lab** tab in the app to test redaction on any ticket text.

2. **Docusaurus MDX Indexer & Side-by-Side Doc Inspector (`electron/services/docsIndexer.ts`):**
   - Auto-detects your local `C:\Users\<User>\online-docs` repository (`docs.ptzoptics.com`).
   - Resolves Docusaurus path aliases (`@kbComponents/*`, `@techComponents/*`, `@devComponents/*`, `@appComponents/*`) so pages that import MDX partials are indexed with their full content.
   - Flags video-only stub pages that lack written troubleshooting steps.
   - Side-by-side **Evidence & Doc Drawer** displays supporting tickets, how support resolved them, the current `.mdx` file content, and a copy-pasteable **Suggested MDX Draft / Outline**.

3. **Distinguishes Why Self-Service Failed & What Fix Type Is Needed:**
   - **Gap Verdicts:** `NO_DOC`, `PARTIAL_COVERAGE`, `COVERED_FOUND_UNHELPFUL`, `COVERED_HARD_TO_FIND`, `NEEDS_TOOL`, `WELL_COVERED`.
   - **Concrete Fix Types:** `NEW_ARTICLE`, `EDIT_ARTICLE` (with exact `.mdx` file reference), `IMPROVE_FINDABILITY`, `BUILD_TOOL` (for recurring workflow problems like `192.168.100.88` subnet discovery).

4. **Configurable AI Compute (`electron/services/aiProvider.ts`):**
   - **Company OpenCode Zen (`https://opencode.ai/zen/v1`):** Default provider; fetches the live Zen model catalog (`/zen/v1/models`) and automatically routes each model to `/responses`, `/messages`, `/models/{model}:generateContent`, or `/chat/completions`.
   - **Local / Homelab Ollama (`http://localhost:11434`):** Zero ticket text leaves your LAN.
   - **Direct Cloud APIs:** OpenAI, Anthropic Claude, and Google Gemini.

5. **Spot-Check & Trust Score Calibration (`Spot-Check & Trust Score` tab):**
   - Side-by-side audit view of `[Anonymized Ticket]` vs. `[Matched Docusaurus Doc]` vs. `[Seer Verdict]`.
   - One-click **Approve Call** or **Correct / Override Verdict** calculates Seer's **Measured Agreement / Trust Score (%)**, immediately re-clusters recommendations, and saves **Few-Shot Calibration Rules** that train future analysis runs.

6. **Trends Over Time, Shipped Doc Impact & Leadership Export (`Trends & Report` tab):**
   - Compares runs week-over-week to highlight **Rising (`+X`)**, **Falling (`-X`)**, and **New** issue clusters.
   - **"Mark Shipped" Impact Tracker:** Mark any recommendation as shipped and measure whether ticket volume for that topic drops in subsequent runs.
   - **One-Click Leadership Report Export:** Generates a zero-PII **Standalone HTML Executive Report** and **Markdown Report** ready to share with leadership.

7. **Tunable Without Touching Code (`Taxonomy & Prompts` tab):**
   - Add or edit PTZOptics camera/controller models, issue categories, non-self-service RMA filter keywords, and AI system prompts directly in the UI (stored in `%APPDATA%/Seer/taxonomy-and-prompts.json`).

---

## Installation & Running on Windows

### Option A: Windows Installer (`.exe`)
1. Run the Windows installer at:
   ```text
   C:\Users\JoshuaAsh\Seer\release\Seer Setup 1.0.0.exe
   ```
   *(Or launch the unpacked executable directly at `C:\Users\JoshuaAsh\Seer\release\win-unpacked\Seer.exe`, or download the latest `.exe` from [GitHub Releases](https://github.com/joshuaash7457/seer/releases).)*
2. The installer creates a **Seer** shortcut (with the engraved Eye of Providence icon) on your Desktop and Start Menu.

### Option B: Build & Run from Source
1. Install dependencies:
   ```powershell
   npm install
   ```
2. Build & launch the desktop app:
   ```powershell
   node ./node_modules/vite/bin/vite.js build; node ./node_modules/esbuild/bin/esbuild electron/main.ts electron/preload.ts --bundle --platform=node --external:electron --outdir=dist-electron --out-extension:.js=.cjs; node ./node_modules/electron/cli.js .
   ```
3. Rebuild the Windows Installer (`release\Seer Setup 1.0.0.exe`):
   ```powershell
   node ./node_modules/vite/bin/vite.js build; node ./node_modules/esbuild/bin/esbuild electron/main.ts electron/preload.ts --bundle --platform=node --external:electron --outdir=dist-electron --out-extension:.js=.cjs; node ./node_modules/electron-builder/cli.js --win --x64
   ```

### Run Automated Verification Tests
```powershell
node ./node_modules/vitest/vitest.mjs run
```

# Seer — Support-Driven Knowledge Base Gap Analysis for PTZOptics

Seer is a Windows desktop application that analyzes PTZOptics customer support tickets against the local `docs.ptzoptics.com` Docusaurus repository to answer:

> *"Where are customers contacting support because our self-service resources didn't help them, and what should we build or fix to change that?"*

---

## Key Capabilities (Phase 1)

- **Local PII Scrubber First:** Automatically strips customer names, support agent names, email addresses, phone numbers, street addresses, serial numbers, MAC addresses, and public WAN IPs *before* saving to local storage or sending to an AI model—while preserving private diagnostic camera LAN IPs (e.g., `192.168.100.88`, `192.168.1.x`, `10.x.x.x`) needed to diagnose subnet issues.
- **Docusaurus MDX Indexer:** Indexes your local `online-docs` repository (`docs.ptzoptics.com`), resolves imported MDX partials (`@kbComponents/*`, `@techComponents/*`, `@devComponents/*`, `@appComponents/*`), and detects video-only stub pages that lack written troubleshooting steps.
- **Flexible Ticket Ingestion:**
  - **HubSpot CSV / JSON Export Importer** (works immediately before API token approval)
  - **HubSpot Private App Live API Connector**
  - **Built-in PTZOptics Real-World Sample Batch** (8 realistic support tickets to test against your local docs immediately)
- **Configurable AI Compute:**
  - **Local / Homelab Ollama** (`http://localhost:11434` or LAN URL)
  - **Cloud APIs** (OpenAI, Anthropic Claude, Google Gemini) using scrubbed ticket text
  - **Local Heuristic Fallback** when running offline
- **Secure Local Storage:**
  - API keys and HubSpot tokens are encrypted via Windows DPAPI (`Electron safeStorage`) and stored in `%APPDATA%/Seer`.
  - No credentials, ticket exports, or analysis outputs are ever committed to Git.

---

## Installation & Running on Windows

### Prerequisites
- Node.js 20+ installed on Windows
- Local clone of the PTZOptics Docusaurus repository (auto-detected if located at `C:\Users\<YourUser>\online-docs`)

### 1. Install Dependencies
```powershell
npm install
```

### 2. Launch the Desktop App
```powershell
node ./node_modules/vite/bin/vite.js build; node ./node_modules/esbuild/bin/esbuild electron/main.ts electron/preload.ts --bundle --platform=node --external:electron --outdir=dist-electron --out-extension:.js=.cjs; node ./node_modules/electron/cli.js .
```
*(Or `npm start` if `.cmd` shims are enabled on your machine.)*

### 3. Run Automated Tests
```powershell
node ./node_modules/vitest/vitest.mjs run
```

---

## Tuning Products, Categories, and Prompts Without Touching Code

Product names, issue categories, non-self-service filter keywords (e.g., RMA/billing), and LLM system prompts live in:
- `config/taxonomy-and-prompts.json` (default seed)
- `%APPDATA%/Seer/taxonomy-and-prompts.json` (active user copy)

# Resume Studio

[中文](./README.md) | [English](./README.en.md)

[![CI](https://github.com/Awen-9/resume-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/Awen-9/resume-studio/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Resume Studio is a local-first personal resume editor. It separates resume content, template styles, and A4 layout so you can edit, preview, import, and export a resume without an account or cloud service.

It is intentionally designed for personal local use. There is no login, payment, cloud sync, cover-letter workflow, online analytics, or career assessment.

## Features

- Manage multiple local resumes with create, duplicate, rename, and delete actions.
- Edit profile data, education, experience, projects, skills, summary, and custom sections.
- Reorder, hide, remove, and add sections with drag-and-drop support.
- Use rich text formatting for bold, italic, and bullet lists.
- Preview three templates with configurable font, size, line height, margins, spacing, accent color, and page numbers.
- One-page modes with automatic font/line-height/margin compression and overflow warnings.
- Accent color and font presets for one-click re-skinning.
- Import text-based PDF or Word (.docx) resumes into structured sections with a review step before saving; Word keeps headings, lists, and table cells.
- Export PDF and DOCX files through the local Fastify service.
- Paragraph-level splitting for oversized items so a single long entry is never truncated at a page boundary.
- Persist data in IndexedDB with localStorage migration fallback, history, undo/redo, and JSON backup/restore.
- Validate a backup before touching local data, skip unusable records, and undo a restore in one click.
- Explain storage failures in the UI (with a retry entry) instead of showing a blank page, and warn when autosave fails.
- AI rewrite through a local model: streaming preview, applied as a single transaction so Ctrl+Z reverts it whole.
- Job description matcher with fast/deep modes; deep mode quotes the resume line behind every matched keyword.
- Self-healing setup script that repairs missing native dependencies and macOS Gatekeeper quarantine.
- Tauri desktop packaging (`npm run tauri:build`, ~10 MB native app).
- Run unit, integration, browser E2E, lint, formatting, and build checks locally or in GitHub Actions.

## Not Included

- OCR for scanned/image-only PDFs (status detection is ready; recognition requires installing Tesseract)
- Cloud sync, accounts, sharing links, payments, or remote storage
- Cloud AI, ATS scoring, application tracking, or career assessments (AI runs on a local Ollama by default; choosing DeepSeek sends the resume and JD to DeepSeek's servers)
- Desktop sidecar binary (the current desktop build depends on a system Node runtime)
- Docker image or hosted deployment

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- A Chromium browser for PDF rendering (the setup script installs Playwright Chromium)
- Optional: [Ollama](https://ollama.com/) with `qwen3-8b` on the same machine (only for AI rewrite and the JD matcher)

The server reads `.env` automatically. `CHROME_PATH` is optional; when it is empty, the app uses Playwright-managed Chromium or a detected system browser.

## Quick Start

```bash
git clone <your-repository-url>
cd resume-studio
npm ci
npm run setup
npm run doctor
npm run dev
```

Open <http://127.0.0.1:5173>. The Vite frontend listens on port `5173`, while the local Fastify API listens on `4173`.

Copy `.env.example` to `.env` only when you need to change the port, host, or browser executable:

```bash
cp .env.example .env
```

Useful commands:

```bash
npm run dev          # frontend + local API
npm run dev:web      # frontend only
npm run server:dev   # local API only
npm run build        # production frontend and server build
npm run start        # serve the production build on port 4173
npm run doctor       # check Node, browser, and local binding
npm test             # unit and integration tests
npm run test:e2e     # browser workflows
npm run test:all     # tests, build, and E2E checks
npm run lint         # ESLint
npm run format:check # Prettier check
```

## Data and Privacy

Resume data stays in the browser's IndexedDB on the current computer. PDF/Word import, export, and AI requests go to the local `127.0.0.1` services by default; only when DeepSeek is selected in Settings does the local service forward the resume and JD to DeepSeek. Use the in-app JSON backup before moving to another computer; never commit that backup, a personal PDF, screenshots, or `.env` to GitHub.

## Local AI (optional)

By default, AI rewrite and the JD matcher call [Ollama](https://ollama.com/) on the same machine, so resume content never leaves it. If you switch to DeepSeek in Settings, the resume and JD are sent to DeepSeek's servers.

```bash
ollama serve
ollama pull qwen3-8b
curl http://127.0.0.1:4173/api/ai/status   # {"available":true,...} means ready
```

- When the model is missing, the AI buttons are disabled up front and say why, instead of failing after a click.
- Deep matching checks keywords one by one and quotes the source line, so it can take 30–60 seconds on an 8B model. Cancel it from the dialog, or just close the dialog, and the request is aborted.
- AI requests are queued locally (one at a time) so two jobs do not fight over the same GPU.
- Override the endpoint and model with `OLLAMA_URL` and `OLLAMA_MODEL` in `.env`.
- The DeepSeek API key is stored only in this browser's `localStorage` (`resume-studio.ai-settings.v1`); it is never written to the repository, backups, or logs.

## Troubleshooting

### `Cannot find module @rollup/rollup-darwin-arm64`

This is a known npm bug that skips an optional dependency on macOS Apple Silicon. `npm run setup` repairs it automatically, or install it manually:

```bash
npm install @rollup/rollup-darwin-arm64 --no-save
```

### macOS "cannot verify the developer" prompt (fsevents.node)

This is Gatekeeper blocking an unsigned native module, not a security issue. Click "Cancel" and run `npm run setup`, which clears the quarantine attribute. Do not click "Move to Trash", or the frontend hot-reload module will be removed.

### Scanned PDF import asks for OCR

Scanned (image-only) PDFs cannot extract text directly and need Tesseract:

```bash
# macOS
brew install tesseract
tesseract --version
```

If Tesseract is not on the default `PATH`, set `TESSERACT_CMD=/path/to/tesseract` in `.env`. Check the current OCR status at `http://127.0.0.1:4173/api/ocr/status`.

## Desktop Build

```bash
npm run tauri:build
```

A Rust toolchain (`rustup`) is required. The output is written to `src-tauri/target/release/bundle/` (`Resume Studio.app` on macOS, ~10 MB). On launch, the app detects a system Node runtime and spawns the export service, reclaiming it on exit.

### Opening an unsigned build

Release packages are not code-signed yet, so the OS blocks the first launch:

- **macOS**: double-click once, then open System Settings → Privacy & Security and click "Open Anyway". Right-click → Open no longer works on macOS 15+; alternatively run `xattr -dr com.apple.quarantine "/Applications/Resume Studio.app"`.
- **Windows**: on the SmartScreen prompt, click "More info" and then "Run anyway".

## Architecture

- `src/domain/resume`: resume model, defaults, parsing, backup parsing, content preparation, page packing (`layout.ts`), checks, and rendering
- `src/features`: home, editor (with `inspector/` split into personal info / page style / section content), and PDF/Word import review workflows
- `src/infrastructure`: local API, IndexedDB, state, and DOCX export adapters
- `src/shared`: browser utilities and UI composables (dialog accessibility, AI availability probe, undo focus routing)
- `server/routes`: HTTP protocol boundaries, including the AI rewrite/match/status endpoints
- `server/services`: PDF text extraction, two-pass PDF rendering (measure, then paginate), and DOCX export
- `server/shared`: request validation and the AI concurrency gate
- `tests`: unit, integration, and browser E2E coverage

Page packing lives in exactly one place: `planPages` decides which blocks go on which page from measured
heights. The preview measures in the browser and the exporter measures in headless Chromium, then both call it.
Template styles also have a single source (`RESUME_CONTENT_CSS`), injected into the preview and inlined into the export.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for dependency rules and extension points.

The real-PDF integration test uses an optional environment variable and never requires a personal file in the repository:

```bash
RESUME_FIXTURE_PDF=/absolute/path/to/resume.pdf npm test
```

Set `RESUME_FIXTURE_NAME` as well when you want an exact name assertion. Without a fixture path, that test is skipped while the other import and export tests still run.

## Open Source

The repository includes a lockfile, Node version files, environment template, CI workflow, issue forms, a pull request template, MIT license, contribution guide, security policy, and changelog. Replace `your-org/resume-studio` in the README badge with the real GitHub owner and repository name after publishing.

For a new local directory, initialize and push it only after checking that no personal files are present:

```bash
git init
git add .
git status
git commit -m "chore: prepare open-source release"
git branch -M main
git remote add origin https://github.com/<owner>/<repository>.git
git push -u origin main
```

Make sure the staged files do not include resume PDFs, backup JSON, screenshots, `.env`, `node_modules`, `dist`, or `dist-server`.

- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Changelog](./CHANGELOG.md)
- [License](./LICENSE)

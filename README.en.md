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
- Import text-based PDF resumes into structured sections with a review step before saving.
- Export PDF and DOCX files through the local Fastify service.
- Persist data in IndexedDB with localStorage migration fallback, history, undo/redo, and JSON backup/restore.
- Run unit, integration, browser E2E, lint, formatting, and build checks locally or in GitHub Actions.

## Not Included

- OCR for scanned/image-only PDFs
- Cloud sync, accounts, sharing links, payments, or remote storage
- AI writing, ATS scoring, application tracking, or career assessments
- Desktop installer, Docker image, or hosted deployment

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- A Chromium browser for PDF rendering (the setup script installs Playwright Chromium)

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

Resume data stays in the browser's IndexedDB on the current computer. The application has no remote upload logic. PDF import and export requests go only to the local `127.0.0.1` service. Use the in-app JSON backup before moving to another computer; never commit that backup, a personal PDF, screenshots, or `.env` to GitHub.

## Architecture

- `src/domain/resume`: resume model, defaults, parsing, pagination, checks, and rendering
- `src/features`: home, editor, and PDF import review workflows
- `src/infrastructure`: local API, IndexedDB, state, and DOCX export adapters
- `src/shared`: browser utilities without business dependencies
- `server/routes`: HTTP protocol boundaries
- `server/services`: PDF text extraction, PDF rendering, and DOCX export
- `tests`: unit, integration, and browser E2E coverage

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

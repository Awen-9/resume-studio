# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses semantic versioning for published releases.

## [Unreleased]

### Added

- Cross-platform setup and environment diagnosis commands.
- Bilingual project documentation and open-source contribution files.
- GitHub Actions validation for lint, formatting, tests, build, and E2E workflows.
- Accent color and font presets for one-click re-skinning.
- Paragraph-level splitting for oversized content items.
- Self-healing setup script (repairs missing rollup native modules and macOS Gatekeeper quarantine).
- Tauri 2 desktop packaging.
- Email and phone format validation, plus schema version validation.
- Legacy `one-page` page-mode normalization to `one-page-strict`.
- Persistent storage request on startup and a home-page reminder when no backup has been made for 14 days.
- E2E coverage for multi-step undo/redo and backup restore.
- CI `cargo check` for the desktop shell on macOS and Windows.

### Changed

- Upgraded Tiptap from 2.x to 3.x.
- Upgraded Vitest to 3.x and hardened integration test timeouts.
- Removed legacy `src/lib`, `src/data`, `src/types`, and `src/stores` re-export shims.
- Consolidated the redundant `one-page` page mode into `one-page-strict`.
- Undo/redo now uses in-memory snapshot stacks, so multi-step undo works and redo is no longer lost.
- Autosave merges history versions created within two minutes; manual save (Ctrl/Cmd+S) and history restore always create a new version.
- PDF export reuses one Chromium instance with an isolated, offline context per request.
- Preview and PDF export share one template stylesheet (`src/domain/resume/templateStyles.ts`) instead of two hand-synced copies.
- The editor and import review screens are lazy-loaded, shrinking the initial bundle from 518 KB to 103 KB.
- Shared HTML utilities (`escapeHtml`, `sanitizeRichHtml`, `stripHtml`) moved to `src/domain/resume/html.ts`.
- The desktop shell checks server health over TCP instead of shelling out to `curl`, and no longer hard-codes a machine-specific Node path.

### Fixed

- Fixed a redundant ternary expression in the PDF import parser.
- Rich text is sanitized by rebuilding allowlisted tags without attributes, closing script and event-handler bypasses.
- Export requests and backup imports are validated structurally, including theme values written into inline styles.
- A backup containing one malformed resume no longer wipes existing data.
- Splitting an oversized item no longer duplicates content; continuation fragments keep the original text exactly once.
- The local server rejects requests from other websites (`Origin`) and DNS rebinding (`Host`).
- The email check is now anchored, and phone and email problems are reported before export.

## [0.1.0] - 2026-10-25

### Added

- Local-first resume editing, PDF import, PDF export, and DOCX export.
- IndexedDB persistence, history, undo/redo, backup, and restore.
- Three resume templates and A4 pagination checks.

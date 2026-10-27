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

### Changed

- Upgraded Tiptap from 2.x to 3.x.
- Upgraded Vitest to 3.x and hardened integration test timeouts.
- Removed legacy `src/lib`, `src/data`, `src/types`, and `src/stores` re-export shims.
- Consolidated the redundant `one-page` page mode into `one-page-strict`.

### Fixed

- Fixed a redundant ternary expression in the PDF import parser.

## [0.1.0] - 2026-10-25

### Added

- Local-first resume editing, PDF import, PDF export, and DOCX export.
- IndexedDB persistence, history, undo/redo, backup, and restore.
- Three resume templates and A4 pagination checks.

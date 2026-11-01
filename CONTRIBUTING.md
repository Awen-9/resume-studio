# Contributing to Resume Studio

Thank you for helping improve Resume Studio. The project is local-first and intentionally avoids accounts, cloud sync, analytics, and remote resume storage.

## Development Setup

```bash
npm ci
npm run setup
npm run doctor
npm run dev
```

Before opening a pull request, run:

```bash
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e
```

## Code Guidelines

- Keep domain rules in `src/domain`, not in Vue templates or HTTP routes.
- Keep browser persistence and local API calls in `src/infrastructure`.
- Keep routes focused on request validation, status codes, and response types.
- Use strict TypeScript types and existing Vue/Pinia patterns.
- Add or update tests for behavior changes.
- Do not commit personal resumes, exported backups, screenshots, `.env`, build output, or browser caches.
- Keep user data local. Do not add telemetry, remote uploads, or hidden network calls.

## Pull Requests

Describe the user-visible change, the affected area, and the verification commands you ran. For UI changes, include a screenshot or a short reproduction path. Keep unrelated refactors out of the same pull request.

## English Summary

Please keep changes scoped, tested, and consistent with the local-only privacy model. New features should include documentation and tests where applicable.

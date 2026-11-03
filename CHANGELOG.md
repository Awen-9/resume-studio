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
- Local AI rewrite with streaming preview, and a JD matcher with fast/deep modes where deep mode quotes the resume line behind each matched keyword.
- `GET /api/ai/status` plus a UI probe: AI entry points disable themselves and explain why when the local model is unavailable.
- Backup parsing in `domain/resume/backup.ts`: unusable records are skipped and counted, and validation always happens before any write.
- Undoable backup restore, plus a snapshot-based rollback path.
- Readable error page (with retry) when local storage cannot be opened, and a persistent banner when autosave fails.
- `useDialogA11y`: Escape to close, focus trap, and focus restore for dialogs.
- Serialized local AI queue (`server/shared/aiLimiter.ts`) and client-side cancellation for JD matching.
- `planFragments` in `domain/resume/layout.ts`: the single page-packing algorithm shared by the preview and the PDF exporter.
- Sections now flow across pages item by item, with the section heading repeated on the continuation page.
- An offscreen measurement layer in the preview, and a two-pass (measure, then paginate) PDF export.
- A committed pixel baseline for the resume paper (`tests/e2e/app.spec.ts-snapshots`), skipped on CI because it depends on local font rendering.
- Items taller than a page are split by measured height (sentence boundaries, or bullets as a fallback) with `（续）` continuations.
- The preview scales the paper down to fit its pane, showing the zoom percentage in the meta line.
- `npm run desktop:doctor`: per-platform check for Rust, MSVC, WebView2, Xcode, and hdiutil with the exact install commands.
- A CI job that runs `cargo check` for the Tauri shell on `windows-latest`.
- A shared type scale (`domain/resume/typography.ts`): section > item title > item subtitle > body, derived from the user's font size and used by the preview, PDF, and Word exports; the first three levels are bold.
- Lead-in labels in body paragraphs ("多 Agent 架构：…") are bolded at render time (`domain/resume/leadIn.ts`), for the preview, PDF, and Word alike.
- Fixed page count (`theme.targetPages`): pick 1–6 pages and the content is spread across exactly that many pages and stretched to fill them; the type scale is enlarged or compressed automatically when the natural page count differs.
- Word (.docx) import: headings, list items, and table cells are preserved, then fed through the same parser and review screen as PDF import; legacy `.doc` and encrypted files are rejected with actionable messages.
- `activeEditor` focus registry for undo routing; the inspector is now three focused sections.
- `data-dirty` on the editor root, so "saving" and "saved" are distinguishable in the UI and in tests.

### Changed

- Upgraded Tiptap from 2.x to 3.x.
- Upgraded Vitest to 5.x (staying on Vite 6); `npm audit` is now clean, including the two critical tinypool advisories from the Vitest 3 dependency chain.
- Removed legacy `src/lib`, `src/data`, `src/types`, and `src/stores` re-export shims.
- Consolidated the redundant `one-page` page mode into `one-page-strict`.
- Split the inspector's layout control into independent "density" and "page count" controls; density no longer overwrites the page mode.
- The editor workspace now scrolls its three panes independently, so the outline stays visible on long resumes.
- Undo/redo now moves a cursor through stored versions instead of writing a new version per undo.
- Undo now routes by focus: text undo inside rich-text editors, structural undo elsewhere; both entries (toolbar and keyboard) share the same routing.
- Structural edits go through the debounced autosave queue instead of saving twice.
- Home cards are containers with sibling buttons instead of a button that nests another interactive element.
- Layout status is reported once by the preview and consumed by the editor; the duplicate DOM measurement before export was removed.
- Removed the unused non-streaming `/api/ai/rewrite` endpoint and its client helper.
- Template styles now live in one place (`RESUME_CONTENT_CSS`) and are injected into the preview and inlined into the export.
- Preview, measurement layer, and import review share the same header/section components.
- The preview no longer moves overflowing blocks between pages in a loop (up to 40 iterations); it measures once and re-renders from the plan.
- Tiptap and the JD dialog are loaded on demand; the main bundle dropped from 548 kB to 151 kB (183 kB to 55 kB gzipped).

### Fixed

- Fixed a redundant ternary expression in the PDF import parser.
- Fixed backup restore wiping local data before validation, which could destroy existing resumes on a malformed file.
- Fixed rich text sanitizing being bypassable via `<li/onclick="…">`; tags are now parsed and re-serialized with all attributes dropped.
- Fixed JD "go edit" always jumping to the first section (it now resolves a real keyword and searches rich-text content too).
- Fixed the editor going blank with no explanation when storage initialization failed.
- Fixed repeated undo bouncing between two versions.
- Fixed clicking a section in the preview (or the outline) not bringing its editor into view: the inspector pane now scrolls to that section and flashes it briefly.
- Fixed title edits being lost when the field never blurred: the title now autosaves on input like every other field.
- Fixed adding a content item leaving it collapsed: the new item opens and takes focus.
- Fixed adding a section not selecting it, and deleting a section leaving the editor with no selection: the new section is selected, and deletion falls back to a neighbour.
- Fixed deleting a single content item having no undo; it now snapshots and offers undo, like section deletion.
- Fixed "apply saved style" being clickable when nothing had been saved.
- Accessibility: outline move/visibility buttons now have labels, rows support Space as well as Enter, and dragging shows a drop target.
- Fixed page count is now enforced: when the content does not fit, the type scale keeps shrinking instead of stopping at 0.7×, so choosing 1 page really yields 1 page (preview and PDF alike). The preview says how small the body text became, or that the content could not be spread over the requested pages.
- Interaction pass: content items can be reordered (previously they could only be deleted and re-added); a new bullet takes focus; the page-mode presets are disabled while a fixed page count is active; exports cannot be started twice while one is running; a failed import offers retry instead of forcing a second file pick.
- Product pass: a permanent "检查" entry (with a pending-issue count) opens the same checklist without exporting; content items can be duplicated in place; section editors show a short writing hint; exported files are named after the candidate ("李雷-后端工程师-简历.pdf").
- Performance: the interview and import-review pages are lazily loaded, cutting the initial JS bundle from 180.9 kB to 162.6 kB (gzip 65.6 → 59.8 kB). Measured hot paths: editor open 165 ms, keystroke → preview 11-22 ms even at 8 pages, autosave ~350 ms.
- Engineering debt: the API key input gained a clear button, and the empty-content retry is now covered by an integration test (fake DeepSeek returns empty first, then valid; two chat calls asserted).
- Content-quality checks: the pre-export checklist now also flags experience/project items without a quantified result, bullets that start with weak verbs (做了 / 参与了), and overlong bullets — all as non-blocking warnings. A plain-text export button pastes the resume into job-portal forms.
- AI output stability layer (`server/services/aiStable.ts`): friendly error messages that stop leaking internals like "content 为空", a `askJsonStable` helper with one repair-retry on malformed JSON plus model fallback (DeepSeek flash → v4-pro), and the resume-optimization endpoint now uses it. The interview, JD and match routes surface friendly errors.
- P2 responsive pass: the agent and settings two-column layouts now stack on narrow screens (<=760px) and the home action row wraps, so the newer pages are usable on mobile.
- Polish (P0/P1): a 本机存储 trust badge and a stronger backup CTA on the home header; a one-click 看看示例 sample resume for onboarding; retry + 去设置 action buttons next to AI errors on the interview and agent pages.
- Home page cleanup: PDF and Word imports are now a single 导入简历 button that auto-detects the type, and each resume card gained an 导出 menu (PDF / Word / plain text) so you can export without opening the editor. Updated the e2e selectors that referenced the old import input ids.
- Centralized settings: a new 设置 page manages the model source, DeepSeek API key (with clear) and default model; the interview and agent pages no longer duplicate the key input and instead show a compact model summary with a link to settings. The default model is now persisted and reused by `providerPayload`.
- The agent final-answer block is hidden when steps already rendered the full result (only shown for tool-free answers), removing the redundant wall of text.
- The agent final-answer block now preserves line breaks (pre-wrap) so its numbered/structured text no longer collapses into one blob.
- Agent output is now rendered per tool type instead of a raw JSON dump: summaries as readable text, resume edits as before/after/reason cards, and questions as cards with type/difficulty badges and collapsible answers.
- Fixed the agent tool crash on question types: the model passed unconstrained type names (e.g. Chinese labels) and `TYPE_RUBRICS[type].split` threw. Added `normalizeQuestionTypes` (alias → enum, filter invalid, default) and made the rubric builder skip unknown types defensively.
- Fixed the agent asking the user for materials it already had: the resume and JD are now injected into the planner context, tools use the closure copy instead of requiring the model to re-pass them, and the context explicitly tells it not to ask the user again. Regression test covers it.
- The agent page now has full model configuration (provider, API key with clear button, model picker, refresh and test connection), mirroring the interview page, so you can point the agent at DeepSeek or a local model before running it for real.
- Agent memory / job profiles: after an agent run you can save the result as a job profile (tied to the resume, storing JD + goal + steps + answer). Profiles persist across sessions and can be restored or deleted — this is the 「一岗一版」 seed.
- Agent goal page: a new 「AI Agent」 entry opens a page where you give a one-line goal (plus an optional JD) and pick a resume; the agent runs autonomously and streams each tool step (summarize / optimize / generate questions) live, with a stop button. Backed by a new SSE route `/api/agent/run`.
- Agent foundation (`server/services/agent.ts`): a minimal tool registry + planner loop. The model returns a JSON action (call a tool or finish), the loop executes it, feeds the result back, and repeats; unknown tools and malformed actions are handled gracefully. The model call is injectable, so the loop is unit-tested with a scripted fake (3 tests).
- AI resume optimization (phase 1): a new `/api/ai/optimize` endpoint takes a JD and the resume and returns a one-line summary plus concrete rewrites (`before`/`after`/`reason`) that only rephrase existing content — no fabricated facts or numbers. Integration test covers the happy path.
- Increased DeepSeek output budgets (summarize 4000, questions 32000 tokens), tightened resume/JD truncation, and added one automatic retry when a reasoning model returns empty `content` (it is intermittent and a second attempt usually produces the answer).
- The question flow now summarizes the resume first (tech stack, highlights, and the 3-5 vaguest points worth probing), shows that summary in the UI, and generates questions from it instead of the raw resume — shorter, denser input that also fixes the reasoning blow-up on long resumes.
- Fixed the reasoning explosion on long inputs: DeepSeek V4 reasons character-by-character over the whole input, so a long JD makes `reasoning_content` consume the output budget and `content` come back empty. The JD is now truncated to 800 chars and the resume to 4000 before being sent.
- DeepSeek V4 returns the answer in `content` and its chain-of-thought in `reasoning_content`; the code was wrongly falling back to `reasoning_content` when `content` was empty, leaking English reasoning into the output. It now returns `content` only and raises the interview output budget to 16k tokens.
- DeepSeek V4 models are reasoning models that default to `effort: high`, burning the whole output budget on internal reasoning and returning empty content. Requests now send `effort: "low"` and the default model list is updated to `deepseek-flash` / `deepseek-v4-pro` (the old `deepseek-chat` / `deepseek-reasoner` names are gone).
- Empty model responses are no longer a dead end: DeepSeek calls now read the raw body, fall back to `reasoning_content`, and report the actual gateway response (first 240 chars) when the content is empty — so the next failure shows exactly what the model returned instead of a generic message.
- Fixed the real cause of 「模型没有返回可用的题目」: an operator-precedence bug (`a ?? b ? c : d` parsed as `(a ?? b) ? c : d`) meant Chinese type names were returned verbatim and then filtered out. Added `npm run verify:interview`, which drives the real route against a fake OpenAI-compatible server covering three output shapes (one object per line, a pretty-printed `{"questions":[...]}`, and a fenced array).
- Question parsing now normalises what models actually emit: Chinese type names (场景题 / 八股文 / 算法 …) and difficulty words (简单 / 中等 / 困难) map onto the schema instead of being rejected, and when nothing parses the error now carries the first 180 characters of the raw model output so the format problem is visible.
- Fixed 「出题失败」 when the model answers with a JSON array (or a fenced/pretty-printed block) instead of one object per line: parsing now falls back to the whole response, tolerates `- ` / `1. ` prefixes, and DeepSeek gets an 8000-token output budget for the deep profile (five long answers used to be truncated). Failures now carry the underlying reason in `detail`, shown in the error message.
- Prompt profiles for different model sizes: 精简 (1-4B, three short sections), 标准 (7-8B, five sections), 深度 (14B+/cloud, seven sections with trade-off comparison and failure chain). The page picks a default from the model name and lets you override it; both the batch and expand prompts follow the chosen profile.
- Answers now follow the JavaGuide style: a short 「简要回答」 conclusion, then 「详细回答」 with numbered points, 「关键细节」 (commands/params in backticks), two layers of 「常见追问」 and 「易错点」. A tiny built-in markdown renderer draws section headings, bold and inline code, escaping raw HTML first so model output cannot inject markup.
- Answers are pushed further: the prompt now demands 400-700 characters, at least two concrete component/command names and one quantified metric per question, plus a "what failure looks like" note, anchored with good/bad examples. Token budget raised to 4096, and every question card gained a 「展开更细」 action that asks the model for a 500-900 character answer on demand.
- Interview answers are now written to an interview-ready standard: per-type rubrics (clarify constraints / mechanism / trade-offs), 150-300 characters with numbered points, plus a follow-up direction and a common pitfall on every question. Prompts live in `server/services/interviewPrompts.ts`.
- Fixed first JD generation failing on a cold model: SSE now opens with a comment and sends a heartbeat every 5s, so a 10-40s model load no longer looks like a dead connection; the page also explains that the first call has to load the model, and server errors carry a `detail` in development.
- Generate a JD from a one-line role ("Agent 工程师"): the text streams into the JD box, can be edited or regenerated, and then feeds question generation like a pasted JD.
- Interview questions now stream: the model is asked for one JSON object per line, and each parsed question is pushed over SSE (`/api/interview/questions/stream`) so the page appends cards as they arrive instead of waiting for the whole batch. DeepSeek uses the same event shape, emitting the batch once. A too-strict answer length check was relaxed so terse but valid answers are no longer dropped.
- Interview generation can be paused: while the model is working the primary button becomes 「暂停」, which aborts the request (the server aborts the upstream generation on disconnect) and leaves every setting intact; once results exist the button reads 「重新出题」.
- The JD is now optional on the interview page: leaving it empty generates questions from the resume alone (the prompt switches to "use the resume's stack and projects"), and the page no longer asks for 10 characters before enabling the button.
- Fixed the generate button staying disabled after pasting an API key: the key used to be applied only on blur, so a straight click hit a disabled button. It now validates as you type, and the page states exactly why the button is unavailable (JD too short / no resume / no reachable model).
- The model setting now covers every AI feature: rewriting and the JD check follow the same provider choice as interview questions. DeepSeek rewriting returns the whole result in one chunk (the streaming path stays local-only), and the interview page gained a "test connection" button that reports how many models each backend actually answered with.
- Two model backends for AI features: local Ollama (default) and DeepSeek via a user API key. The key lives only in the browser, travels as an `x-ai-key` header per request, and never touches the server or backups. The model picker lists only models the current backend actually reports, and switching to DeepSeek without a key falls back to local instead of failing.
- Interview question generation (面试出题): a new page where an interviewer pastes a JD, picks a resume, chooses question types (场景题 / 八股文 / 基础知识 / 算法 / 项目深挖) and gets questions with answers from the local model. Questions can be favorited into a question bank that keeps a snapshot of the JD and resume, and the model picker only lists models actually installed in Ollama.

- Narrow screens: below 980px the inspector becomes an overlay drawer (auto-collapsed, 34px rail to reopen) and the editor no longer forces a 960px page width, so 13" laptops at 125% scaling work without horizontal scrolling.
- QA pass: the inspector no longer gets clipped on 1024px screens (the middle column could not shrink); Escape now closes the history drawer like every other panel; the inspector collapse handle has an accessible name.
- Leftovers: the pre-export checklist now reports a fixed page count that was not reached; the rewrite call has a hard timeout (`OLLAMA_TIMEOUT_MS`, default 120s) so a stuck model cannot hold the model queue.
- Architecture pass: layer boundaries (`app → features → infrastructure → domain`, `server → domain`) are now enforced by ESLint; the Word renderer moved into `server/services` because only the server used it. Added a client-wide unexpected-error channel (Vue `errorHandler`, `unhandledrejection`, `window.onerror`) that surfaces failures in the UI instead of only the console. The API now has uniform JSON error and 404 handlers, and backups written by a newer schema version are rejected instead of silently normalised.
- Local model calls now share one client (`server/services/ollama.ts`): chat endpoint with a real system prompt, thinking disabled, `num_ctx` raised to 8192 (long resumes were being truncated at the default window), a lower rewrite temperature, and model keep-alive. Rewrite output is cleaned of think blocks and pleasantries, retried once when the model only produces chatter, and JD checks retry once on malformed JSON. A fake Ollama server covers all of this in integration tests.
- Fixed the export reflow script being the only thing that could move content between pages; pagination is now decided before printing.
- Fixed rich-text paragraph spacing differing between preview and export.
- Fixed the Tauri shell not compiling on Windows (`std::os::unix` used unconditionally), its node discovery only knowing macOS paths, and its health check depending on `sh` + `curl`.
- Fixed `build:tauri` using a Unix-only `VAR=value` prefix, which fails in the Windows cmd shell.

## [0.1.0] - 2026-10-25

### Added

- Local-first resume editing, PDF import, PDF export, and DOCX export.
- IndexedDB persistence, history, undo/redo, backup, and restore.
- Three resume templates and A4 pagination checks.

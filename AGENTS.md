# Repository Guidelines

## Project Structure & Module Organization
- `index.html` loads UIkit from CDN, hosts the recording/notes tabs, and embeds settings iframes.
- `index.js` controls recording, transcription, refinement, and UI state; it imports `notes.js` (localStorage CRUD) and `aws-sync.js` (two-way S3 sync).
- `api-settings.html` / `aws-settings.html` persist OpenAI and AWS credentials to `localStorage` via their forms.
- `index.css` styles the UI; `prompts.json` stores refinement templates; `spec.md` and `notes.spec.md` describe product behavior; `docs/references/uikit-docs` holds UIkit reference; `tests/` is reserved for automated tests (currently empty).

## Build, Test, and Development Commands
- `./run-local.sh` — serve the static site at `http://127.0.0.1:8000` (wraps `python -m http.server`).
- `python -m http.server 8000 --bind 0.0.0.0` — expose the app to your LAN when needed.
- No build step or package install is required today; keep dependencies CDN-based unless agreed.

## Coding Style & Naming Conventions
- Use ES modules with 4-space indentation, semicolons, and `camelCase` for variables/functions; keep filenames kebab-case (e.g., `aws-sync.js`).
- Prefer small, single-purpose functions; keep UI strings near their usage (see label constants in `index.js`).
- Comments and user-facing text stay in English; reuse UIkit classes instead of duplicating styles.
- Avoid introducing bundlers/transpilers without maintainer buy-in.

## Testing Guidelines
- Automated tests are not yet configured; add new tests under `tests/` using `<feature>.spec.js` when introducing logic changes.
- Minimum manual QA before PR: record audio, confirm 10-minute cutoff, run transcription & refinement, verify `localStorage` persistence, and (when configured) S3 sync download/upload success.
- Document any known limitations or skipped scenarios in the PR description.

## Commit & Pull Request Guidelines
- Follow the existing short, imperative style (`fix: ...`, `update: ...`); keep messages under ~72 characters.
- PRs should include: summary of changes, linked issue/task, screenshots or screen recording for UI changes, and test/QA steps.
- Confirm no secrets are committed (OpenAI/AWS keys stay in `localStorage`), and note any config prerequisites (`apiKey`, `baseURL`, `s3-bucket-name`).
- Request review before merging; avoid force pushes after review without coordination.

## Security & Configuration Tips
- Keys and tokens stay client-side; remind users to clear `localStorage` on shared machines.
- Serve over HTTPS (required for microphone access) outside localhost; ensure CORS rules allow direct OpenAI/AWS calls when using custom `baseURL` or buckets.

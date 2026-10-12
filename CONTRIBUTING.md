# Contributing to Spindle DJ

Thanks for helping! Spindle DJ was created by David Blackwood and is licensed GPL-3.0-or-later. By contributing, you agree that your contribution is licensed under the same terms, and that the attribution in [NOTICE](NOTICE) stays in place. Add yourself to [AUTHORS.md](AUTHORS.md) in your first pull request.

## Workflow

1. **Fork** the repository on GitHub and clone your fork.
2. Create a branch: `git checkout -b feature/my-idea`.
3. Make the change, then add or adjust tests (see the ground rules below).
4. Run `npm run typecheck && npm test && npm run test:e2e`.
5. Push and open a **pull request** that describes what changed and how you tested it.

Not a programmer? Bug reports, feature ideas, controller mappings and documentation fixes help too. Open an issue using one of the templates.

## Setup

```bash
npm ci
npm run dev        # http://localhost:5173/
npm test           # unit tests
npm run test:e2e   # browser acceptance tests (needs Chrome; set CHROME_PATH if not auto-detected)
```

## Ground rules

1. **Audio thread hygiene.** Code that runs in `process()` / `render()` must not allocate, await, log, or post messages per sample. Keep DSP in pure kernel classes (`*-kernel.ts`) with unit tests.
2. **No fake features.** Every visible control must do real work. Unfinished features stay out of the UI and go in `docs/ROADMAP.md`.
3. **No fake data.** Never display a BPM, key or grid that wasn't computed or user-entered; show confidence.
4. **Tests.** New DSP or parsing code needs unit tests. Behaviour visible in the mix needs an E2E assertion that *measures the recorded output*. Fixed bugs get a regression test.
5. **Dependencies.** Runtime dependencies are avoided. Any new dependency must be GPL-3.0-compatible, pinned, justified in the PR, and added to `THIRD_PARTY_NOTICES.md`.
6. **Privacy.** No network requests, telemetry or analytics.
7. **Accessibility.** Controls need labels and keyboard operation; respect `prefers-reduced-motion`.
8. **No proprietary assets.** Do not copy code, artwork, skins or trademarks from other DJ software.
9. **Keep the credit.** Do not remove the copyright headers or the “Created by David Blackwood” line in the About screen (`src/credits.ts`).

## Pull requests

* `npm run typecheck && npm test && npm run test:e2e` must pass.
* Keep PRs focused; describe what you changed and how you tested it (including hardware, if relevant).
* Controller mappings are welcome as exported JSON files under `mappings/` with the controller name and firmware version.

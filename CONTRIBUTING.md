# Contributing to Claude Code Studio

Thanks for your interest in improving Claude Code Studio! This guide covers the
local setup, the branch/PR workflow, and the conventions this project follows.

## Development setup

1. **Use Node 22 LTS.** `package.json` pins `engines.node` to
   `">=22.0.0 <24.0.0"` — newer majors break electron-packager.
   With [nvm](https://github.com/nvm-sh/nvm):
   ```bash
   nvm install 22 && nvm use 22
   ```
2. Install and run:
   ```bash
   npm install            # runs the node-pty patch postinstall
   npm start              # Vite + Electron with hot reload
   ```
3. On Windows, the node-pty native build needs VS Build Tools 2022 (C++ workload)
   and the Windows 10/11 SDK. See [`README.md`](./README.md#prerequisites).

## Branch & PR workflow

- Branch from `master` using a descriptive prefix: `fix/…`, `feat/…`,
  `chore/…`, or `docs/…`.
- **External contributors** (without push access) work from a fork and open a
  cross-fork pull request into `LxveAce/claude-code-studio:master`.
- Keep a PR focused on one concern. Open separate PRs for unrelated changes.
- Fill in the pull request template and describe how you verified the change.

## Commit messages

- Imperative, present tense: "Fix terminal resize loop", not "Fixed…".
- A concise subject line; wrap the body at ~72 columns and explain the *why*.

## Conventions

- **Code style:** TypeScript throughout. Match the surrounding code — naming,
  comment density, and idioms. Prefer small, readable diffs over churn.
- **LMM journaling:** non-trivial work is thought through with the Lincoln
  Manifold Method and recorded under [`journal/`](./journal/) — one
  `<source-path>.lmm.md` analysis per file.
- **Security self-review:** substantial features get a self-red-team pass
  recorded under [`docs/security-reviews/`](./docs/security-reviews/), with
  Criticals + Highs fixed in the same change set and Mediums documented as
  deferred. See [`SECURITY.md`](./SECURITY.md).

## Verifying changes

There are no automated tests yet, so verify by **running the app** and
exercising the affected behavior (`npm start`). For renderer/layout changes,
confirm the terminal and any touched panels still work. Note in your PR what you
checked and on which platform — the shipped build is Windows, so flag anything
verified only on Linux/macOS.

## Reporting bugs & requesting features

Open an issue using the relevant template under `.github/ISSUE_TEMPLATE/`.
Known bugs and spitballed ideas also live in [`docs/BACKLOG.md`](./docs/BACKLOG.md).

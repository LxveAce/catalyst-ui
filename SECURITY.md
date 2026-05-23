# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅        |
| < 1.0   | ❌        |

Claude Code Studio auto-updates from GitHub Releases on Windows, so the latest
released version is the supported one.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via GitHub's **"Report a vulnerability"** button under the
repository's **Security** tab
(<https://github.com/LxveAce/claude-code-studio/security/advisories/new>). This
opens a private advisory visible only to the maintainers.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (or a proof of concept).
- Affected version / platform.

We aim to acknowledge reports within a few days and will coordinate a fix and
disclosure timeline with you.

## What to look at

This is an Electron app that runs a local PTY and talks to GitHub. Areas of
particular interest:

- Renderer ↔ main IPC surface (`src/preload/preload.ts`, `src/main/`).
- Credential handling — the GitHub PAT is encrypted at rest via Electron
  `safeStorage` and is explicitly excluded from settings sync.
- The `shell.openExternal` URL allowlist and navigation lockdown.
- node-pty / terminal input handling.

## Threat-model history

Each development phase carries a self-red-team review under
[`docs/security-reviews/`](./docs/security-reviews/), documenting the Criticals
and Highs that were fixed and the Mediums that were deferred. These are a useful
starting point for understanding the app's security posture.

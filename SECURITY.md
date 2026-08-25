# Security Policy

## What this app touches

Coding Usage Dashboard is a local-only Windows client. It:

- Runs `ccusage` (and WSL `ccusage`) to read usage JSON you already have
- Reads local databases / session logs for ZCode, DSH, and Qoder
- Reads CLI credential files to query **your own** subscription quota
- Encrypts any pasted quota token with Windows DPAPI (`safeStorage`) before writing `quota-config.json` under Electron `userData`

It does not send usage or credentials to a first-party server. There is no account system and no telemetry.

## Please report

- Token / credential leakage into logs, renderer, screenshots, or IPC payloads
- Path traversal or unexpected process execution around WSL / `ccusage` invocation
- Anything that would upload local files or tokens off-machine

Please **do not** open a public issue for those. Use [GitHub Private Vulnerability Reporting](https://github.com/funzza/coding-usage-dashboard/security/advisories/new) if it is enabled, or email the maintainer listed on the GitHub profile.

## Out of scope

- SmartScreen warnings on the unsigned NSIS installer
- Upstream CLI / undocumented quota endpoint changes (the app is supposed to degrade)
- Data already stored in plaintext by the CLIs this app reads (`~/.codex/auth.json`, etc.)

# Contributing

This is a **Windows-only** Electron app. macOS / Linux builds are not supported: the main process uses `where.exe`, DPAPI (`safeStorage`), HKCU auto-launch, and WSL UNC paths.

## Prerequisites

- Windows 10 or 11
- Node.js 20+
- npm
- Optional: a global `ccusage` install, and/or WSL with ccusage, if you want the integration tests to run instead of skip

```powershell
npm install
npm run dev
npm test
npm run typecheck
```

## Layout

| Path | Role |
| --- | --- |
| `src/main/` | Electron main: ccusage / WSL / ZCode / DSH / Qoder adapters, quota collectors, tray, float window |
| `src/preload/` | IPC bridge. Renderer never talks to Node APIs directly |
| `src/renderer/` | Vue 3 UI |
| `src/shared/` | Normalized usage model and pure helpers shared by main + renderer |
| `fixtures/` | Anonymized ccusage JSON used by unit tests |
| `scripts/` | Screenshot / debug helpers. Not part of the packaged app |

Adapters must stay **fail-soft**: a missing or upgraded upstream format is a `skipped` / `absent` source status, never a thrown error that blocks the snapshot.

Quota tokens stay in the main process. IPC views must not include `tokenEnc` or plaintext.

Adding an agent, a quota provider, or a skin — including a prompt you can paste into an AI — is documented in the README sections **它是怎么做的 / How it is built** and **拿这份代码继续让 AI 开发 / Keep building this with an AI**. Known chart and coverage limitations live in **已知问题与局限 / Known issues and limitations**; do not "fix" the Today bar vs daily-total mismatch without changing `sessionsHourlyBuckets` on purpose.

## Pull requests

- Keep the change scoped. Match existing comment style (short, factual, Chinese is fine in code comments)
- `npm test` and `npm run typecheck` should pass
- Do not commit `dist/`, `out/`, `screenshots/`, `.zcode/`, or local research notes under `docs/quota-research-*`
- Product screenshots that belong in the README go in `docs/images/`
- The packaged app is Windows NSIS only; do not add mac/linux electron-builder targets without a real port of the native bits

## Release (maintainers)

1. Bump `version` in `package.json`
2. Update `CHANGELOG.md`
3. Merge to `main`
4. `git tag vX.Y.Z && git push origin vX.Y.Z`
5. The [release workflow](.github/workflows/release.yml) builds the installer and opens a **draft** GitHub Release
6. Check the draft, then publish it

Unsigned installers will trip SmartScreen. Code signing is intentionally out of scope until a certificate exists.

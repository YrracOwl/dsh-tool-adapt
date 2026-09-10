# dsh-tool-adapt Maintenance Guide

## Purpose

Adaptation layer for non-DeepSeek model families. Host logic modifies tool schemas/calls and prompt assembly; Client logic provides a status pill and official Settings card.

## Key Files

- `lib/index.js`: pipeline listeners, dead-state escalation guard, conventions injection, loop fuse, settings/RPC surface.
- `lib/config.js`: defaults, normalization, persisted configuration contract.
- `lib/client.js`: `__ModuleLoader__` Web bundle, composer pill, drag-to-corner anchor, Settings card.
- `cordis.patch.yml`: mounts `tool-adapt` and preserves the legacy config path for migration.
- `test/config.test.mjs`, `test/client-source.test.mjs`: config and structural UI/lifecycle guards.

## Non-Negotiable Invariants

- One predicate (`escalationDeadState(session)`) owns the decision that escalation is impossible.
- In dead states, remove `sandbox_permissions`/`justification` from model-facing schemas and strip stale arguments at execution. Do not deny with another error that creates a loop.
- L2 conventions are model-family gated; DeepSeek models are excluded by default.
- L0 fuse counts consecutive failures and must reset correctly after success.
- Settings are authoritative when the Host settings Service is available. Legacy JSON migrates only when the settings user layer is empty and remains for rollback.
- Compatibility RPC remains loopback/same-origin fenced with an 8 KiB body limit.
- The pill mounts under `[data-composer-seat]`, uses normal `z-index:1`, snaps to four corners, and stores only its anchor in `dsh.toolAdapt.anchor`. It stays hidden until `ui.pill` (Settings → Plugins → ADAPT「显示状态胶囊」, default `false`) is on; visibility follows the hot `/status` config, so never mount the root unconditionally.
- Never return the pill to `document.body`, extreme z-index, free-form pixel persistence, or a flip-button UI.

## Validation

```powershell
npm test
node --check lib/index.js
node --check lib/client.js
node --check lib/config.js
npm pack --dry-run
```

Then reconcile with `dsh plugin --profile web add .` and verify Settings → Plugins plus the composer pill on the real `3080` GUI. Exercise at least one full-access/approval-never session and one normal approval-capable session when guard behavior changes.

## Pitfalls

- UI status can look healthy while Host listeners are missing; verify both bundle halves.
- Settings writes are hot and affect the next prompt/tool boundary, not an already assembled request.
- Do not infer permission state from prompt text; use the session fields consumed by the canonical predicate.
- DSH overlays must cover the pill. A high z-index is a regression, not a fix.

## Documentation

- `README.md` is the only user-facing install surface: keep its recommended `dsh plugin --profile web add dsh-tool-adapt` command and the required DSH Web restart current whenever the install surface changes.

# dsh-tool-adapt Maintenance Guide

## Purpose

Adaptation layer for non-DeepSeek model families. Host logic modifies tool schemas/calls and prompt assembly; Client logic provides a status pill and official Settings card.

## Key Files

- `lib/index.js`: pipeline listeners, dead-state escalation guard, conventions injection, loop fuse, settings/RPC surface.
- `lib/config.js`: defaults, normalization, persisted configuration contract.
- `lib/client.js`: `__ModuleLoader__` Web bundle, composer pill, drag-to-corner anchor, Settings card on BOTH settings seats (legacy `settings.plugin.item` keyed `tool-adapt` for ≤ 0.1.5, rc.2 keyed row seat `plugins.row.config` keyed `ROW_CONFIG_KEY`).
- `cordis.patch.yml`: mounts `tool-adapt` and preserves the legacy config path for migration.
- `test/config.test.mjs`, `test/client-source.test.mjs`: config and structural UI/lifecycle guards.

## Non-Negotiable Invariants

- One predicate (`escalationDeadState(session)`) owns the decision that escalation is impossible.
- In dead states, remove `sandbox_permissions`/`justification` from model-facing schemas and strip stale arguments at execution. Do not deny with another error that creates a loop.
- L2 conventions are model-family gated; DeepSeek models are excluded by default.
- L0 fuse counts consecutive failures and must reset correctly after success.
- Settings are authoritative when the Host settings Service is available. Legacy JSON migrates only when the settings user layer is empty and remains for rollback.
- Settings reach the Host two ways. ≤ 0.1.5 registers the `tool-adapt` namespace with `ctx.settings.register(...)`. ≥ 0.1.7 has no `register`: the namespace IS the entry's exported `Config`, keyed by the loader entry id `tool-adapt`, whose editable leaves (`guard.enabled`, `l2.*`, `l0.*`, `ui.pill`, with `excludeModels` volatile as a whole array) carry `.volatile()` — applied by capability, since the 0.1.5 schemastery has no such method and an unconditional call would throw at module load. The effective-config accessor must unwrap those values (Symbol `Symbol.for('cosmokit.volatile.write')`, then `.get()`) on every read: the service updates them in place without remounting, so nothing may be cached at apply time. `ctx.settings.configure({ auto: false }, ctx.fiber)` declares that this plugin renders its own card rather than a generated page. The CARD seat is version-dependent as well: ≤ 0.1.5 declares `settings.plugin.item` (key `tool-adapt`), while 0.1.7-rc.2 REMOVED that slot and a bundle row's configuration seat is the keyed `plugins.row.config`, whose occupant key must equal `` `dsh-tool-adapt#tool-adapt` `` = `` `${package.json#name}#<row id in cordis.patch.yml>` `` — the official manager renders the row's configure control only while that exact key sits on its ledger, so a card left on one seat renders nowhere, silently. Register the rc.2 occupant as ONE options object (`{ name, key }`, the slots service reads `options.name`) from inside a non-gating `ctx.inject(['slots'], …)` callback that returns the registration disposer, render a one-liner alone for `view === 'summary'` and the existing card for `'page'`, and never read the host-owned optional `form` prop; `test/client-source.test.mjs` guards the seat, the key derivation and the summary branch.
- The same card is ALSO registered on the root-scope list seat `settings.section` (id `yotk-tool-adapt`, order `61`, label thunk `() => 'YOTK · ADAPT'` rendering the identity `YOTK · ADAPT`), which is what makes it a first-class page one click deep in 设置. That seat is additive and host-version dependent: it must be kept BESIDE the row seat (not instead of it), registered with the same non-gating `ctx.inject(['slots'], …)` shape whose callback returns the registration disposer, and it must render the SAME `SettingsCard` (one settings UI, one transport, one persistence path) — so a host that does not declare the seat simply never fires it and the plugin gains no new activation gate. Both single-card seats (the row seat's `view === 'page'` branch and this one) ask for `defaultOpen: true`, while the legacy `settings.plugin.item` list card keeps its collapsed default. `test/client-source.test.mjs` guards the nav identity, the no-transport registration plus its released disposer, and the shared component.
- `@deepseek-ai/schemastery` is a private `dependencies` entry whose FLOOR must be ≥ 3.18.4 (`^3.18.4`), because the profile hoists an older line (3.18.2) that satisfies a lower floor, and an entry whose Config exposes no volatile field is dropped from `SettingsForms.describe()` — the settings card then renders nothing with no error. `test/client-source.test.mjs` parses the declared range and fails when its minimum drops below 3.18.4.
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

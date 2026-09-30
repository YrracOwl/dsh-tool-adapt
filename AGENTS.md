# dsh-tool-adapt Maintenance Guide

## Purpose

Adaptation layer for non-DeepSeek model families. Host logic modifies tool schemas/calls and prompt assembly; Client logic provides a status pill and official Settings card.

## Key Files

- `lib/index.js`: pipeline listeners, dead-state escalation guard, conventions injection, loop fuse, gateway-compat diagnosis, settings/RPC surface.
- `lib/config.js`: defaults, normalization, persisted configuration contract.
- `lib/client.js`: `__ModuleLoader__` Web bundle, composer pill, drag-to-corner anchor, Settings card on BOTH settings seats (legacy `settings.plugin.item` keyed `tool-adapt` for ≤ 0.1.5, rc.2 keyed row seat `plugins.row.config` keyed `ROW_CONFIG_KEY`).
- `cordis.patch.yml`: mounts `tool-adapt` and preserves the legacy config path for migration.
- `test/config.test.mjs`, `test/client-source.test.mjs`: config and structural UI/lifecycle guards.
- `test/gateway-detect.test.mjs`: gateway-compat diagnosis and repair — the pure helpers plus the observe-only / single-write-path wiring guards.
- `test/surface-overflow.test.mjs`: the Command Code surface-overflow relabel — pure helpers, the borrow/restore contract, and a replica of cordis's waterfall that proves `prepend` is what makes the recovery reach `dsh-compaction-basic`.

## Non-Negotiable Invariants

- One predicate (`escalationDeadState(session)`) owns the decision that escalation is impossible.
- In dead states, remove `sandbox_permissions`/`justification` from model-facing schemas and strip stale arguments at execution. Do not deny with another error that creates a loop.
- L2 conventions are model-family gated; DeepSeek models are excluded by default.
- L0 fuse counts consecutive failures and must reset correctly after success.
- Settings are authoritative when the Host settings Service is available. Legacy JSON migrates only when the settings user layer is empty and remains for rollback.
- Settings reach the Host two ways. ≤ 0.1.5 registers the `tool-adapt` namespace with `ctx.settings.register(...)`. ≥ 0.1.7 has no `register`: the namespace IS the entry's exported `Config`, keyed by the loader entry id `tool-adapt`, whose editable leaves (`guard.enabled`, `l2.*`, `l0.*`, `ui.pill`, `gateway.autoRepair`, `surfaceOverflow.autoRelabel`, with `excludeModels` volatile as a whole array) carry `.volatile()` — applied by capability, since the 0.1.5 schemastery has no such method and an unconditional call would throw at module load. The effective-config accessor must unwrap those values (Symbol `Symbol.for('cosmokit.volatile.write')`, then `.get()`) on every read: the service updates them in place without remounting, so nothing may be cached at apply time. `ctx.settings.configure({ auto: false }, ctx.fiber)` declares that this plugin renders its own card rather than a generated page. The CARD seat is version-dependent as well: ≤ 0.1.5 declares `settings.plugin.item` (key `tool-adapt`), while 0.1.7-rc.2 REMOVED that slot and a bundle row's configuration seat is the keyed `plugins.row.config`, whose occupant key must equal `` `dsh-tool-adapt#tool-adapt` `` = `` `${package.json#name}#<row id in cordis.patch.yml>` `` — the official manager renders the row's configure control only while that exact key sits on its ledger, so a card left on one seat renders nowhere, silently. Register the rc.2 occupant as ONE options object (`{ name, key }`, the slots service reads `options.name`) from inside a non-gating `ctx.inject(['slots'], …)` callback that returns the registration disposer, render a one-liner alone for `view === 'summary'` and the existing card for `'page'`, and never read the host-owned optional `form` prop; `test/client-source.test.mjs` guards the seat, the key derivation and the summary branch.
- The same card is ALSO registered on the root-scope list seat `settings.section` (id `yotk-tool-adapt`, order `61`, label thunk `() => 'YOTK · ADAPT'` rendering the identity `YOTK · ADAPT`), which is what makes it a first-class page one click deep in 设置. That seat is additive and host-version dependent: it must be kept BESIDE the row seat (not instead of it), registered with the same non-gating `ctx.inject(['slots'], …)` shape whose callback returns the registration disposer, and it must render the SAME `SettingsCard` (one settings UI, one transport, one persistence path) — so a host that does not declare the seat simply never fires it and the plugin gains no new activation gate. Both single-card seats (the row seat's `view === 'page'` branch and this one) ask for `defaultOpen: true`, while the legacy `settings.plugin.item` list card keeps its collapsed default. `test/client-source.test.mjs` guards the nav identity, the no-transport registration plus its released disposer, and the shared component.
- `@deepseek-ai/schemastery` is a private `dependencies` entry whose FLOOR must be ≥ 3.18.4 (`^3.18.4`), because the profile hoists an older line (3.18.2) that satisfies a lower floor, and an entry whose Config exposes no volatile field is dropped from `SettingsForms.describe()` — the settings card then renders nothing with no error. `test/client-source.test.mjs` parses the declared range and fails when its minimum drops below 3.18.4.
- Compatibility RPC remains loopback/same-origin fenced with an 8 KiB body limit.
- The pill mounts under `[data-composer-seat]`, uses normal `z-index:1`, snaps to four corners, and stores only its anchor in `dsh.toolAdapt.anchor`. It stays hidden until `ui.pill` (Settings → Plugins → ADAPT「显示状态胶囊」, default `false`) is on; visibility follows the hot `/status` config, so never mount the root unconditionally.
- Never return the pill to `document.body`, extreme z-index, free-form pixel persistence, or a flip-button UI.
- Gateway compat has ONE diagnosis and ONE write, and they are separate on purpose. The `developer` instruction role is chosen inside pi-ai from `model.compat`, and NO contract a plugin sees carries `compat` (`GenerateOptions` from `llm/stream`, `LlmCallConfig` from `agent/request`), while `dsh-llm-pi-ai` owns the model objects and its `registerAdapter` is all-or-nothing — so a request-time rewrite has no seam and would mean monkey-patching another bundle's internals. Rules: (a) neither `agent/request-error` listener DECIDES: the observer returns the downstream action, and the surface-overflow relabel listener likewise returns whatever the chain decided — never a `{ kind: 'retry' }` of its own — and the only configuration write in this package is `configEditor.edit(entry, …)` inside `applyGatewayFix`; (b) that write's whole effect is the pure `withDeveloperRolePinned` (one key: the route's `compat.supportsDeveloperRole`), and it runs only from the explicit `POST /api/tool-adapt/gateway-fix` route (fenced exactly like `/set`) or from the opt-in `gateway.autoRepair === true` (default `false`, at most once per route per process via `attempted`); (c) it refuses a route that already pins the role or whose `api` is not `openai-completions`; (d) it never reports a failure the harness already classified as `CONTEXT_WINDOW_EXCEEDED` — that one's fix is a smaller route `contextWindow`, and blaming the role points the wrong way. The real 422 shape carries NO `failure.status` (`dsh-llm-pi-ai`'s `mapStopReason` sets `message` and `code` only), so the detector must match the provider TEXT; keying it on `status === 422` silently never fires. `test/gateway-detect.test.mjs` guards all of this.
- The ONE in-flight mutation this package performs is the surface-overflow relabel, and every clause of it is load-bearing. `api.commandcode.ai` — the baseURL behind BOTH the `commandcode` and `goat-163` routes — refuses a whole request once its internal path-expansion budget is spent: measured live 2026-09-30, 512 candidates at ~2 per tool call, so 200 tool calls pass and 300 fail, while text paths, images, `max_tokens` and body size are irrelevant. Since DSH replays the whole surface each turn, one crossing kills every later turn. `dsh-compaction-basic` already recovers exactly this shape when the failure is coded `CONTEXT_WINDOW_EXCEEDED` (its overflow path compacts with `retainTokens: 0` and returns `{ kind: 'retry' }`, which makes `dsh-agent-loop` re-issue the step), and pi-ai cannot classify the wording — it names a gateway budget, not the model window. So this half registers a SECOND `agent/request-error` listener with `{ prepend: true }` (`cordis`'s `register()` unshifts; `dsh-compaction-basic` appends, so prepending is what puts the relabel in front of it), relabels `failure.code` on the SHARED waterfall payload for the duration of the chain, and **restores the original code on every exit** — retry, decline and throw alike — so the failure the loop finally acts on is still described as the gateway sent it. Guard rules: match the exact vendor sentence AND the adapter's own `INVALID_REQUEST` (never a status; requiring that code makes the guard stop firing the day the adapter learns the pattern itself), swallow a frozen/accessor-only failure back into a plain `next()`, gate on the live `surfaceOverflow.autoRelabel` (default ON — the rescued failure is otherwise fatal and nothing is written), and never let a throwing logger break the chain. `test/surface-overflow.test.mjs` guards the helpers, the borrow/restore contract, the waterfall ordering replica and the wiring.

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

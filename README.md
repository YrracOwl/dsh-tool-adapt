# dsh-tool-adapt

## English

**Portable settings transport** — the plugin now resolves its settings scope on both the `settingsScope` (≤ 0.1.5) and `configForms` (≥ 0.1.7-rc.1) hosts, so the Settings card and pill switch keep working across the rename.

A compatibility and safety adaptation layer for non-DeepSeek model families in DeepSeek Harness Web. It guards dead escalation states, injects model-family conventions, fuses repeated failures, and provides a lifecycle-safe Settings card and optional composer pill. Its DSH 0.1.2+ `remote.settings` path falls back to the legacy connection API on older RC hosts.

## 中文

面向 DeepSeek Harness Web 非 DeepSeek 模型族的兼容与安全适配层：处理不可升级权限状态、注入模型族惯例、熔断连续失败，并提供生命周期安全的设置卡片与可选输入框胶囊。DSH 0.1.2+ 使用 `remote.settings`，旧版 RC 自动回退到 connection API。

Adaptation layer for foreign models in DSH web — official bundle form
(host pipeline wiring + `__ModuleLoader__` client, no tapIndex injection).

ONE RULE: in a "dead" session (sandbox already `danger-full-access`, or
approval policy `never`) the model-facing tool schemas no longer offer
`sandbox_permissions` / `justification` (remove), and calls that still carry
them run with the fields stripped (strip) — no error, no loop.

- **guard** — remove + strip, derived from one `escalationDeadState(session)`
  predicate.
- **L2** — DSH tool-call conventions section, gated by model family (default
  excludes `deepseek-*`).
- **L0** — consecutive-failure loop fuse: remind after N failures, optional
  veto.
- **gateway compat** — passive diagnosis for the `developer`-role rejection.
  DSH lets pi-ai pick the system-message role at dispatch
  (`model.reasoning && compat.supportsDeveloperRole` → `developer`), and pi-ai
  auto-detects only the vendors its own catalog ships — so an unknown gateway
  receives `developer` and, if it rejects that shape, answers HTTP 422
  `invalid_request_error`. Because the history is fixed, every retry rebuilds
  the same rejected request and the session wedges permanently. This half
  observes `agent/request-error`, recognizes that signature (including the real
  adapter shape, where the numeric 422 lives in the message and never in
  `failure.status`), and names the exact one-line fix:

  ```yaml
  providers:
    <route>:
      compat:
        supportsDeveloperRole: false
  ```

  It reports rather than acts on its own: the finding surfaces on
  `GET /api/tool-adapt/status` (`gateway.summary`, `gateway.findings[].fix`) and
  in the ADAPT card, which also offers **「应用修复」** — a one-click write of that
  single key through the host's own config editor (`configEditor.edit`, which
  validates and reconciles it on the normal Loader path). The unattended path is
  the `网关 compat 自动修复` switch (`gateway.autoRepair`, default **off**), which
  runs at most once per route per process. Either way the change is exactly one
  key on one already-declared route: it refuses a route that already pins the
  role, or one whose `api` is not `openai-completions`. A failure the harness
  already classified as `CONTEXT_WINDOW_EXCEEDED` is deliberately not reported:
  that is a genuine overflow whose fix is a smaller route `contextWindow`, not a
  role pin.

Config is hot. When Host `ctx.settings` is available the plugin registers the
`tool-adapt` namespace and an official-style expandable Settings Card (same
disclosure chrome as Shell / Agent loop) becomes the writable source of truth.
That card registers on both settings seats DSH has used: the legacy
`settings.plugin.item` (key `tool-adapt`) on ≤ 0.1.5, and the keyed row seat
`plugins.row.config` (key `dsh-tool-adapt#tool-adapt`, i.e.
`<package name>#<row id>`) on ≥ 0.1.7-rc.2, where the **插件** panel (the first
sidebar panel icon) shows a
configure control for the row only while that exact key is registered.
The same card is also registered, additively and never as a gate, on the
root-scope `settings.section` list seat — identity `YOTK · ADAPT`, id
`yotk-tool-adapt`, order `61` — so on a host that declares that seat it is a
first-class page one click deep in 设置.
`@deepseek-ai/schemastery` is a private `dependencies` entry whose floor must be
≥ 3.18.4 (`^3.18.4`): the profile hoists an older line (3.18.2) that satisfies a
lower floor, and an entry whose Config exposes no volatile field is dropped from
`SettingsForms.describe()` — the card then renders nothing with no error.
A legacy `plugins/tool-adapt.config.json` is migrated once if the
settings user layer is empty; the old file is kept for rollback. The
`GET/POST /api/tool-adapt/status|set` routes remain as a compatibility
surface (loopback + same-origin fenced, 8 KiB body cap). The pill snaps to
one of the chat input's four corners (drag to switch); the anchor is
remembered in `localStorage` (`dsh.toolAdapt.anchor`). The pill mounts inside
the composer seat (same stacking level as the input box) at a normal
`z-index`, so DSH web popups (modal / menu / toast) can cover it. The pill
itself is status-only — edit the full form in the **插件** panel (on ≤ 0.1.5:
Settings → Plugins). The
pill is hidden by DEFAULT: the「显示状态胶囊」switch (`ui.pill`, default
`false`) at the top of the ADAPT card owns its visibility, and the pill
follows the hot `/status` config within one poll (or instantly after a save
in the same tab).

## Install

```powershell
dsh plugin --profile web add dsh-tool-adapt
```

Restart the existing DSH Web process afterwards: the Host scans the browser plugin roster at startup, so the Settings card and the optional pill appear only after that restart. Then open the ADAPT card — on ≤ 0.1.5 it is a card in **Settings → Plugins**; on ≥ 0.1.7-rc.2 open the **插件** panel (the first sidebar panel icon), find the `dsh-tool-adapt` bundle, and use the `tool-adapt` row's configure control; the「显示状态胶囊」switch (`ui.pill`, default `false`) owns the composer pill's visibility.

Local development, from this package directory:

```powershell
dsh plugin --profile web add .
```

Either form records the package in the profile's `dsh.profile.bundles`, which is what mounts the Host half and serves the client bundle.

## Config

The mounting row (in this package's `cordis.patch.yml`) passes
`config.configFile` — the JSON config path, resolved against the profile
working directory (default `<cwd>/plugins/tool-adapt.config.json`, keeping the
legacy location so existing configs migrate unchanged).

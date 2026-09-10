# dsh-tool-adapt

## English

**Current release: 0.2.6** — Remote settings are capability-detected and optional, so older DSH RC hosts continue to start the plugin. This release adds a documented install path: `dsh plugin --profile web add dsh-tool-adapt`.

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

Config is hot. When Host `ctx.settings` is available the plugin registers the
`tool-adapt` namespace and an official-style expandable Settings Card
(`settings.plugin.item` / key `tool-adapt`, same disclosure chrome as
Shell / Agent loop) becomes the writable source of truth. A legacy `plugins/tool-adapt.config.json` is migrated once if the
settings user layer is empty; the old file is kept for rollback. The
`GET/POST /api/tool-adapt/status|set` routes remain as a compatibility
surface (loopback + same-origin fenced, 8 KiB body cap). The pill snaps to
one of the chat input's four corners (drag to switch); the anchor is
remembered in `localStorage` (`dsh.toolAdapt.anchor`). The pill mounts inside
the composer seat (same stacking level as the input box) at a normal
`z-index`, so DSH web popups (modal / menu / toast) can cover it. The pill
itself is status-only — edit the full form under Settings → Plugins. The
pill is hidden by DEFAULT: the「显示状态胶囊」switch (`ui.pill`, default
`false`) at the top of the ADAPT card owns its visibility, and the pill
follows the hot `/status` config within one poll (or instantly after a save
in the same tab).

## Install

```powershell
dsh plugin --profile web add dsh-tool-adapt
```

Restart the existing DSH Web process afterwards: the Host scans the browser plugin roster at startup, so the Settings card and the optional pill appear only after that restart. Then open **Settings → Plugins → ADAPT**; the「显示状态胶囊」switch (`ui.pill`, default `false`) owns the composer pill's visibility.

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

# dsh-tool-adapt

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

Add to the profile's `package.json` dependencies (`link:` for local dev) and
to `dsh.profile.bundles`, then `pnpm install` and restart `dsh web`.

## Config

The mounting row (in this package's `cordis.patch.yml`) passes
`config.configFile` — the JSON config path, resolved against the profile
working directory (default `<cwd>/plugins/tool-adapt.config.json`, keeping the
legacy location so existing configs migrate unchanged).

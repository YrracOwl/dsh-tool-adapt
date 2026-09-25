import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// ── Settings card (behavior unchanged) ───────────────────────────────────────

test('client registers an official-style expandable plugin card', () => {
  // 卡片必须在设置传输的子上下文上注册（sctx.slots），见 client.js 的 registerCard。
  assert.match(source, /sctx\.slots\.inject\('settings\.plugin\.item'/)
  assert.match(source, /key: NS/)
  assert.match(source, /function SettingsCard/)
  assert.match(source, /e\('li'/)
  assert.match(source, /dtaCard/)
  assert.match(source, /dtaPending/)
  assert.match(source, /未保存/)
  assert.match(source, /放弃修改/)
  assert.match(source, /已覆盖/)
  assert.match(source, /恢复默认/)
  // NEITHER settings transport may appear in exports.inject: cordis treats every
  // inject name as a REQUIRED gate, so declaring the optional transport leaves the
  // plugin permanently pending and fails Web boot. The optional wait lives in
  // apply as ctx.inject([...], cb).
  assert.match(source, /exports\.inject = \['slots', 'remote', 'remote\.settings'\]/)
  assert.match(source, /function resolveSettingsScopeFrom\(ctx, namespace\)/)
  assert.match(source, /ctx\.inject\(\['settingsScope'\], registerCard\)/)
  assert.match(source, /ctx\.inject\(\['configForms'\], \(sctx\) => \{ if \(scope === undefined\) registerCard\(sctx\) \}\)/)
  assert.doesNotMatch(source, /exports\.inject = \[[^\]]*settingsScope/)
  assert.doesNotMatch(source, /exports\.inject = \[[^\]]*configForms/)
  assert.doesNotMatch(source, /ctx\.settingsScope\.bind/)
  assert.doesNotMatch(source, /exports\.inject = \['slots', 'settingsScope'\]/)
  assert.doesNotMatch(source, /exports\.inject = \['slots', 'settingsScope', 'connection'\]/)
})

test('card stages edits and writes through settings.mutate', () => {
  assert.match(source, /api\.settings\.mutate/)
  assert.match(source, /expectedRevision/)
  assert.match(source, /op: 'unset'/)
  assert.match(source, /op: 'set'/)
  assert.doesNotMatch(source, /CardForm/)
})

test('settings slot registration stays independent of seat waiting', () => {
  // The Settings Slot must be registered before the pill starts, so a slow or
  // absent composer seat can never delay or break「设置 → 插件」. The card now
  // registers on the settings-transport child context, and the pill receives a
  // scope GETTER (the transport is awaited non-blockingly).
  assert.ok(
    source.indexOf("sctx.slots.inject('settings.plugin.item'") < source.indexOf('ctx.effect(() => startPill(() => scope)'),
    'the card is registered before the pill starts',
  )
  // Both slot disposers are released through one combined disposer, so stop /
  // update / HMR leaves neither the card nor the overlay behind.
  assert.match(source, /return \(\) => \{ for \(const dispose of disposeSlots\)/)
})

// ── pill mounting: seat-only, no body fallback ──────────────────────────────

test('pill mounts only under the composer seat and waits for it', () => {
  assert.match(source, /ctx\.effect\(\(\) => startPill\(\(\) => scope\)/)
  assert.match(source, /function findSeat\(\)/)
  assert.match(source, /document\.querySelector\('\[data-composer-seat\]'\)/)
  assert.match(source, /function ensureMounted\(\)/)
  assert.match(source, /domObserver\.observe\(document\.documentElement/)
  assert.match(source, /if \(ensureMounted\(\)\) schedulePlace\(\)/)
  assert.match(source, /if \(dragging \|\| !root\.isConnected\) return/)
})

// ── visibility gate: ui.pill switch, default hidden ─────────────────────────

test('settings card owns the pill toggle field', () => {
  assert.match(source, /\{ path: \['ui', 'pill'\], kind: 'bool', label: '显示状态胶囊'/)
  assert.match(source, /默认关闭/)
})

test('pill is created hidden and gated on the polled status config', () => {
  assert.match(source, /display:none/)
  assert.match(source, /let pillVisible = false/)
  assert.match(source, /function applyVisibility\(\)/)
  assert.match(source, /function noteStatusConfig\(cfg\)/)
  assert.match(source, /cfg\.ui\.pill === true/)
  assert.match(source, /noteStatusConfig\(data\.config\)/)
  assert.match(source, /root\.style\.display = pillVisible \? '' : 'none'/)
})

test('settings save re-fetches status instantly and the subscription is disposed', () => {
  assert.match(source, /scope\.subscribe\(function \(\) \{ refresh\(\) \}\)/)
  assert.match(source, /track\(function \(\) \{ unsubscribe\(\) \}\)/)
})

test('no document.body or composer-card-parent mount fallback', () => {
  assert.doesNotMatch(source, /return\s+document\.body/)
  assert.doesNotMatch(source, /card\.parentElement/)
  assert.doesNotMatch(source, /\bmountTarget\b/)
})

// ── lifecycle: mounted flag, disposers, idempotent cleanup ──────────────────

test('mounted flag is lifecycle-bound: set on mount, reset on dispose', () => {
  assert.match(source, /let pillMounted = false/)
  assert.match(source, /pillMounted = true/)
  assert.match(source, /pillMounted = false/)
  assert.match(source, /function disposePill\(\)/)
  assert.match(source, /if \(disposed\) return/)
})

test('every pill resource has a disposer (observers, intervals, rAF, listeners)', () => {
  assert.match(source, /domObserver\.disconnect\(\)/)
  assert.match(source, /seatRo\.disconnect\(\)/)
  assert.match(source, /clearInterval\(ensureTimer\)/)
  assert.match(source, /clearInterval\(pollTimer\)/)
  assert.match(source, /cancelAnimationFrame\(rafId\)/)
  assert.match(source, /window\.removeEventListener\('scroll'/)
  assert.match(source, /window\.removeEventListener\('resize'/)
  assert.match(source, /document\.removeEventListener\('pointermove'/)
  assert.match(source, /document\.removeEventListener\('pointerup'/)
  assert.match(source, /cluster\.removeEventListener\('pointerdown'/)
  assert.match(source, /pill\.removeEventListener\('click'/)
  assert.match(source, /closeBtn\.removeEventListener\('click'/)
})

test('dispose removes the pill root (with its shadow DOM) and card style tag', () => {
  assert.match(source, /root\.parentNode\.removeChild\(root\)/)
  assert.match(source, /function removeCardStyles/)
  assert.match(source, /querySelector\('style\[data-plugin-css=/)
  assert.match(source, /attachShadow\(\{ mode: 'open' \}\)/)
})

// ── preserved behavior: stacking, storage, polling ──────────────────────────

test('pill keeps z-index 1, storage key, and 5s status polling semantics', () => {
  assert.match(source, /z-index:1/)
  assert.match(source, /ANCHOR_KEY = 'dsh\.toolAdapt\.anchor'/)
  assert.match(source, /POLL_MS = 5000/)
  assert.match(source, /setInterval\(pollPill, POLL_MS\)/)
})

// ── rc.2 settings seat: DSH 0.1.7-rc.2 REMOVED settings.plugin.item ──────────

test('the card also registers on the rc.2 row seat with the exact ledger key', () => {
  // The key IS the contract. The official plugin-manager renders a row's configure
  // control only while `rowConfigKey(pkg.name, row.rowId)` — `${pkg.name}#${rowId}`,
  // with the row id this package's own cordis.patch.yml declares — sits on the
  // `plugins.row.config` ledger. A card left on the removed seat renders nowhere
  // and reports nothing, so both the seat and the derivation are guarded here.
  const patch = fs.readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const rowIds = [...patch.matchAll(/^\s*- id: (\S+)\s*$/gm)].map((match) => match[1])
  assert.ok(rowIds.includes('tool-adapt'), `cordis.patch.yml must declare the tool-adapt row; saw ${rowIds.join(', ')}`)
  const expected = `${manifest.name}#tool-adapt`
  assert.equal(expected, 'dsh-tool-adapt#tool-adapt')
  assert.ok(
    source.includes(`const ROW_CONFIG_KEY = '${expected}'`),
    `client.js must carry the ledger key derived from package.json#name plus the patch row id (${expected})`,
  )
  assert.match(source, /sctx\.slots\.inject\('plugins\.row\.config'/)
  assert.match(source, /name: 'plugins\.row\.config'/)
  assert.match(source, /key: ROW_CONFIG_KEY/)
  assert.match(source, /props\.view === 'summary'/)
  assert.match(source, /ctx\.inject\(\['slots'\], registerRowConfig\)/)
  // The ≤ 0.1.5 seat stays declared: each slot fires only where the host declares it.
  assert.match(source, /settings\.plugin\.item/)
  // One read path, one write path: the host-owned optional `form` prop is not consumed.
  assert.doesNotMatch(source, /props\.form/)
})

// ── manifest: the schemastery FLOOR decides whether a settings page exists ───
//
// The profile root hoists the older 3.18.2 line, and `^3.18.1` is *satisfied* by
// that hoisted copy, so pnpm never materializes a private volatile-capable copy.
// `SettingsForms.describe()` drops any entry whose schema exposes no volatile
// field, so the settings page disappears with no error at all. This is a FLOOR
// rule, not a caret rule: the assertion below parses the declared range and
// compares its minimum version, so `>=3.18.4`, `^3.18.4` and any future higher
// floor pass while `^3.18.1` / `^3.18.2` / `^3.18.3` fail.
const VOLATILE_FLOOR = [3, 18, 4]

// Minimum stable version of a supported range, or null when the range is
// permissive / unparseable (a `*`-like range admits 3.18.2, so it is not a floor).
function minimumSatisfiableVersion(range) {
  if (typeof range !== 'string') return null
  const trimmed = range.trim()
  if (trimmed === '' || trimmed === '*' || trimmed === 'x' || trimmed === 'latest') return null
  if (trimmed.includes('||')) return null // an OR admits every branch's minimum
  let floor = null
  for (const token of trimmed.split(/\s+/).filter(Boolean)) {
    const m = /^(\^|~|>=|<=|>|<|=|v)?\s*(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(token)
    if (!m) return null
    const version = [Number(m[2]), Number(m[3]), Number(m[4])]
    const stable = m[5] === undefined
    const op = m[1] || '='
    // A caret/tilde/exact floor is the version itself; `>` sits just above it.
    const candidate = op === '>' ? [version[0], version[1], version[2] + 1] : version
    if (!stable) return null // a prerelease floor does not promise a stable `.volatile()`
    if (floor === null || compareVersions(candidate, floor) > 0) floor = candidate
  }
  return floor
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

test('declared @deepseek-ai/schemastery floor can never resolve a line without .volatile()', () => {
  // It must stay a private `dependencies` entry: a peer would be downgraded to
  // the profile's hoisted 3.18.2 copy, which is exactly the silent failure.
  assert.equal(
    Object.prototype.hasOwnProperty.call(manifest.dependencies ?? {}, '@deepseek-ai/schemastery'),
    true,
    '@deepseek-ai/schemastery must stay a private dependencies entry',
  )
  const range = manifest.dependencies['@deepseek-ai/schemastery']
  const floor = minimumSatisfiableVersion(range)
  assert.ok(floor !== null, `unparseable / permissive schemastery range: ${range}`)
  assert.ok(
    compareVersions(floor, VOLATILE_FLOOR) >= 0,
    `the declared floor must exclude schemastery lines without .volatile() (got ${range}, floor ${floor.join('.')})`,
  )
})

test('the floor guard itself rejects the volatile-less lines and accepts higher floors', () => {
  for (const range of ['^3.18.4', '>=3.18.4', '^3.18.5', '>3.18.3', '3.18.4', '^4.0.0']) {
    const floor = minimumSatisfiableVersion(range)
    assert.ok(floor, `${range} must parse to a floor`)
    assert.ok(compareVersions(floor, VOLATILE_FLOOR) >= 0, `${range} must pass the floor guard`)
  }
  for (const range of ['^3.18.1', '^3.18.2', '^3.18.3', '>=3.18.0', '~3.18.2', '3.18.2', '*', '^3.18.4-rc.1']) {
    const floor = minimumSatisfiableVersion(range)
    assert.ok(
      floor === null || compareVersions(floor, VOLATILE_FLOOR) < 0,
      `${range} must fail the floor guard`,
    )
  }
})
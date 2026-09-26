import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

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

// ── additive seat: the settings.section page (one click deep in 设置) ────────
//
// 0.1.7-rc.2 declares the root-scope LIST slot `settings.section` ("one settings
// page per list entry") beside the row seat. This registration is ADDITIVE and
// must never gate the plugin: the seat is host-version dependent and is awaited
// through the same NON-GATING `ctx.inject(['slots'], …)` shape the row seat uses,
// whose callback returns the registration disposer. The page renders the SAME
// SettingsCard the row seat renders for `view === 'page'` — one settings UI, one
// transport, one persistence path.

// ── bundle evaluation helpers (real exports, real occupants) ────────────────
//
// The bundle is a browser artifact, but it needs no DOM to LOAD: constructing it
// only calls __ModuleLoader__.load and require('react'), `startPill` bails out on
// a document-less host (typeof document === 'undefined'), and so does
// ensureCardStyles(). Evaluating it here gives the real `exports` and the real
// card component, which is stronger than matching source text.
// `reactHooks` lets a test hand the bundle a real-enough React: without it the
// fake has no hooks, which is all the registration tests need.
function loadClientPlugin(reactHooks = {}) {
  let spec = null
  const sandbox = {
    window: { __ModuleLoader__: { load(captured) { spec = captured } } },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'lib/client.js' })
  assert.ok(spec && typeof spec.factory === 'function', 'bundle must call window.__ModuleLoader__.load({ factory })')
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    ...reactHooks,
  }
  const plugin = spec.factory((id) => {
    if (id === 'react') return react
    throw new Error('unexpected require(' + id + ')')
  })
  return { plugin, react }
}

// One host shape: which optional services and which Slots are declared. `inject`
// fires only when every requested name is provided, exactly like cordis.
function makeCtx({ services = [], slots = [] } = {}) {
  const registered = []
  // Slot-registration disposers the plugin actually released, recorded by NAME,
  // so a test can prove the registration joined the plugin's disposal path
  // (register → slots.inject return value → disposeSlots → apply's disposer).
  const disposals = []
  const scope = {
    getSnapshot: () => ({ status: 'ready', writable: true, value: {}, base: {}, user: {}, revision: 1 }),
    subscribe: () => () => {},
  }
  const ctx = {
    get(name) {
      if (name === 'settingsScope' && services.includes('settingsScope')) return { bind: () => scope }
      if (name === 'configForms' && services.includes('configForms')) return { get: () => scope }
      return undefined
    },
    inject(names, cb) {
      const list = Array.isArray(names) ? names : [names]
      if (list.every((name) => name === 'slots' || services.includes(name))) cb(ctx)
    },
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    slots: {
      inject(slot, cb) {
        if (!slots.includes(slot)) return () => {}
        const dispose = cb()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      register(options, component) {
        registered.push({ options, component })
        return () => { disposals.push(options.name) }
      },
    },
  }
  return { ctx, registered, disposals }
}

test('additive settings.section seat carries the exact nav identity', () => {
  assert.match(source, /const registerSettingsSection = \(sctx\) => \{/)
  assert.match(source, /sctx\.slots\.inject\('settings\.section', \(\) => sctx\.slots\.register\(\{/)
  assert.match(source, /name: 'settings\.section'/)
  assert.match(source, /id: 'yotk-tool-adapt'/)
  assert.match(source, /order: 61/)
  // label is a THUNK: the shell re-reads it on every projection instead of
  // caching registrant-localized text
  assert.match(source, /label: \(\) => 'YOTK · ADAPT'/)
  // registered from inside the non-gating slots wait, and the disposer the
  // callback returns joins the plugin's disposal path
  assert.match(source, /ctx\.inject\(\['slots'\], registerSettingsSection\)/)
  assert.match(source, /disposeSlots\.push\(sctx\.slots\.inject\('settings\.section'/)
  // the seat declares exactly { id, order, label } — no invented contract keys
  assert.doesNotMatch(source, /name: 'settings\.section',\s*\n\s*locale:/)
})

test('settings.section fires without any settings transport and never gates', () => {
  const { plugin } = loadClientPlugin()
  // A host with the two card seats but NO settings transport at all: the seat
  // registration must still fire (non-gating), exactly like the row seat.
  const { ctx, registered, disposals } = makeCtx({
    services: [],
    slots: ['settings.section', 'plugins.row.config'],
  })
  const dispose = plugin.apply(ctx)
  const section = registered.find((item) => item.options.name === 'settings.section')
  assert.ok(section, 'the settings.section occupant must register where the seat is declared')
  assert.deepEqual(Object.keys(section.options).sort(), ['id', 'label', 'name', 'order'])
  assert.equal(section.options.id, 'yotk-tool-adapt')
  assert.equal(section.options.order, 61)
  assert.equal(typeof section.options.label, 'function')
  assert.equal(section.options.label(), 'YOTK · ADAPT')
  // BOTH seat registrations are owned by the plugin: each callback pushes the
  // disposer its `slots.inject` returned onto disposeSlots, so apply's own
  // disposer releases every seat this host declared — no seat may ride a separate
  // disposal path (the row seat used to hand its disposer back to ctx.inject).
  assert.deepEqual(disposals, [], 'nothing is released before the plugin is disposed')
  dispose()
  assert.deepEqual(disposals, ['plugins.row.config', 'settings.section'])

  // A host that does not declare the seat: nothing registers there and apply
  // still succeeds, so the seat can never gate activation.
  const absent = makeCtx({ services: [], slots: [] })
  assert.equal(typeof plugin.apply(absent.ctx), 'function')
  assert.deepEqual(absent.registered, [])
})

// The card's disclosure default: expanded where the card renders ALONE — the row
// seat's `view === 'page'` branch and the additive `settings.section` page — while
// the legacy list seat keeps its collapsed default. The hooks below are a minimal
// host that keeps one state slot per useState call across render passes, so
// `header.onClick` followed by a re-render IS the user's click: no source-text
// matching is involved.
function createHookHost() {
  let state = []
  let cursor = 0
  return {
    hooks: {
      useState(initial) {
        const index = cursor++
        if (!(index in state)) state[index] = initial
        const set = (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }
        return [state[index], set]
      },
      useEffect() { cursor++; return undefined },
    },
    // a FRESH mount: React would own new state slots for a new card instance
    mount() { state = []; cursor = 0 },
    // one render pass: hook slots are addressed from 0 again, state survives
    render(component, props) { cursor = 0; return component(props) },
  }
}

test('the settings.section page renders the same card component as the row page', () => {
  const host = createHookHost()
  const { plugin } = loadClientPlugin(host.hooks)
  const { ctx, registered } = makeCtx({
    services: ['configForms'],
    slots: ['settings.section', 'plugins.row.config'],
  })
  plugin.apply(ctx)
  const section = registered.find((item) => item.options.name === 'settings.section')
  const row = registered.find((item) => item.options.name === 'plugins.row.config')
  assert.ok(section, 'expected a settings.section occupant')
  assert.ok(row, 'expected a plugins.row.config occupant')

  // The section owner shares `close` and nothing else ...
  const sectionPage = section.component({ close: () => {} })
  const rowPage = row.component({ view: 'page' })
  // ... and it renders the SAME component the row seat renders for view=page:
  // one settings UI, one read path, one write path.
  assert.equal(typeof sectionPage.type, 'function')
  assert.equal(sectionPage.type, rowPage.type)
  assert.equal(sectionPage.props.scope, rowPage.props.scope)
  // neither `close` nor the host-owned optional `form` prop is consumed; the only
  // extra prop is the disclosure default, because each of these two seats puts
  // this ONE card alone on a page of its own, so its body must start expanded
  // (pinned behaviourally below) while the header still folds it back up.
  assert.deepEqual(Object.keys(sectionPage.props).sort(), ['api', 'defaultOpen', 'scope'])
  const passedForm = section.component({ close: () => {}, form: { state: {}, mutate() {} } })
  assert.equal(passedForm.type, sectionPage.type)
  assert.equal(passedForm.props.scope, sectionPage.props.scope)
  // a one-liner is still what the row seat's summary branch renders
  assert.equal(row.component({ view: 'summary' }).type, 'span')

  for (const [seat, element] of [
    ['settings.section', sectionPage],
    ["plugins.row.config view='page'", rowPage],
  ]) {
    // the seat asks for the expanded disclosure ...
    assert.equal(element.props.defaultOpen, true, `${seat} must ask for an expanded card`)

    host.mount()
    const expanded = host.render(element.type, element.props)
    // ... and the first render shows it open: body present, chevron flipped,
    // aria-expanded true
    assert.equal(expanded.props.className, 'dtaCard dtaCardOpen', `${seat} must start expanded`)
    assert.equal(expanded.children[0].props['aria-expanded'], true)
    assert.equal(expanded.children[1].props.className, 'dtaBody')

    // the manual toggle still folds it back up
    expanded.children[0].props.onClick()
    const collapsed = host.render(element.type, element.props)
    assert.equal(collapsed.props.className, 'dtaCard', `${seat} must collapse on the header click`)
    assert.equal(collapsed.children[0].props['aria-expanded'], false)
    assert.equal(collapsed.children[1], null)

    // ... and expands it again, so the disclosure stays a two-way toggle
    collapsed.children[0].props.onClick()
    const reopened = host.render(element.type, element.props)
    assert.equal(reopened.props.className, 'dtaCard dtaCardOpen')
    assert.equal(reopened.children[1].props.className, 'dtaBody')
  }

  // the legacy ≤ 0.1.5 seat is untouched: its card still sits in the Plugins list
  // of many cards, which is the reason the collapsed default existed, so it asks
  // for nothing and starts collapsed there.
  const { ctx: legacyCtx, registered: legacyRegistered } = makeCtx({
    services: ['settingsScope'],
    slots: ['settings.plugin.item'],
  })
  loadClientPlugin(host.hooks).plugin.apply(legacyCtx)
  const legacy = legacyRegistered[0]
  assert.equal(legacy.options.name, 'settings.plugin.item')
  const legacyElement = legacy.component()
  assert.equal(legacyElement.props.defaultOpen, undefined, 'the legacy list seat asks for nothing')
  host.mount()
  const legacyCard = host.render(legacyElement.type, legacyElement.props)
  assert.equal(legacyCard.props.className, 'dtaCard')
  assert.equal(legacyCard.children[1], null)
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
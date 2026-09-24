import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import Schema from '@deepseek-ai/schemastery'
import {
  DEFAULT_CONFIG,
  SETTINGS_NS,
  cloneConfig,
  formatExcludeModels,
  parseExcludeModels,
  userSectionEmpty,
  validateConfig,
} from '../lib/config.js'
import { apply, inject, name } from '../lib/index.js'

const indexSource = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')

// ── declarative host (DSH ≥ 0.1.7): entry Config + volatile capability ──────
//
// The declarative settings service keys one namespace per loader entry id and
// exposes ONLY fields marked `.volatile()`; `volatile()` itself exists only from
// schemastery 3.18.4, while this package's ≤ 0.1.5 line resolves 3.18.2 where it
// is `undefined` and calling it throws. These guards pin the portable shape.

test('entry Config is declared on the exported apply (static Config)', () => {
  // The loader unwraps the module namespace: with no `default` export it keeps the
  // namespace, so the plugin VALUE is the same object that carries `apply`.
  assert.equal(typeof apply.Config, 'function')
  assert.equal(apply.Config.type, 'object')
  const liveKeys = ['guard', 'l2', 'l0', 'ui']
  for (const key of liveKeys) assert.ok(key in apply.Config.dict, 'Config has ' + key)
  // The row field must be part of the entry schema too, or the mounting row's
  // `configFile` would not survive parsing on the declarative host.
  assert.ok('configFile' in apply.Config.dict, 'Config has configFile')
  // Same nesting the client card writes through (FIELDS paths in lib/client.js).
  assert.ok('enabled' in apply.Config.dict.guard.dict)
  for (const key of ['enabled', 'excludeModels', 'block']) assert.ok(key in apply.Config.dict.l2.dict, 'l2.' + key)
  for (const key of ['enabled', 'remindAfter', 'vetoAfter', 'reminderText', 'vetoText']) assert.ok(key in apply.Config.dict.l0.dict, 'l0.' + key)
  assert.ok('pill' in apply.Config.dict.ui.dict)
})

test('Config leaves carry the same defaults as the shipped config', () => {
  const meta = (section, field) => apply.Config.dict[section].dict[field].meta
  assert.equal(meta('guard', 'enabled').default, DEFAULT_CONFIG.guard.enabled)
  assert.equal(meta('l2', 'enabled').default, DEFAULT_CONFIG.l2.enabled)
  assert.deepEqual(meta('l2', 'excludeModels').default, DEFAULT_CONFIG.l2.excludeModels)
  assert.equal(meta('l2', 'block').default, DEFAULT_CONFIG.l2.block)
  assert.equal(meta('l0', 'enabled').default, DEFAULT_CONFIG.l0.enabled)
  assert.equal(meta('l0', 'remindAfter').default, DEFAULT_CONFIG.l0.remindAfter)
  assert.equal(meta('l0', 'vetoAfter').default, DEFAULT_CONFIG.l0.vetoAfter)
  assert.equal(meta('l0', 'reminderText').default, DEFAULT_CONFIG.l0.reminderText)
  assert.equal(meta('l0', 'vetoText').default, DEFAULT_CONFIG.l0.vetoText)
  assert.equal(meta('ui', 'pill').default, DEFAULT_CONFIG.ui.pill)
  assert.equal(apply.Config.dict.configFile.meta.default, 'plugins/tool-adapt.config.json')
})

test('volatile is applied capability-detected, never unconditionally', () => {
  // One expression must serve schemastery 3.18.2 (no `volatile`) and 3.18.4.
  assert.match(indexSource, /const volatile = \(schema\) => \(typeof schema\?\.volatile === 'function' \? schema\.volatile\(\) : schema\)/)
  // Guard against reintroducing an unguarded call (which throws on ≤ 0.1.5).
  assert.doesNotMatch(indexSource, /Schema\.[A-Za-z]+\([^)]*\)\s*\.volatile\(\)/)
  assert.doesNotMatch(indexSource, /\.extra\('volatile'/)

  const marked = []
  const walk = (schema, path) => {
    if (!schema) return
    if (schema.meta && schema.meta.volatile === true) marked.push(path)
    for (const key of Object.keys(schema.dict || {})) walk(schema.dict[key], path ? path + '.' + key : key)
    if (Array.isArray(schema.list)) schema.list.forEach((s, i) => walk(s, path + '#' + i))
    if (schema.inner) walk(schema.inner, path + '.*')
  }
  walk(apply.Config, '')

  const hasVolatileApi = typeof Schema.prototype.volatile === 'function'
  if (hasVolatileApi) {
    // ≥ 0.1.7 corridor (schemastery ≥ 3.18.4): the editable leaves must be marked
    // or the entry gets no settings form at all, and `excludeModels` is volatile
    // as a WHOLE array.
    for (const leaf of [
      'guard.enabled',
      'l2.enabled',
      'l2.excludeModels',
      'l2.block',
      'l0.enabled',
      'l0.remindAfter',
      'l0.vetoAfter',
      'l0.reminderText',
      'l0.vetoText',
      'ui.pill',
    ]) {
      assert.ok(marked.includes(leaf), 'volatile leaf marked: ' + leaf)
    }
  } else {
    // 3.18.1/3.18.2 line: no volatile API, so nothing may be marked, and the
    // schema must still build (the capability check returned the schema itself).
    assert.deepEqual(marked, [])
  }

  // Version-independent nesting rules. Volatility must sit on LEAVES: an enclosing
  // section or `configFile` marked volatile would break the settings form on the
  // volatile host, and a volatile field inside a volatile field throws at resolve
  // time. `Schema.resolve` runs the library's own `validateVolatileSchema`, so it
  // is the oracle here: if any nesting rule were violated this would throw, on
  // both library lines (the 3.18.1 checker is a no-op when nothing is marked).
  for (const section of ['guard', 'l2', 'l0', 'ui']) {
    assert.ok(!marked.includes(section), 'section must not be volatile: ' + section)
  }
  assert.ok(!marked.includes('configFile'), 'configFile is a row field, not a settings field')
  assert.doesNotThrow(() => Schema.resolve({}, apply.Config))
})

test('the settings services never appear in exports.inject', () => {
  // Every inject name is a REQUIRED gate in cordis, so naming the optional,
  // version-dependent transport here would fail the whole Web boot.
  assert.deepEqual(inject, ['webServer', 'fs', 'systemPrompt'])
  assert.ok(!inject.includes('settings'))
  assert.ok(!inject.includes('settingsScope'))
  assert.ok(!inject.includes('configForms'))
})

test('declarative branch disables the generated page with configure({ auto: false })', () => {
  assert.match(indexSource, /sctx\.settings\.configure\(\{ auto: false \}, ctx\.fiber\)/)
  // `configure` throws when called twice for one fiber, so it must be effect-owned.
  assert.match(indexSource, /sctx\.effect\(\(\) => sctx\.settings\.configure\(\{ auto: false \}, ctx\.fiber\)/)
  // The branch is gated on configure() existing, and only when register() is gone.
  assert.match(indexSource, /typeof settingsApi\.register !== 'function'/)
  assert.match(indexSource, /typeof settingsApi\.configure === 'function'/)
  // The reader keys on cosmokit's registered write symbol, never on `.set`.
  assert.match(indexSource, /Symbol\.for\('cosmokit\.volatile\.write'\)/)
  assert.doesNotMatch(indexSource, /typeof value\.set === 'function'/)
})

// ── declarative host behaviour, exercised through apply() ───────────────────

function mountDeclarative(raw, opts = {}) {
  const registered = []
  const routes = []
  const effects = []
  const settings = {
    // `register` is deliberately ABSENT: the declarative host has no such method,
    // and its presence is exactly what selects the legacy branch.
    configure(presentation, owner) { registered.push({ presentation, owner }); return () => {} },
  }
  const ctx = {
    fiber: { id: 'fiber-under-test' },
    get(svc) { return svc === 'settings' ? settings : undefined },
    inject(deps, fn) { if (Array.isArray(deps) && deps.includes('settings')) return fn({ settings, effect: ctx.effect, fs: ctx.fs }) },
    effect(fn) { effects.push(fn); const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
    on() {},
    webServer: { register(spec) { routes.push(spec); return () => {} } },
    fs: {
      async resolve(p) { return p },
      async readText() { if (opts.legacyFile) return opts.legacyFile; throw Object.assign(new Error('ENOENT: missing'), { code: 'ENOENT' }) },
      async writeText(p, text) { opts.writes = opts.writes || []; opts.writes.push({ p, text }) },
    },
    systemPrompt: { section() {} },
  }
  apply(ctx, raw)
  return { ctx, registered, routes, effects, settings }
}

async function readStatus(routes) {
  const route = routes.find((r) => r.path === '/api/tool-adapt/status')
  let body
  await route.handler({ method: 'GET', headers: {} }, {
    writeHead() {},
    end(text) { body = text },
  })
  return JSON.parse(body)
}

test('declarative host reads the entry Config on demand and reports settingsReady', async () => {
  const raw = {
    configFile: 'plugins/tool-adapt.config.json',
    guard: { enabled: false },
    l2: { enabled: true, excludeModels: ['glm-*'], block: 'custom block' },
    l0: { enabled: true, remindAfter: 5, vetoAfter: 3, reminderText: 'r', vetoText: 'v' },
    ui: { pill: true },
  }
  const { registered, routes } = mountDeclarative(raw)
  assert.equal(registered.length, 1, 'configure called exactly once')
  assert.deepEqual(registered[0].presentation, { auto: false })
  assert.deepEqual(registered[0].owner, { id: 'fiber-under-test' })

  const status = await readStatus(routes)
  assert.equal(status.settingsReady, true)
  assert.equal(status.migrated, false)
  assert.equal(status.config.guard.enabled, false)
  assert.deepEqual(status.config.l2.excludeModels, ['glm-*'])
  assert.equal(status.config.l2.block, 'custom block')
  assert.equal(status.config.l0.vetoAfter, 3)
  assert.equal(status.config.ui.pill, true)
})

test('declarative host re-reads a mutated config and falls back when invalid', async () => {
  const raw = { guard: { enabled: false }, l2: { excludeModels: ['glm-*'] }, ui: { pill: true } }
  const { routes } = mountDeclarative(raw)
  assert.equal((await readStatus(routes)).config.ui.pill, true)

  // The declarative service writes volatile fields IN PLACE; a cached value would
  // go stale, so mutating the same object must be visible on the next read.
  raw.ui.pill = false
  raw.l2.excludeModels = ['qwen-*']
  const live = await readStatus(routes)
  assert.equal(live.config.ui.pill, false)
  assert.deepEqual(live.config.l2.excludeModels, ['qwen-*'])

  // Invalid values fall back to the shipped defaults instead of throwing.
  raw.l0 = { remindAfter: 999 }
  const bad = await readStatus(routes)
  assert.equal(bad.config.l0.remindAfter, DEFAULT_CONFIG.l0.remindAfter)
  assert.equal(bad.ok, true)
})

test('declarative host reads the cosmokit volatile wrapper shape', async () => {
  // What a volatile field parses to on the ≥ 0.1.7 corridor: a frozen reference
  // with `get()` and cosmokit's REGISTERED write symbol — and no `.set`. This
  // stand-in keeps the guard meaningful even on the 3.18.1 line, where the real
  // library cannot yet produce one.
  const WRITE = Symbol.for('cosmokit.volatile.write')
  const ref = (value) => Object.freeze({ get: () => value, [WRITE]: () => {} })
  const raw = {
    configFile: 'plugins/tool-adapt.config.json',
    guard: ref({ enabled: ref(false) }),
    l2: ref({ enabled: ref(true), excludeModels: ref(['glm-*']), block: ref('wrapped block') }),
    l0: ref({ remindAfter: ref(6) }),
    ui: ref({ pill: ref(true) }),
  }
  const { routes } = mountDeclarative(raw)
  const status = await readStatus(routes)
  assert.equal(status.config.guard.enabled, false)
  assert.equal(status.config.l2.enabled, true)
  assert.deepEqual(status.config.l2.excludeModels, ['glm-*'])
  assert.equal(status.config.l2.block, 'wrapped block')
  assert.equal(status.config.l0.remindAfter, 6)
  // Untouched volatile fields still fall back to their defaults.
  assert.equal(status.config.l0.vetoAfter, DEFAULT_CONFIG.l0.vetoAfter)
  assert.equal(status.config.ui.pill, true)

  // A wrapper holding an out-of-range value must fall back, not throw: the reader
  // must have unwrapped it before validateConfig saw it.
  const badRef = { guard: ref({ enabled: true }), l0: ref({ remindAfter: ref(999) }) }
  const bad = await readStatus(mountDeclarative(badRef).routes)
  assert.equal(bad.config.l0.remindAfter, DEFAULT_CONFIG.l0.remindAfter)
  assert.equal(bad.ok, true)
})

test('declarative host never migrates the legacy settings.yaml', async () => {
  const legacy = JSON.stringify({ guard: { enabled: false }, l2: { excludeModels: ['legacy-*'] } })
  const { routes, settings } = mountDeclarative(
    { guard: { enabled: true }, l2: { excludeModels: ['default-*'] } },
    { legacyFile: legacy },
  )
  await new Promise((r) => setTimeout(r, 30))
  const status = await readStatus(routes)
  assert.equal(status.migrated, false)
  // The legacy file must not override the entry Config on the declarative host.
  assert.deepEqual(status.config.l2.excludeModels, ['default-*'])
  assert.equal(status.config.guard.enabled, true)
  // `describe`/`replace` are ≤ 0.1.5 concepts and must not be required here.
  assert.equal(typeof settings.replace, 'undefined')
})

test('a settings service without register or configure stays non-throwing', async () => {
  const registered = []
  const ctx = {
    get(svc) { return svc === 'settings' ? { somethingElse() {} } : undefined },
    inject(deps, fn) { if (Array.isArray(deps) && deps.includes('settings')) return fn({ settings: ctx.get('settings'), effect: ctx.effect, fs: ctx.fs }) },
    effect(fn) { return typeof fn === 'function' ? (fn() ?? (() => {})) : () => {} },
    on() {},
    webServer: { register() { return () => {} } },
    fs: { async resolve(p) { return p }, async readText() { throw new Error('ENOENT') } },
    systemPrompt: { section() {} },
  }
  assert.doesNotThrow(() => apply(ctx, {}))
  assert.deepEqual(registered, [])
})

test('settings namespace is kebab-case tool-adapt', () => {
  assert.equal(SETTINGS_NS, 'tool-adapt')
})

test('default config validates', () => {
  const r = validateConfig(DEFAULT_CONFIG)
  assert.equal(r.ok, true)
  assert.equal(r.config.guard.enabled, true)
  assert.deepEqual(r.config.l2.excludeModels, ['deepseek-*'])
})

test('ui.pill defaults to false and accepts explicit booleans only', () => {
  assert.equal(validateConfig(DEFAULT_CONFIG).config.ui.pill, false)
  const on = validateConfig({ ui: { pill: true } })
  assert.equal(on.ok, true)
  assert.equal(on.config.ui.pill, true)
  const off = validateConfig({ ui: { pill: false } })
  assert.equal(off.ok, true)
  const bad = validateConfig({ ui: { pill: 'yes' } })
  assert.equal(bad.ok, false)
  const badSection = validateConfig({ ui: 'on' })
  assert.equal(badSection.ok, false)
})

test('unknown top-level keys are rejected', () => {
  const r = validateConfig({ guard: { enabled: true }, extra: 1 })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('unknown')))
  const r2 = validateConfig({ ui: { pill: true }, extra: 1 })
  assert.equal(r2.ok, false)
})

test('invalid excludeModels and thresholds are rejected', () => {
  const r = validateConfig({
    l2: { excludeModels: ['bad space'] },
    l0: { remindAfter: 1, vetoAfter: 99 },
  })
  assert.equal(r.ok, false)
})

test('cloneConfig is detached JSON', () => {
  const a = cloneConfig(DEFAULT_CONFIG)
  a.guard.enabled = false
  assert.equal(DEFAULT_CONFIG.guard.enabled, true)
})

test('userSectionEmpty treats missing and empty objects as empty', () => {
  assert.equal(userSectionEmpty(undefined), true)
  assert.equal(userSectionEmpty({}), true)
  assert.equal(userSectionEmpty({ guard: { enabled: false } }), false)
})

test('excludeModels parse/format round-trip', () => {
  assert.deepEqual(parseExcludeModels('deepseek-*, glm-*'), ['deepseek-*', 'glm-*'])
  assert.equal(formatExcludeModels(['deepseek-*', 'glm-*']), 'deepseek-*,glm-*')
})

function attachSettings(ctx, settings) {
  ctx.get = (svc) => svc === 'settings' ? settings : undefined
  ctx.inject = (deps, fn) => {
    if (Array.isArray(deps) && deps.includes('settings') && settings) {
      return fn({
        settings,
        effect(cb) { return typeof cb === 'function' ? cb() : undefined },
        fs: ctx.fs,
      })
    }
  }
}

test('apply without settings still mounts routes and loads defaults', () => {
  const effects = []
  const routes = []
  const ctx = {
    get(name) { return name === 'settings' ? undefined : undefined },
    inject() {},
    effect(fn) { effects.push(fn); return fn() },
    on() {},
    webServer: {
      register(spec) { routes.push(spec.path); return () => {} },
    },
    fs: {
      async resolve(p) { return p },
      async readText() { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
    },
    systemPrompt: { section() {} },
  }
  apply(ctx, {})
  assert.equal(name, 'dsh-tool-adapt')
  assert.ok(routes.includes('/api/tool-adapt/status'))
  assert.ok(routes.includes('/api/tool-adapt/set'))
})

test('apply registers settings namespace when settings exists', () => {
  const registered = []
  const settings = {
    register(ns, schema, opts) {
      registered.push({ ns, schema, opts })
      return {
        get() { return DEFAULT_CONFIG },
        watch() { return () => {} },
        replace: async () => {},
      }
    },
    describe() { return [{ ns: SETTINGS_NS, user: {} }] },
    replace: async () => {},
  }
  const ctx = {
    effect(fn) { return typeof fn === 'function' ? fn() : undefined },
    on() {},
    webServer: { register() { return () => {} } },
    fs: {
      async resolve(p) { return p },
      async readText() { throw new Error('ENOENT: missing') },
    },
    systemPrompt: { section() {} },
  }
  attachSettings(ctx, settings)
  apply(ctx, {})
  assert.equal(registered.length, 1)
  assert.equal(registered[0].ns, 'tool-adapt')
  assert.equal(registered[0].opts.applies, 'live')
})

test('legacy JSON is migrated only when settings user layer is empty', async () => {
  const replaced = []
  let resolveMigrate
  const done = new Promise((resolve) => { resolveMigrate = resolve })
  const settings = {
    register() {
      return { get() { return DEFAULT_CONFIG }, watch() { return () => {} } }
    },
    describe() { return [{ ns: SETTINGS_NS, user: {} }] },
    async replace(ns, section) {
      replaced.push({ ns, section })
      resolveMigrate()
    },
  }
  const ctx = {
    effect(fn) { return typeof fn === 'function' ? fn() : undefined },
    on() {},
    webServer: { register() { return () => {} } },
    fs: {
      async resolve(p) { return p },
      async readText() {
        return JSON.stringify({
          guard: { enabled: false },
          l2: { enabled: true, excludeModels: ['deepseek-*'], block: DEFAULT_CONFIG.l2.block },
          l0: DEFAULT_CONFIG.l0,
        })
      },
    },
    systemPrompt: { section() {} },
  }
  attachSettings(ctx, settings)
  apply(ctx, { configFile: 'plugins/tool-adapt.config.json' })
  await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('migrate timeout')), 1000))])
  assert.equal(replaced.length, 1)
  assert.equal(replaced[0].ns, 'tool-adapt')
  assert.equal(replaced[0].section.guard.enabled, false)
})

test('existing settings user layer is not overwritten by legacy JSON', async () => {
  const replaced = []
  const settings = {
    register() {
      return { get() { return DEFAULT_CONFIG }, watch() { return () => {} } }
    },
    describe() { return [{ ns: SETTINGS_NS, user: { guard: { enabled: true } } }] },
    async replace(ns, section) { replaced.push({ ns, section }) },
  }
  const ctx = {
    effect(fn) { return typeof fn === 'function' ? fn() : undefined },
    on() {},
    webServer: { register() { return () => {} } },
    fs: {
      async resolve(p) { return p },
      async readText() { return JSON.stringify({ guard: { enabled: false } }) },
    },
    systemPrompt: { section() {} },
  }
  attachSettings(ctx, settings)
  apply(ctx, {})
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(replaced.length, 0)
})

test('post-execute notice prepends without rewriting downstream image content', async () => {
  const listeners = {}
  const ctx = {
    get() { return undefined },
    inject() {},
    effect(fn) { return typeof fn === 'function' ? fn() : undefined },
    on(name, fn) { listeners[name] = fn },
    webServer: { register() { return () => {} } },
    fs: {
      async resolve(p) { return p },
      async readText() { throw new Error('ENOENT') },
    },
    systemPrompt: { section() {} },
  }
  apply(ctx, {})
  const imageResult = {
    kind: 'accept',
    content: [{ type: 'image', attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }],
    isError: true,
  }
  const exec = { name: 'pwsh', agent: {}, arguments: {} }
  const first = await listeners['tools/post-execute'](exec, imageResult, async () => imageResult)
  assert.equal(first.content[0].type, 'image')
  const out = await listeners['tools/post-execute'](exec, imageResult, async () => imageResult)
  assert.equal(out.content[0].type, 'image')
  assert.ok(Array.isArray(out.additionalContexts))
  assert.equal(out.additionalContexts[0].content[0].type, 'text')
})

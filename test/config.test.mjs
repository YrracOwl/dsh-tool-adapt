import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CONFIG,
  SETTINGS_NS,
  cloneConfig,
  formatExcludeModels,
  parseExcludeModels,
  userSectionEmpty,
  validateConfig,
} from '../lib/config.js'
import { apply, name } from '../lib/index.js'

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

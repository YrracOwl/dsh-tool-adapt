import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DEFAULT_CONFIG, validateConfig } from '../lib/config.js'
import {
  PI_AI_PACKAGE,
  classifyGatewayRejection,
  gatewayDiagnosisText,
  mergedProviderProfiles,
  piAiEntry,
  piAiRows,
  routeDirectory,
  withDeveloperRolePinned,
} from '../lib/index.js'

const indexSource = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
const clientSource = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

// The real shape a 422 takes through the pi-ai adapter: `dsh-llm-pi-ai`'s
// `mapStopReason` carries `message` and `code` ONLY — never `status` — so the
// detector must work from the provider text, not from `failure.status`.
const REAL_422 = {
  provider: 'commandcode',
  failure: {
    message: 'Provider returned an error stop reason: 422 invalid_request_error',
    code: 'INVALID_REQUEST',
  },
}

const PINNED_ROWS = [{
  entry: { name: PI_AI_PACKAGE },
  inherited: {},
  override: {
    providers: {
      commandcode: {
        api: 'openai-completions',
        baseURL: 'https://api.commandcode.ai/provider/v1',
        compat: { supportsDeveloperRole: false },
      },
    },
  },
}]

const OPEN_ROWS = [{
  entry: { name: PI_AI_PACKAGE },
  inherited: {},
  override: {
    providers: {
      commandcode: {
        api: 'openai-completions',
        baseURL: 'https://api.commandcode.ai/provider/v1',
      },
    },
  },
}]

// ── routeDirectory ──────────────────────────────────────────────────────────

test('routeDirectory ignores anything that is not the pi-ai entry list', () => {
  assert.equal(routeDirectory(undefined).size, 0)
  assert.equal(routeDirectory(null).size, 0)
  assert.equal(routeDirectory({}).size, 0)
  assert.equal(routeDirectory([{ entry: { name: 'some-other-plugin' }, override: { providers: { x: {} } } }]).size, 0)
})

test('routeDirectory merges the inherited layer under the explicit one', () => {
  const directory = routeDirectory([{
    entry: { name: PI_AI_PACKAGE },
    inherited: { providers: { commandcode: { api: 'openai-completions', baseURL: 'https://a.example/v1' } } },
    override: { providers: { commandcode: { compat: { supportsDeveloperRole: false } } } },
  }])
  const route = directory.get('commandcode')
  assert.equal(route.api, 'openai-completions')
  assert.equal(route.baseURL, 'https://a.example/v1')
  assert.equal(route.pinned, true)
})

test('a route counts as pinned only on the route or on EVERY model', () => {
  const routePin = routeDirectory(OPEN_ROWS).get('commandcode')
  assert.equal(routePin.pinned, false)

  const allModels = routeDirectory([{
    entry: { name: PI_AI_PACKAGE },
    override: {
      providers: {
        g: {
          api: 'openai-completions',
          models: [
            { id: 'a', compat: { supportsDeveloperRole: false } },
            { id: 'b', compat: { supportsDeveloperRole: false } },
          ],
        },
      },
    },
  }]).get('g')
  assert.equal(allModels.pinned, true)

  const oneOfTwo = routeDirectory([{
    entry: { name: PI_AI_PACKAGE },
    override: {
      providers: {
        g: {
          api: 'openai-completions',
          models: [
            { id: 'a', compat: { supportsDeveloperRole: false } },
            { id: 'b' },
          ],
        },
      },
    },
  }]).get('g')
  assert.equal(oneOfTwo.pinned, false)
})

// ── classifyGatewayRejection ────────────────────────────────────────────────

test('the real adapter shape is recognized without failure.status', () => {
  const finding = classifyGatewayRejection(REAL_422, routeDirectory(OPEN_ROWS))
  assert.ok(finding, 'expected a finding')
  assert.equal(finding.provider, 'commandcode')
  assert.equal(finding.known, true)
  assert.equal(finding.api, 'openai-completions')
  assert.equal(finding.baseURL, 'https://api.commandcode.ai/provider/v1')
  assert.equal(finding.status, undefined)
  assert.equal(finding.code, 'INVALID_REQUEST')
})

test('an explicit 422 status is recognized too', () => {
  const finding = classifyGatewayRejection(
    { provider: 'p', failure: { message: 'bad request', code: 'INVALID_REQUEST', status: 422 } },
    new Map(),
  )
  assert.ok(finding)
  assert.equal(finding.status, 422)
  assert.equal(finding.known, false)
})

test('a context-window overflow is NOT this signature', () => {
  assert.equal(classifyGatewayRejection(
    { provider: 'p', failure: { message: '422 context_length_exceeded', code: 'CONTEXT_WINDOW_EXCEEDED' } },
    new Map(),
  ), undefined)
})

test('an already-pinned route and a protocol without the switch are silent', () => {
  assert.equal(classifyGatewayRejection(REAL_422, routeDirectory(PINNED_ROWS)), undefined)
  const anthropic = routeDirectory([{
    entry: { name: PI_AI_PACKAGE },
    override: { providers: { commandcode: { api: 'anthropic-messages' } } },
  }])
  assert.equal(classifyGatewayRejection(REAL_422, anthropic), undefined)
})

test('unrelated failures and malformed payloads are ignored', () => {
  assert.equal(classifyGatewayRejection(undefined, new Map()), undefined)
  assert.equal(classifyGatewayRejection({}, new Map()), undefined)
  assert.equal(classifyGatewayRejection({ provider: 'p' }, new Map()), undefined)
  assert.equal(classifyGatewayRejection({ provider: 'p', failure: {} }, new Map()), undefined)
  assert.equal(classifyGatewayRejection({ provider: '', failure: { message: '422', code: 'X' } }, new Map()), undefined)
  assert.equal(classifyGatewayRejection(
    { provider: 'p', failure: { message: 'connection reset', code: 'TRANSPORT' } },
    new Map(),
  ), undefined)
})

test('the retained provider text is capped', () => {
  const finding = classifyGatewayRejection(
    { provider: 'p', failure: { message: '422 ' + 'x'.repeat(2000), code: 'INVALID_REQUEST' } },
    new Map(),
  )
  assert.ok(finding)
  assert.ok(finding.message.length <= 400)
})

// ── gatewayDiagnosisText ────────────────────────────────────────────────────

test('the diagnosis names the route and the exact fix', () => {
  const finding = classifyGatewayRejection(REAL_422, routeDirectory(OPEN_ROWS))
  const texts = gatewayDiagnosisText(finding)
  assert.match(texts.summary, /commandcode/)
  assert.match(texts.summary, /supportsDeveloperRole: false/)
  assert.match(texts.fix, /supportsDeveloperRole: false/)
  assert.match(texts.fix, /commandcode/)
  // The fix is a paste-ready route block under `providers:`.
  assert.equal(texts.fix, 'providers:\n  commandcode:\n    compat:\n      supportsDeveloperRole: false')
  assert.match(texts.detail, /invalid_request_error/)
})

// ── host/client wiring guards (structural, source-level) ────────────────────

test('the host observes agent/request-error and only observes', () => {
  assert.match(indexSource, /ctx\.on\('agent\/request-error'/)
  const listener = indexSource.slice(indexSource.indexOf("ctx.on('agent/request-error'"))
  const body = listener.slice(0, listener.indexOf('})'))
  assert.match(body, /observeRequestFailure\(payload\)/)
  // Observe-only: the listener returns the downstream action, never a decision.
  assert.match(body, /return next\(\)/)
  assert.doesNotMatch(body, /kind: 'retry'/)
})

// ── the repair: one key, one write path, opt-in ─────────────────────────────

test('piAiEntry hands back the exact Loader entry a write must target', () => {
  const entry = { name: PI_AI_PACKAGE }
  assert.equal(piAiRows([{ entry, override: {} }]).length, 1)
  assert.equal(piAiEntry([{ entry, override: {} }]), entry)
  assert.equal(piAiEntry([{ entry: { name: 'other' }, override: {} }]), undefined)
  assert.equal(piAiEntry(undefined), undefined)
  // A host that spells the name through `options` is still recognized.
  assert.equal(piAiRows([{ entry: { options: { name: PI_AI_PACKAGE } }, override: {} }]).length, 1)
})

test('mergedProviderProfiles keeps the inherited route whole for the write-back', () => {
  const merged = mergedProviderProfiles([{
    entry: { name: PI_AI_PACKAGE },
    inherited: { providers: { commandcode: { api: 'openai-completions', baseURL: 'https://a.example/v1', models: [] } } },
    override: { providers: { commandcode: { compat: { supportsDeveloperRole: false } } } },
  }])
  assert.deepEqual(merged.get('commandcode'), {
    api: 'openai-completions',
    baseURL: 'https://a.example/v1',
    models: [],
    compat: { supportsDeveloperRole: false },
  })
})

test('withDeveloperRolePinned changes exactly one key and copies the rest through', () => {
  const profile = { api: 'openai-completions', baseURL: 'https://a.example/v1', models: [{ id: 'm' }], headers: { a: 'b' } }
  const current = { providers: { other: { api: 'anthropic-messages' }, commandcode: { api: 'openai-completions' } }, timeoutMs: 5 }
  const next = withDeveloperRolePinned(current, 'commandcode', profile)

  assert.deepEqual(next.providers.commandcode, {
    api: 'openai-completions',
    baseURL: 'https://a.example/v1',
    models: [{ id: 'm' }],
    headers: { a: 'b' },
    compat: { supportsDeveloperRole: false },
  })
  // Untouched siblings survive, and the input is never mutated.
  assert.deepEqual(next.providers.other, { api: 'anthropic-messages' })
  assert.equal(next.timeoutMs, 5)
  assert.deepEqual(current.providers.commandcode, { api: 'openai-completions' })

  // An existing compat block keeps every other switch.
  const merged = withDeveloperRolePinned({}, 'r', { api: 'openai-completions', compat: { supportsStore: true, chatTemplateArgs: {} } })
  assert.deepEqual(merged.providers.r.compat, { supportsStore: true, chatTemplateArgs: {}, supportsDeveloperRole: false })

  assert.deepEqual(withDeveloperRolePinned(undefined, 'r', {}).providers.r, {
    compat: { supportsDeveloperRole: false },
  })
})

test('the ONLY config write is configEditor.edit, and only for that one key', () => {
  // The edit call site exists, and it hands the editor the pure change function.
  assert.match(indexSource, /editor\.edit\(entry, \(current\) => withDeveloperRolePinned\(current, provider, profile\)\)/)
  // ...and it is the only configuration write in the host half: the settings
  // service writes the plugin's OWN namespace, never another entry's config.
  assert.equal((indexSource.match(/\.edit\(/g) || []).length, 1)
  // Reading the profile is the non-gating service lookup, never a hard inject.
  assert.match(indexSource, /ctx\.get\('configEditor'\)/)
  assert.doesNotMatch(indexSource, /inject = \[[^\]]*'configEditor'/)
})

test('the unattended repair is off by default and opt-in by flag', () => {
  assert.equal(DEFAULT_CONFIG.gateway.autoRepair, false)
  assert.deepEqual(validateConfig({}).config.gateway, { autoRepair: false })
  assert.deepEqual(validateConfig({ gateway: { autoRepair: true } }).config.gateway, { autoRepair: true })
  assert.equal(validateConfig({ gateway: { autoRepair: 'yes' } }).ok, false)
  assert.equal(validateConfig({ gateway: { nope: true } }).ok, true) // unknown inner keys are ignored, not fatal
  // The call site is gated on the resolved config, never on detection alone.
  assert.match(indexSource, /state\.config\.gateway && state\.config\.gateway\.autoRepair === true/)
  // ...and runs at most once per route per process.
  assert.match(indexSource, /retained\.attempted === true/)
})

test('the explicit repair route is POST-only and fenced like the settings route', () => {
  const route = indexSource.slice(indexSource.indexOf("path: '/api/tool-adapt/gateway-fix'"))
  const handler = route.slice(0, route.indexOf('}), '))
  assert.match(handler, /req\.method !== 'POST'/)
  assert.match(handler, /hostAllowed\(req\)/)
  assert.match(handler, /originAllowed\(req\)/)
  assert.match(handler, /readBody\(req\)/)
  assert.match(handler, /GATEWAY_PROVIDER_CAP/)
})

test('the status route exposes the finding and the card renders it', () => {
  assert.match(indexSource, /gateway: \{\s*\n\s*summary: gatewaySummary\(\)/)
  assert.match(clientSource, /data\.gateway\.summary/)
  // The one-click button posts to the fenced repair route.
  assert.match(clientSource, /API \+ '\/gateway-fix'/)
  assert.match(clientSource, /method: 'POST'/)
  // The card shows the paste-ready fix and the autoRepair switch.
  assert.match(clientSource, /path: \['gateway', 'autoRepair'\]/)
  assert.match(clientSource, /item\.fix \|\| ''/)
})

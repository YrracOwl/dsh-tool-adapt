// dsh-tool-adapt — host half (official bundle form)
//
// Adaptation layer for foreign models. ONE RULE (first principles): in a
// session where escalation is impossible ("dead" state — sandbox already at
// danger-full-access, or approval policy "never"), the environment stops lying
// to the model and stops punishing it:
//
//   guard.remove  the model-facing tool schemas no longer offer the
//                 `sandbox_permissions` / `justification` parameters at all —
//                 dead buttons are removed from the assembly copy only; the
//                 registry schemas are never touched and legal sessions keep
//                 the official wording.
//   guard.strip   if a call still arrives carrying those fields (training
//                 habit, stale compacted context, mid-session state switch),
//                 the fields are stripped at `tools/execute` and the call runs
//                 under the session's standing policy. No error, no loop.
//
// Both halves derive from ONE predicate, `escalationDeadState(session)`,
// re-evaluated at every assembly/call, so a mode/policy switch takes effect on
// the very next step. Text-level persuasion has been REMOVED: evidence showed
// pipio models ignore all of it — the parameter NAME existing in the schema is
// what triggers their habit, and removing it is the only signal that works.
//
// Two supporting aspects remain, both optional:
//   L2  DSH tool-call conventions — a system-prompt section injected only for
//       non-native model families (default: everything except `deepseek-*`),
//       gated in the `system-prompt/assemble` waterfall via the `{{model}}`
//       assembly variable with session.requestHeader()/requestContext()
//       fallbacks.
//   L0  failure-count loop-breaker — counts CONSECUTIVE same-tool failures
//       with ANY arguments (per agent), injects a reminder at `remindAfter`
//       and can veto further calls at `vetoAfter` (0 = veto off).
//
// Config (from the mounting row, resolved against process.cwd()):
//   configFile  -> the JSON config file (defaults:
//                  <cwd>/plugins/tool-adapt.config.json, keeping the legacy
//                  profile location so existing configs migrate unchanged).
//                  Strictly validated before apply/persist; changes are hot.
//
// Safety notes:
//   - Every listener is wrapped; agent-less calls pass through; the education
//     layer must never break the pipeline.
//   - The strip half reassigns `exec.arguments` with a cleaned copy during
//     `tools/execute`. The arguments object itself is deep-frozen by the
//     registry, so we replace the property rather than delete keys.
//   - In legal states (confined + approval=ask) the official escalation flow
//     is untouched: nothing is removed, nothing is stripped.

import path from 'node:path'
import { randomUUID } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import {
  DEFAULT_CONFIG,
  SETTINGS_NS,
  cloneConfig,
  isPlainObject,
  userSectionEmpty,
  validateConfig,
} from './config.js'

export { DEFAULT_CONFIG, SETTINGS_NS, validateConfig } from './config.js'

export const name = 'dsh-tool-adapt'
// `settings` is deliberately NOT listed here: cordis treats every inject name as a
// REQUIRED gate, and the settings transport is version-dependent (see the
// `ctx.inject(['settings'], ...)` wait inside apply).
export const inject = ['webServer', 'fs', 'systemPrompt']

// ── settings schema: one shape, two hosts ────────────────────────────────────
// ≤ 0.1.5  the schema is handed to `ctx.settings.register()` and plain fields are
//          enough.
// ≥ 0.1.7  the same shape must be the entry's own `static Config`, and the
//          settings service only exposes fields marked `.volatile()`: a schema
//          without a volatile field produces no settings form at all.
//
// `Schema.prototype.volatile` exists only from schemastery 3.18.4 (the 0.1.7
// corridor); the 0.1.5 line resolves 3.18.2, where it is `undefined` and calling
// it throws. So it is applied capability-detected, and one expression serves both
// hosts. Volatility is marked on the individual LEAVES (and on `excludeModels` as
// a whole) — never on an enclosing object too, because a volatile field inside a
// volatile field throws at resolve time.
const volatile = (schema) => (typeof schema?.volatile === 'function' ? schema.volatile() : schema)

// A volatile field's parsed value is a cosmokit wrapper: a `get()` method plus a
// registered write symbol, and nothing else. Key on the symbol — not on `set`,
// which does NOT exist (verified against schemastery 3.18.4 + cosmokit 1.8.5).
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')
function readVolatile(value) {
  if (value === null || typeof value !== 'object') return value
  if (typeof value.get !== 'function') return value
  if (!(VOLATILE_WRITE in value)) return value
  return value.get()
}

function settingsFields() {
  return {
    guard: Schema.object({
      enabled: volatile(Schema.boolean().default(DEFAULT_CONFIG.guard.enabled)),
    }).default(cloneConfig(DEFAULT_CONFIG.guard)),
    l2: Schema.object({
      enabled: volatile(Schema.boolean().default(DEFAULT_CONFIG.l2.enabled)),
      excludeModels: volatile(Schema.array(Schema.string().pattern(/^[A-Za-z0-9.*_-]{1,64}$/)).max(50).default(DEFAULT_CONFIG.l2.excludeModels.slice())),
      block: volatile(Schema.string().min(1).max(4000).default(DEFAULT_CONFIG.l2.block)),
    }).default(cloneConfig(DEFAULT_CONFIG.l2)),
    l0: Schema.object({
      enabled: volatile(Schema.boolean().default(DEFAULT_CONFIG.l0.enabled)),
      remindAfter: volatile(Schema.number().step(1).min(2).max(20).default(DEFAULT_CONFIG.l0.remindAfter)),
      vetoAfter: volatile(Schema.number().step(1).min(0).max(20).default(DEFAULT_CONFIG.l0.vetoAfter)),
      reminderText: volatile(Schema.string().min(1).max(2000).default(DEFAULT_CONFIG.l0.reminderText)),
      vetoText: volatile(Schema.string().min(1).max(2000).default(DEFAULT_CONFIG.l0.vetoText)),
    }).default(cloneConfig(DEFAULT_CONFIG.l0)),
    ui: Schema.object({
      pill: volatile(Schema.boolean().default(DEFAULT_CONFIG.ui.pill)),
    }).default(cloneConfig(DEFAULT_CONFIG.ui)),
    gateway: Schema.object({
      autoRepair: volatile(Schema.boolean().default(DEFAULT_CONFIG.gateway.autoRepair)),
    }).default(cloneConfig(DEFAULT_CONFIG.gateway)),
    surfaceOverflow: Schema.object({
      autoRelabel: volatile(Schema.boolean().default(DEFAULT_CONFIG.surfaceOverflow.autoRelabel)),
    }).default(cloneConfig(DEFAULT_CONFIG.surfaceOverflow)),
  }
}

// ≤ 0.1.5 registration schema: the live settings section only.
function createSettingsSchema() {
  return Schema.object(settingsFields())
}

// ≥ 0.1.7 entry Config: the live settings section PLUS the row field `configFile`,
// which is what the mounting row in cordis.patch.yml carries. The settings fields
// keep the identical names, nesting and defaults, so the client card's reads and
// writes of `guard.enabled`, `l2.*`, `l0.*` and `ui.pill` work on both hosts.
function createEntryConfig() {
  return Schema.object({
    configFile: Schema.string().default('plugins/tool-adapt.config.json'),
    ...settingsFields(),
  })
}

// Project the parsed entry Config onto the live settings shape, reading volatile
// fields on demand. Never cache the result: the declarative settings service
// writes volatile fields IN PLACE without remounting the entry, so the value must
// be re-read at every access.
function readDeclarativeConfig(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const guard = readVolatile(raw.guard)
  const l2 = readVolatile(raw.l2)
  const l0 = readVolatile(raw.l0)
  const ui = readVolatile(raw.ui)
  const gateway = readVolatile(raw.gateway)
  const surfaceOverflow = readVolatile(raw.surfaceOverflow)
  return {
    guard: { enabled: readVolatile(guard && guard.enabled) },
    l2: {
      enabled: readVolatile(l2 && l2.enabled),
      excludeModels: readVolatile(l2 && l2.excludeModels),
      block: readVolatile(l2 && l2.block),
    },
    l0: {
      enabled: readVolatile(l0 && l0.enabled),
      remindAfter: readVolatile(l0 && l0.remindAfter),
      vetoAfter: readVolatile(l0 && l0.vetoAfter),
      reminderText: readVolatile(l0 && l0.reminderText),
      vetoText: readVolatile(l0 && l0.vetoText),
    },
    ui: { pill: readVolatile(ui && ui.pill) },
    gateway: { autoRepair: readVolatile(gateway && gateway.autoRepair) },
    surfaceOverflow: { autoRelabel: readVolatile(surfaceOverflow && surfaceOverflow.autoRelabel) },
  }
}

// The plugin's own entry Config (`static Config`): what the declarative (≥ 0.1.7)
// settings service reads as this entry's schema, keyed by the loader entry id
// 'tool-adapt' — the same key the client half resolves.
//
// It is reached two ways, and both must work:
//   - through the plugin value cordis resolves. The loader's `unwrapExports`
//     collapses a namespace carrying a `default` export down to that single value,
//     so this module deliberately exports NO `default`: with none, the namespace
//     itself is the plugin object, `resolve()` finds `apply`, and `plugin.Config`
//     is read off that same namespace.
//   - as a plain named export, so a host half loaded directly (the workspace's
//     `scripts/settings-host-portability-check.mjs`) reads `module.Config`.
// `Config` is therefore the single shared schema instance attached to the exported
// `apply`. Function declarations are hoisted, so this is safe even though `apply`
// is defined further down, and the ≤ 0.1.5 line simply never reads it.
export const Config = createEntryConfig()
Object.assign(apply, { Config })

async function readLegacyFile(ctx, configFile) {
  try {
    const target = await ctx.fs.resolve(configFile)
    const text = await ctx.fs.readText(target)
    return { ok: true, text, target }
  } catch (err) {
    const msg = String((err && err.message) || err)
    if (/not found|ENOENT/i.test(msg)) return { ok: false, missing: true, error: msg }
    return { ok: false, missing: false, error: msg }
  }
}

async function loadLegacyFile(ctx, configFile, state) {
  const file = await readLegacyFile(ctx, configFile)
  if (file.missing) return
  if (!file.ok) {
    state.fileError = file.error
    return
  }
  try {
    const validated = validateConfig(JSON.parse(file.text))
    if (validated.ok) state.config = validated.config
    else state.fileError = (validated.errors || []).join('; ')
  } catch (err) {
    state.fileError = String((err && err.message) || err)
  }
}

async function migrateLegacyConfig(ctx, configFile, settings, state) {
  try {
    const described = typeof settings.describe === 'function' ? settings.describe() : []
    const current = Array.isArray(described) ? described.find((item) => item && item.ns === SETTINGS_NS) : undefined
    if (current && !userSectionEmpty(current.user)) {
      state.migrated = true
      return
    }
    const file = await readLegacyFile(ctx, configFile)
    if (file.missing) return
    if (!file.ok) {
      state.fileError = file.error
      return
    }
    const validated = validateConfig(JSON.parse(file.text))
    if (!validated.ok) {
      state.fileError = (validated.errors || []).join('; ')
      return
    }
    await settings.replace(SETTINGS_NS, validated.config)
    state.migrated = true
  } catch (err) {
    const msg = String((err && err.message) || err)
    if (!/not found|ENOENT/i.test(msg)) state.fileError = msg
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  return new RegExp('^' + escaped.replaceAll('*', '.*') + '$')
}

function fill(template, tool, count) {
  return String(template)
    .split('{tool}').join(String(tool))
    .split('{count}').join(String(count))
}

function makeNotice(text, summary) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-tool-adapt', form: 'notice', summary },
  }
}

function prepend(ours, theirs) {
  return [ours, ...(theirs ?? [])]
}

// ── gateway compat diagnosis: the `developer` instruction role ───────────────
//
// DSH lets pi-ai choose the system-message role at dispatch:
// `model.reasoning && compat.supportsDeveloperRole` selects `developer` instead
// of `system` (pi-ai `dist/api/openai-completions.js`, `instructionRole`). pi-ai
// auto-detects only the vendors its own catalog ships, so a gateway it does not
// know is classified OpenAI-standard and DOES receive `developer`. A gateway
// that rejects that shape answers 422 invalid_request_error — and because the
// history is fixed, every retry rebuilds the same rejected request, so the
// session wedges permanently.
//
// The fix is ONE config key on that route of the `llm-pi-ai` entry:
//
//   providers:
//     <route>:
//       compat:
//         supportsDeveloperRole: false
//
// This plugin cannot apply the key at REQUEST time, and deliberately does not
// try: there is no seam. `llm/stream` hands over `GenerateOptions` and
// `agent/request` returns `LlmCallConfig`, and neither carries `compat`; the
// model objects belong to `dsh-llm-pi-ai`, whose `registerAdapter` is
// all-or-nothing. What this half does instead is OBSERVE the signature, NAME the
// exact fix, and — only when the user asks, by pressing the card's button or by
// switching `gateway.autoRepair` on — persist that one key through the host's
// own `configEditor`, which validates and reconciles it on the normal Loader
// path. Nothing here writes configuration on its own initiative.

/** The bundle whose entry owns the provider routes this diagnosis reasons about. */
export const PI_AI_PACKAGE = '@deepseek-ai/dsh-llm-pi-ai'

/** Retained provider text cap: the card shows a line, not a transcript. */
const GATEWAY_MESSAGE_CAP = 400

/** Distinct routes that may hold a finding; a hostile host cannot grow this. */
const GATEWAY_FINDING_CAP = 32

/** The longest provider route key the repair route will accept. */
const GATEWAY_PROVIDER_CAP = 128

/** The Loader entry name of one `configuration()` row, however the host spells it. */
function rowEntryName(row) {
  if (!isPlainObject(row)) return undefined
  const entry = row.entry
  if (!isPlainObject(entry)) return undefined
  if (typeof entry.name === 'string') return entry.name
  if (isPlainObject(entry.options) && typeof entry.options.name === 'string') return entry.options.name
  return undefined
}

/**
 * The `pi-ai` rows of one `configEditor.configuration()` result.
 * @param rows - the `configuration()` result, or anything else.
 * @returns the matching rows in host order.
 */
export function piAiRows(rows) {
  if (!Array.isArray(rows)) return []
  return rows.filter((row) => rowEntryName(row) === PI_AI_PACKAGE)
}

/**
 * The Loader entry to hand back to `configEditor.edit`, so the write lands on
 * the exact row it was derived from (the service re-checks it for replacement).
 * @param rows - the `configuration()` result, or anything else.
 * @returns the first `pi-ai` row's entry, or `undefined`.
 */
export function piAiEntry(rows) {
  const row = piAiRows(rows)[0]
  return isPlainObject(row) && isPlainObject(row.entry) ? row.entry : undefined
}

/**
 * Merge every `pi-ai` row's explicit layer over its inherited one, per route.
 *
 * The config service reports the profile layer and the inherited one separately,
 * so one route is the SHALLOW MERGE of both: a profile patch that only pins
 * `compat` on an inherited route must still describe that route completely
 * enough to write it back.
 * @param rows - the `configuration()` result, or anything else.
 * @returns route key -> the merged raw provider profile.
 */
export function mergedProviderProfiles(rows) {
  const out = new Map()
  for (const row of piAiRows(rows)) {
    const inherited = isPlainObject(row.inherited) && isPlainObject(row.inherited.providers) ? row.inherited.providers : {}
    const override = isPlainObject(row.override) && isPlainObject(row.override.providers) ? row.override.providers : {}
    for (const route of new Set([...Object.keys(inherited), ...Object.keys(override)])) {
      const from = isPlainObject(inherited[route]) ? inherited[route] : {}
      const to = isPlainObject(override[route]) ? override[route] : {}
      out.set(route, { ...(out.get(route) ?? {}), ...from, ...to })
    }
  }
  return out
}

/**
 * Project the merged provider profiles onto the facts this diagnosis needs.
 * @param rows - the `configuration()` result, or anything else.
 * @returns route key -> `{ api, baseURL, pinned, profile }`; empty when nothing matched.
 */
export function routeDirectory(rows) {
  const out = new Map()
  for (const [route, profile] of mergedProviderProfiles(rows)) {
    const models = Array.isArray(profile.models) ? profile.models : []
    const routePin = isPlainObject(profile.compat) ? profile.compat.supportsDeveloperRole : undefined
    const modelPins = models.map((model) => (isPlainObject(model) && isPlainObject(model.compat)
      ? model.compat.supportsDeveloperRole
      : undefined))
    out.set(route, {
      api: typeof profile.api === 'string' ? profile.api : undefined,
      baseURL: typeof profile.baseURL === 'string' ? profile.baseURL : undefined,
      // A route pins the classic role either by declaring it on the route, or
      // by declaring it on every model it serves.
      pinned: routePin === false || (models.length > 0 && modelPins.every((pin) => pin === false)),
      profile,
    })
  }
  return out
}

/**
 * The one config change this diagnosis ever proposes, as a pure function of the
 * current raw config: the route's `compat.supportsDeveloperRole` set to `false`,
 * with every other key of the route copied through unchanged.
 * @param current - the entry's current raw config.
 * @param route - the provider route key to pin.
 * @param profile - the merged route profile to write back.
 * @returns the next raw config.
 */
export function withDeveloperRolePinned(current, route, profile) {
  const next = isPlainObject(current) ? { ...current } : {}
  const providers = isPlainObject(next.providers) ? { ...next.providers } : {}
  providers[route] = {
    ...profile,
    compat: {
      ...(isPlainObject(profile) && isPlainObject(profile.compat) ? profile.compat : {}),
      supportsDeveloperRole: false,
    },
  }
  next.providers = providers
  return next
}

/**
 * Recognize the "gateway rejected the `developer` instruction role" signature in
 * one failed model request.
 *
 * `dsh-llm-pi-ai` builds its `LlmFailure` from provider text and never sets
 * `status` (`mapStopReason` carries `message` and `code` only), so a numeric 422
 * lives inside the message rather than in `failure.status`; both are accepted.
 * A failure the harness already classified as `CONTEXT_WINDOW_EXCEEDED` is NOT
 * this signature: that one is a genuine overflow whose fix is a smaller route
 * `contextWindow`, and blaming the instruction role would point the wrong way.
 * @param payload - the `agent/request-error` payload.
 * @param directory - a {@link routeDirectory} result, when one is available.
 * @returns the finding to report, or `undefined` when this is not the signature.
 */
export function classifyGatewayRejection(payload, directory) {
  if (!isPlainObject(payload)) return undefined
  const failure = payload.failure
  if (!isPlainObject(failure)) return undefined
  const message = typeof failure.message === 'string' ? failure.message : ''
  const code = typeof failure.code === 'string' ? failure.code : ''
  if (code === 'CONTEXT_WINDOW_EXCEEDED') return undefined
  if (!(failure.status === 422 || /\b422\b/.test(message) || /invalid_request_error/i.test(message))) return undefined
  const provider = typeof payload.provider === 'string' ? payload.provider : ''
  if (provider === '') return undefined
  const route = directory instanceof Map ? directory.get(provider) : undefined
  const known = isPlainObject(route)
  // Already pinned, or a protocol that never takes the switch: the 422 is
  // something else and a compat hint would be noise.
  if (known && route.pinned === true) return undefined
  if (known && route.api !== undefined && route.api !== 'openai-completions') return undefined
  return {
    provider,
    known,
    api: known ? route.api : undefined,
    baseURL: known ? route.baseURL : undefined,
    status: typeof failure.status === 'number' ? failure.status : undefined,
    code,
    message: message.slice(0, GATEWAY_MESSAGE_CAP),
  }
}

/**
 * The texts one finding is reported with: a compact card line, the exact fix,
 * and a host-log line that keeps the provider's own wording.
 * @param finding - a {@link classifyGatewayRejection} result.
 * @returns `{ summary, fix, detail }`.
 */
export function gatewayDiagnosisText(finding) {
  const route = finding.provider
  const qualifiers = [finding.api, finding.baseURL].filter((value) => typeof value === 'string' && value !== '')
  const where = qualifiers.length === 0 ? `路由 "${route}"` : `路由 "${route}"（${qualifiers.join(', ')}）`
  const fix = `providers:\n  ${route}:\n    compat:\n      supportsDeveloperRole: false`
  return {
    summary: `${where} 返回 422 invalid_request_error，疑似系统提示词按 developer 角色发出被网关拒绝`
      + ` · 在 llm-pi-ai 该路由上加 compat.supportsDeveloperRole: false，否则长会话会永久 422`,
    fix,
    detail: `provider route "${route}"${finding.api ? ` (api ${finding.api})` : ''}`
      + `${finding.baseURL ? ` at ${finding.baseURL}` : ''} failed with `
      + `${finding.status ?? 'HTTP 422'} ${finding.code || 'INVALID_REQUEST'}: ${finding.message}`
      + `\nIf that gateway is not in pi-ai's shipped catalog, add this to the llm-pi-ai entry config:\n${fix}`,
  }
}

// ── Command Code surface-overflow recovery ───────────────────────────────────
//
// `api.commandcode.ai` — the baseURL behind both the `commandcode` and
// `goat-163` routes — refuses a whole request once its internal path-expansion
// budget is spent. Reproduced against the live gateway on 2026-09-30: the budget
// is 512 candidates consumed at ~2 per tool call, so a request replaying more
// than ~256 tool calls answers
//   400 {"message":"{\"message\":\"a single path expansion cannot exceed 512
//   candidates trace_id: …\",\"type\":\"invalid_request_error\"}"}
// while 200 calls pass and 300 fail. It is NOT about file paths (600 dotted
// paths in plain text pass, yet 600 tool calls whose arguments contain no path
// at all fail), nor images, nor `max_tokens`, nor body size (a single 2 MB
// message and 2 MB of arguments both pass).
//
// DSH already owns exactly one recovery for "the replayed surface is too large":
// `dsh-compaction-basic` listens on this same `agent/request-error` waterfall,
// compacts the replayed prefix into a checkpoint — its overflow path compacts
// with `retainTokens: 0`, so the reduction is maximal — and returns
// `{ kind: 'retry' }`, which makes `dsh-agent-loop` re-issue the step against the
// reduced surface. It acts on `CONTEXT_WINDOW_EXCEEDED` alone, and pi-ai cannot
// produce that code for this wording (it names a gateway budget, not the model's
// window), so without help the failure stays `INVALID_REQUEST`, the turn dies,
// and every later turn in that session dies identically.
//
// The seam is the waterfall itself. `ctx.on(name, listener, { prepend: true })`
// puts this listener in front of every listener registered before it (cordis
// `register()` unshifts), and the waterfall hands every listener the SAME payload
// object — so relabelling `failure.code` here routes the failure into the
// harness's own recovery lane with the provider's message preserved verbatim.
// The relabel is undone whenever the chain does not decide to retry, so a host
// without compaction, or one whose compaction declines, still reports the
// gateway's own failure under its own code. No configuration is written here.

/** The vendor wording that identifies the gateway's spent expansion budget. */
export const SURFACE_OVERFLOW_SIGNATURE = 'a single path expansion cannot exceed 512 candidates'

/** Canonical code the harness already recovers from by compacting and retrying. */
export const SURFACE_OVERFLOW_CODE = 'CONTEXT_WINDOW_EXCEEDED'

/** The adapter code this signature is born with, and the only one relabelled. */
export const SURFACE_OVERFLOW_SOURCE_CODE = 'INVALID_REQUEST'

/**
 * Is this failure the gateway's spent path-expansion budget?
 *
 * Matched on the provider TEXT plus the adapter's own code, never on a status:
 * `dsh-llm-pi-ai`'s `mapStopReason` carries `message` and `code` only. Requiring
 * `INVALID_REQUEST` also degrades cleanly — if the adapter ever learns to
 * classify this wording as an overflow itself, the guard stops firing.
 * @param failure - the waterfall payload's `failure`.
 * @returns true only for that exact signature.
 */
export function isSurfaceOverflowFailure(failure) {
  if (!isPlainObject(failure)) return false
  if (failure.code !== SURFACE_OVERFLOW_SOURCE_CODE) return false
  return typeof failure.message === 'string' && failure.message.includes(SURFACE_OVERFLOW_SIGNATURE)
}

/** Put the original code back once the chain has finished deciding. */
function restoreSurfaceOverflowCode(failure, code, action) {
  failure.code = code
  return action
}

/**
 * Build the `agent/request-error` listener that routes one signature into the
 * harness's own overflow recovery.
 *
 * The listener never decides anything: it relabels the SHARED failure object,
 * delegates through `next()` so `dsh-compaction-basic` sees the code it acts on,
 * and returns THAT listener's action. The relabel is borrowed for exactly the
 * duration of the chain and is restored on every exit — retry, decline and throw
 * alike — so the failure the loop finally acts on is described exactly as the
 * gateway sent it.
 * @param options - `{ isEnabled, onRelabel }`: `isEnabled` gates the relabel on
 *   live settings, `onRelabel` records the recovery for `/status`.
 * @returns the waterfall listener.
 */
export function createSurfaceOverflowHandler(options) {
  const settings = isPlainObject(options) ? options : {}
  const isEnabled = typeof settings.isEnabled === 'function' ? settings.isEnabled : () => true
  const onRelabel = typeof settings.onRelabel === 'function' ? settings.onRelabel : undefined
  return function handleSurfaceOverflow(payload, next) {
    const failure = isPlainObject(payload) ? payload.failure : undefined
    if (!isSurfaceOverflowFailure(failure)) return next()
    if (isEnabled() !== true) return next()
    const originalCode = failure.code
    try {
      failure.code = SURFACE_OVERFLOW_CODE
    } catch (_) {
      // A frozen or accessor-only failure cannot be relabelled: the gateway's own
      // failure stays the honest outcome.
      return next()
    }
    if (onRelabel !== undefined) {
      try {
        onRelabel({
          provider: typeof payload.provider === 'string' ? payload.provider : '',
          message: failure.message,
          code: originalCode,
        })
      } catch (_) {}
    }
    let action
    try {
      action = next()
    } catch (err) {
      failure.code = originalCode
      throw err
    }
    if (action !== null && typeof action === 'object' && typeof action.then === 'function') {
      return action.then(
        (resolved) => restoreSurfaceOverflowCode(failure, originalCode, resolved),
        (err) => {
          failure.code = originalCode
          throw err
        },
      )
    }
    return restoreSurfaceOverflowCode(failure, originalCode, action)
  }
}

// ── plugin ───────────────────────────────────────────────────────────────────

export function apply(ctx, config) {
  const configFile = (config && config.configFile)
    ? path.resolve(process.cwd(), String(config.configFile))
    : path.resolve(process.cwd(), 'plugins', 'tool-adapt.config.json')

  const entry = cloneConfig(DEFAULT_CONFIG)
  let source = () => entry
  const state = {
    fileError: null,
    settingsReady: false,
    migrated: false,
    // Recoveries performed by the surface-overflow relabel, for `/status`.
    surfaceOverflow: { relabeled: 0, last: null },
    get config() {
      return source()
    },
    set config(next) {
      source = () => next
    },
  }

  // Validate an already-projected live config; on any failure fall back to the
  // shipped defaults, exactly like the legacy registration path.
  function liveOrDefault(raw) {
    const validated = validateConfig(raw)
    return validated.ok ? validated.config : entry
  }

  // ── settings transport: two independent hosts ─────────────────────────────
  //
  // ≤ 0.1.5  `ctx.settings.register(namespace, schema, opts)` exists. This plugin
  //          owns the `tool-adapt` namespace, its plain schema is enough, and a
  //          legacy `settings.yaml` may still be migrated into it.
  //
  // ≥ 0.1.7  register() is gone. A settings namespace exists only as the plugin
  //          entry's own `Config` schema (the `static Config` attached to `apply`
  //          at module scope), keyed by the loader entry id — which is
  //          `tool-adapt`, the same key the client half resolves. Only
  //          `.volatile()` fields are exposed, so the entry Config marks the
  //          editable leaves volatile and no schema is registered here. The
  //          settings service writes those fields IN PLACE, without remounting the
  //          entry, so `source` must re-read the parsed `config` argument on every
  //          access rather than cache it. The legacy `settings.yaml` migration does
  //          not apply on this host: the entry Config is the storage.
  //
  // Both branches keep `source` non-throwing and fall back to the shipped
  // defaults; with no settings service at all the legacy JSON file is the store.
  const settingsApi = ctx.get('settings')
  const declarative = settingsApi !== undefined
    && typeof settingsApi.register !== 'function'
    && typeof settingsApi.configure === 'function'

  if (settingsApi === undefined) {
    // No settings transport: the legacy JSON file stays authoritative.
    void loadLegacyFile(ctx, configFile, state)
  }

  ctx.inject(['settings'], (sctx) => {
    if (declarative) {
      try {
        // Suppress the official UI's generated generic page for this entry: the
        // plugin ships its own settings card. `auto: false` only affects that
        // generated page — the namespace still reaches the client mirror, so the
        // custom card keeps working. `configure` throws if called twice for one
        // fiber, so the effect owns the call and disposes it.
        sctx.effect(() => sctx.settings.configure({ auto: false }, ctx.fiber), 'dsh-tool-adapt: settings presentation')
        source = () => liveOrDefault(readDeclarativeConfig(config))
        state.settingsReady = true
        sctx.effect(() => () => {
          state.settingsReady = false
          source = () => entry
        }, 'dsh-tool-adapt: settings fallback')
      } catch (err) {
        state.fileError = String((err && err.message) || err)
        source = () => entry
      }
      return
    }

    if (!settingsApi || typeof settingsApi.register !== 'function') {
      source = () => entry
      return
    }
    try {
      const schema = createSettingsSchema()
      const scope = settingsApi.register(SETTINGS_NS, schema, {
        base: entry,
        applies: 'live',
        validate: (value) => {
          const validated = validateConfig(value)
          if (!validated.ok) throw new Error((validated.errors || []).join('; '))
        },
      })
      source = () => liveOrDefault(scope.get())
      state.settingsReady = true
      sctx.effect(() => scope.watch(() => {}), 'dsh-tool-adapt: settings watch')
      sctx.effect(() => () => {
        state.settingsReady = false
        source = () => entry
      }, 'dsh-tool-adapt: settings fallback')
      void migrateLegacyConfig(sctx, configFile, sctx.settings, state)
    } catch (err) {
      state.fileError = String((err && err.message) || err)
      source = () => entry
    }
  })

  // ── gateway compat: diagnose always, repair only on request ─────────────────
  //
  // The signature and its reasoning live beside `PI_AI_PACKAGE` at module scope.
  // Here we wire the observation and retain what was found, for the surfaces
  // this half owns: the `/status` payload the settings card reads, one host log
  // line per route, and the two deliberate ways to apply the fix.

  const gatewayFindings = new Map() // provider route -> finding + count

  function configurationRows() {
    const editor = ctx.get('configEditor')
    if (editor === undefined || editor === null || typeof editor.configuration !== 'function') return undefined
    try {
      return editor.configuration()
    } catch (_) {
      return undefined
    }
  }

  function gatewaySummary() {
    if (gatewayFindings.size === 0) return null
    const first = gatewayFindings.values().next().value
    const extra = gatewayFindings.size - 1
    return extra > 0 ? first.summary + '（另有 ' + extra + ' 条）' : first.summary
  }

  function observeRequestFailure(payload) {
    if (gatewayFindings.size >= GATEWAY_FINDING_CAP) return
    // Only a route we already reported needs no second lookup.
    const provider = isPlainObject(payload) && typeof payload.provider === 'string' ? payload.provider : ''
    if (provider !== '' && gatewayFindings.has(provider)) {
      gatewayFindings.get(provider).count += 1
      return
    }
    const rows = configurationRows()
    const finding = classifyGatewayRejection(payload, routeDirectory(rows))
    if (finding === undefined) return
    const retained = { ...finding, ...gatewayDiagnosisText(finding), count: 1, attempted: false, fixed: false }
    gatewayFindings.set(finding.provider, retained)
    try {
      if (ctx.logger && typeof ctx.logger.warn === 'function') {
        ctx.logger.warn('dsh-tool-adapt gateway compat: ' + retained.detail)
      }
    } catch (_) {
      // A diagnostic must never break the turn teardown.
    }
    // The unattended path is opt-in and runs at most once per route per process
    // (`attempted`, plus the finding itself blocking a second entry).
    if (state.config.gateway && state.config.gateway.autoRepair === true) {
      void repairGatewayRoute(finding.provider, retained, rows)
    }
  }

  /**
   * Persist the classic instruction role on one route through the host's own
   * config editor. Deliberately narrow: exactly one key, only on a route the
   * profile already declares as `openai-completions`, never on a route that
   * already pins it. Resolves to a plain receipt; it does not throw.
   * @param provider - the provider route key to pin.
   * @param rows - a fresh `configuration()` result, when the caller has one.
   * @returns `{ ok, changed?, note?, error? }`.
   */
  async function applyGatewayFix(provider, rows) {
    if (typeof provider !== 'string' || provider === '' || provider.length > GATEWAY_PROVIDER_CAP) {
      return { ok: false, error: 'a provider route is required' }
    }
    const editor = ctx.get('configEditor')
    if (editor === undefined || editor === null
      || typeof editor.configuration !== 'function' || typeof editor.edit !== 'function') {
      return { ok: false, error: 'this host exposes no config editor; edit the llm-pi-ai entry by hand' }
    }
    let currentRows = rows
    if (!Array.isArray(currentRows)) {
      try {
        currentRows = editor.configuration()
      } catch (err) {
        return { ok: false, error: String((err && err.message) || err) }
      }
    }
    const entry = piAiEntry(currentRows)
    if (entry === undefined) return { ok: false, error: PI_AI_PACKAGE + ' is not an active entry on this profile' }
    const profile = mergedProviderProfiles(currentRows).get(provider)
    if (!isPlainObject(profile)) {
      return { ok: false, error: 'route "' + provider + '" is not declared on ' + PI_AI_PACKAGE }
    }
    if (profile.api !== 'openai-completions') {
      return { ok: false, error: 'route "' + provider + '" speaks "' + String(profile.api) + '", which never takes the developer role' }
    }
    if (isPlainObject(profile.compat) && profile.compat.supportsDeveloperRole === false) {
      return { ok: true, changed: false, note: '该路由已钉住 supportsDeveloperRole: false' }
    }
    try {
      await editor.edit(entry, (current) => withDeveloperRolePinned(current, provider, profile))
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) }
    }
    return { ok: true, changed: true, note: '已写入 llm-pi-ai 的该路由，下一条请求生效' }
  }

  /**
   * Run {@link applyGatewayFix} once for one retained finding and record the
   * outcome on it, so the card can stop offering a button that already ran.
   */
  async function repairGatewayRoute(provider, retained, rows) {
    if (isPlainObject(retained) && retained.attempted === true) return
    if (isPlainObject(retained)) retained.attempted = true
    let receipt
    try {
      receipt = await applyGatewayFix(provider, rows)
    } catch (err) {
      receipt = { ok: false, error: String((err && err.message) || err) }
    }
    if (isPlainObject(retained)) {
      retained.fixed = receipt.ok === true && receipt.changed !== false
      retained.fixNote = receipt.ok === true ? (receipt.note ?? null) : null
      retained.fixError = receipt.ok === true ? null : receipt.error
    }
    return receipt
  }

  // Observe ONLY: the returned action is always the downstream one, so this can
  // never veto a failure, force a retry, or swallow the loop's own decision. The
  // only write it can reach is the opt-in `gateway.autoRepair` path, which goes
  // through `repairGatewayRoute` and not through this listener's return value.
  ctx.on('agent/request-error', (payload, next) => {
    try {
      observeRequestFailure(payload)
    } catch (_) {}
    return next()
  })

  // Route the Command Code expansion-budget rejection into the harness's own
  // overflow lane. `prepend` is the whole mechanism: it puts this listener in
  // front of `dsh-compaction-basic`'s, which is the one that compacts and retries.
  // See the module-scope section above for the measurements and the restore rule.
  const handleSurfaceOverflow = createSurfaceOverflowHandler({
    isEnabled: () => isPlainObject(state.config.surfaceOverflow) && state.config.surfaceOverflow.autoRelabel === true,
    onRelabel: (info) => {
      state.surfaceOverflow.relabeled += 1
      state.surfaceOverflow.last = {
        provider: info.provider.slice(0, GATEWAY_PROVIDER_CAP),
        message: info.message.slice(0, GATEWAY_MESSAGE_CAP),
      }
      try {
        if (ctx.logger && typeof ctx.logger.warn === 'function') {
          ctx.logger.warn('dsh-tool-adapt surface overflow: route "' + (info.provider || '<unknown>')
            + '" exhausted the gateway expansion budget; relabelled ' + info.code + ' as ' + SURFACE_OVERFLOW_CODE
            + ' so dsh-compaction-basic compacts and retries the reduced surface')
        }
      } catch (_) {}
    },
  })
  ctx.on('agent/request-error', handleSurfaceOverflow, { prepend: true })

  const chains = new WeakMap() // agent -> { tool, count } (consecutive failures, any args)

  // THE predicate: is escalation impossible in this session, and why?
  function escalationDeadState(session) {
    if (session === undefined || session === null) return undefined
    const sp = ctx.get('sandboxPolicy')
    if (sp !== undefined) {
      let mode
      try { mode = sp.resolve({ session: session }).mode } catch (_) { mode = undefined }
      if (mode === 'danger-full-access') return { kind: 'full-access' }
    }
    const ap = ctx.get('approval')
    if (ap !== undefined) {
      let policy
      try {
        policy = typeof ap.effectivePolicy === 'function' ? ap.effectivePolicy(session) : undefined
      } catch (_) { policy = undefined }
      if (policy === 'never') return { kind: 'never' }
    }
    return undefined
  }

  function removeEscalationParams(tools) {
    if (!Array.isArray(tools)) return tools
    let anyChanged = false
    const next = tools.map((tool) => {
      if (!tool || !isPlainObject(tool.parameters) || !isPlainObject(tool.parameters.properties)) return tool
      const props = tool.parameters.properties
      if (!('sandbox_permissions' in props) && !('justification' in props)) return tool
      const required = Array.isArray(tool.parameters.required) ? tool.parameters.required : []
      const kept = {}
      let dropped = false
      for (const key of Object.keys(props)) {
        if ((key === 'sandbox_permissions' || key === 'justification') && !required.includes(key)) {
          dropped = true
        } else {
          kept[key] = props[key]
        }
      }
      if (!dropped) return tool
      anyChanged = true
      return { ...tool, parameters: { ...tool.parameters, properties: kept } }
    })
    return anyChanged ? next : tools
  }

  function stripEscalationArgs(exec) {
    const args = exec.arguments
    if (!isPlainObject(args)) return false
    if (!('sandbox_permissions' in args) && !('justification' in args)) return false
    const session = exec.agent && exec.agent.session
    if (escalationDeadState(session) === undefined) return false
    const cleaned = {}
    for (const key of Object.keys(args)) {
      if (key !== 'sandbox_permissions' && key !== 'justification') cleaned[key] = args[key]
    }
    exec.arguments = cleaned
    return true
  }

  ctx.on('tools/execute', (exec, next) => {
    try {
      if (state.config.guard.enabled) stripEscalationArgs(exec)
    } catch (_) {
      // never break the pipeline
    }
    return next()
  })

  // ── L0 veto: pre-execute fuse ─────────────────────────────────────────────

  ctx.on('tools/pre-execute', (exec, next) => {
    try {
      const cfg = state.config.l0
      if (cfg.enabled && cfg.vetoAfter > 0 && exec.agent) {
        const chain = chains.get(exec.agent)
        if (chain !== undefined && chain.tool === exec.name && chain.count >= cfg.vetoAfter) {
          return { kind: 'deny', reason: fill(cfg.vetoText, exec.name, chain.count) }
        }
      }
    } catch (_) {
      // education layer must never break the pipeline
    }
    return next()
  })

  // ── L0: failure counting + reminder injection ─────────────────────────────

  function observeFailure(exec, result) {
    if (!exec.agent) return undefined
    const cfg = state.config.l0
    if (!cfg.enabled) return undefined
    const failed = !!(result && result.isError === true)
    const chain = chains.get(exec.agent)
    if (!failed) {
      if (chain !== undefined) chains.delete(exec.agent)
      return undefined
    }
    const count = chain !== undefined && chain.tool === exec.name ? chain.count + 1 : 1
    chains.set(exec.agent, { tool: exec.name, count })
    // Escalate: remind on the threshold failure and keep reminding on each
    // further consecutive failure within a bounded window.
    if (count < cfg.remindAfter || count > cfg.remindAfter + 4) return undefined
    return makeNotice(fill(cfg.reminderText, exec.name, count), exec.name + ' × ' + count)
  }

  ctx.on('tools/post-execute', async (exec, result, next) => {
    let notice
    try { notice = observeFailure(exec, result) } catch (_) { notice = undefined }
    const downstream = await next()
    if (notice === undefined) return downstream
    if (downstream.kind === 'block') {
      return {
        kind: 'block',
        feedback: downstream.feedback,
        additionalContexts: prepend(notice, downstream.additionalContexts),
      }
    }
    return { ...downstream, additionalContexts: prepend(notice, downstream.additionalContexts) }
  })

  // Reset an agent's chain when a human message starts the step (mirrors
  // repeat-tool-reminder's reset rule).
  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    try {
      if (agent && Array.isArray(messages) && messages.some((m) => m && m.source && m.source.kind === 'user')) {
        chains.delete(agent)
      }
    } catch (_) {}
    return next()
  })

  // ── L2: conventions section, gated by model family ────────────────────────

  function readModelFromSession(context) {
    try {
      const session = context && context.agent && context.agent.session
      if (!session) return undefined
      if (typeof session.requestHeader === 'function') {
        const h = session.requestHeader()
        if (h && h.config && typeof h.config.model === 'string') return h.config.model
      }
      if (typeof session.requestContext === 'function') {
        const rc = session.requestContext()
        if (rc && typeof rc.model === 'string') return rc.model
      }
    } catch (_) {}
    return undefined
  }

  function isExcludedModel(model, patterns) {
    for (const pattern of patterns) {
      if (wildcardToRegExp(pattern).test(model)) return true
    }
    return false
  }

  ctx.systemPrompt.section({
    name: 'adapt:conventions',
    order: 106,
    text: (context) => {
      const cfg = state.config.l2
      if (!cfg || cfg.enabled === false) return ''
      const model = readModelFromSession(context)
      if (model === undefined) return '' // unknown here; the waterfall decides
      return isExcludedModel(model, cfg.excludeModels) ? '' : cfg.block
    },
  })

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const result = await next()
    try {
      const cfg = state.config
      // guard.remove is independent of L2: it reflects session reality, not
      // model-family policy.
      if (cfg.guard.enabled) {
        const session = context.agent && context.agent.session
        if (escalationDeadState(session) !== undefined) {
          result.tools = removeEscalationParams(result.tools)
        }
      }
      const l2 = cfg.l2
      if (!l2 || l2.enabled === false) return result
      let model = result.variables ? result.variables.model : undefined
      if (!model) model = readModelFromSession(context)
      if (!model) return result // unknown: leave the assembly as the provider built it
      const excluded = isExcludedModel(model, l2.excludeModels)
      const present = result.sections.some((s) => s.name === 'adapt:conventions')
      if (excluded && present) {
        result.sections = result.sections.filter((s) => s.name !== 'adapt:conventions')
      } else if (!excluded && !present) {
        // Provider skipped it (model unknown at evaluation time, e.g. the first
        // step of a fresh session); restore the block.
        result.sections = [...result.sections, { name: 'adapt:conventions', text: l2.block }]
      }
      return result
    } catch (_) {
      return result
    }
  })

  // ── web routes (loopback + same-origin fenced) ────────────────────────────

  function json(res, code, data) {
    const body = JSON.stringify(data)
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(body)
  }

  async function readBody(req) {
    const chunks = []
    let total = 0
    for await (const chunk of req) {
      total += chunk.length
      if (total > 8192) throw Object.assign(new Error('request body too large'), { status: 413 })
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  function originAllowed(req) {
    const origin = req.headers.origin
    if (!origin) return true
    const host = req.headers.host || ''
    const base = /^https?:\/\/([^/]+)/i.exec(origin)
    if (!base) return false
    return base[1] === host
  }

  function hostAllowed(req) {
    let host = (req.headers.host || '').split(':')[0].toLowerCase()
    host = host.replace(/^\[|\]$/g, '')
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/tool-adapt/status',
    handler: (req, res) => {
      try {
        json(res, 200, {
          ok: true,
          config: state.config,
          configFile,
          fileError: state.fileError,
          settingsReady: !!state.settingsReady,
          migrated: !!state.migrated,
          // Detached scalars only: the client renders these, never the live map.
          surfaceOverflow: {
            relabeled: state.surfaceOverflow.relabeled,
            last: state.surfaceOverflow.last === null ? null : {
              provider: state.surfaceOverflow.last.provider,
              message: state.surfaceOverflow.last.message,
            },
          },
          gateway: {
            summary: gatewaySummary(),
            findings: [...gatewayFindings.values()].map((finding) => ({
              provider: finding.provider,
              api: finding.api,
              baseURL: finding.baseURL,
              status: finding.status,
              code: finding.code,
              message: finding.message,
              count: finding.count,
              fix: finding.fix,
              attempted: finding.attempted,
              fixed: finding.fixed,
              fixNote: finding.fixNote ?? null,
              fixError: finding.fixError ?? null,
            })),
          },
        })
      } catch (err) {
        json(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }), 'dsh-tool-adapt: status route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/tool-adapt/set',
    handler: async (req, res) => {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST required' })
      if (!hostAllowed(req)) return json(res, 403, { ok: false, error: 'host not allowed' })
      if (!originAllowed(req)) return json(res, 403, { ok: false, error: 'origin not allowed' })
      try {
        let body
        try {
          body = JSON.parse((await readBody(req)) || '{}')
        } catch (err) {
          if (err && err.status === 413) return json(res, 413, { ok: false, error: 'request body too large' })
          return json(res, 400, { ok: false, error: 'invalid JSON body' })
        }
        const validated = validateConfig(body)
        if (!validated.ok) return json(res, 400, { ok: false, errors: validated.errors })
        const liveSettings = ctx.get('settings')
        if (liveSettings !== undefined) {
          await liveSettings.replace(SETTINGS_NS, validated.config)
        } else {
          const target = await ctx.fs.resolve(configFile)
          await ctx.fs.writeText(target, JSON.stringify(validated.config, null, 2) + '\n')
          state.config = validated.config
        }
        state.fileError = null
        json(res, 200, { ok: true, applied: state.config })
      } catch (err) {
        json(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }), 'dsh-tool-adapt: set route')

  // The explicit half of the gateway repair: the card's 「应用修复」 button. A
  // deliberate user action, so unlike `gateway.autoRepair` it needs no switch —
  // but it is still fenced exactly like the settings route, and it can only ever
  // touch the one compat key of one already-declared route.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/tool-adapt/gateway-fix',
    handler: async (req, res) => {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST required' })
      if (!hostAllowed(req)) return json(res, 403, { ok: false, error: 'host not allowed' })
      if (!originAllowed(req)) return json(res, 403, { ok: false, error: 'origin not allowed' })
      try {
        let body
        try {
          body = JSON.parse((await readBody(req)) || '{}')
        } catch (err) {
          if (err && err.status === 413) return json(res, 413, { ok: false, error: 'request body too large' })
          return json(res, 400, { ok: false, error: 'invalid JSON body' })
        }
        const provider = isPlainObject(body) ? body.provider : undefined
        if (typeof provider !== 'string' || provider === '' || provider.length > GATEWAY_PROVIDER_CAP) {
          return json(res, 400, { ok: false, error: 'provider required' })
        }
        const retained = gatewayFindings.get(provider)
        const receipt = await repairGatewayRoute(provider, retained)
        json(res, receipt.ok ? 200 : 409, receipt)
      } catch (err) {
        json(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }), 'dsh-tool-adapt: gateway fix route')
}

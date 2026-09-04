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
  userSectionEmpty,
  validateConfig,
} from './config.js'

export { DEFAULT_CONFIG, SETTINGS_NS, validateConfig } from './config.js'

export const name = 'dsh-tool-adapt'
export const inject = ['webServer', 'fs', 'systemPrompt']

function createSettingsSchema() {
  return Schema.object({
    guard: Schema.object({
      enabled: Schema.boolean().default(DEFAULT_CONFIG.guard.enabled),
    }).default(cloneConfig(DEFAULT_CONFIG.guard)),
    l2: Schema.object({
      enabled: Schema.boolean().default(DEFAULT_CONFIG.l2.enabled),
      excludeModels: Schema.array(Schema.string().pattern(/^[A-Za-z0-9.*_-]{1,64}$/)).max(50).default(DEFAULT_CONFIG.l2.excludeModels.slice()),
      block: Schema.string().min(1).max(4000).default(DEFAULT_CONFIG.l2.block),
    }).default(cloneConfig(DEFAULT_CONFIG.l2)),
    l0: Schema.object({
      enabled: Schema.boolean().default(DEFAULT_CONFIG.l0.enabled),
      remindAfter: Schema.number().step(1).min(2).max(20).default(DEFAULT_CONFIG.l0.remindAfter),
      vetoAfter: Schema.number().step(1).min(0).max(20).default(DEFAULT_CONFIG.l0.vetoAfter),
      reminderText: Schema.string().min(1).max(2000).default(DEFAULT_CONFIG.l0.reminderText),
      vetoText: Schema.string().min(1).max(2000).default(DEFAULT_CONFIG.l0.vetoText),
    }).default(cloneConfig(DEFAULT_CONFIG.l0)),
    ui: Schema.object({
      pill: Schema.boolean().default(DEFAULT_CONFIG.ui.pill),
    }).default(cloneConfig(DEFAULT_CONFIG.ui)),
  })
}

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
    get config() {
      return source()
    },
    set config(next) {
      source = () => next
    },
  }

  if (ctx.get('settings') === undefined) {
    void loadLegacyFile(ctx, configFile, state)
  }

  ctx.inject(['settings'], (sctx) => {
    try {
      const schema = createSettingsSchema()
      const scope = sctx.settings.register(SETTINGS_NS, schema, {
        base: entry,
        applies: 'live',
        validate: (value) => {
          const validated = validateConfig(value)
          if (!validated.ok) throw new Error((validated.errors || []).join('; '))
        },
      })
      source = () => {
        const resolved = scope.get()
        const validated = validateConfig(resolved)
        return validated.ok ? validated.config : entry
      }
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
}

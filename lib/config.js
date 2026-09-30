// Shared config contract for dsh-tool-adapt.
// Nested runtime shape stays the same as the historical JSON file.
// Official Settings Card writes the same nested section through path mutate.

export const SETTINGS_NS = 'tool-adapt'
export const MIGRATED_MARK = 'tool-adapt.config.migrated'

export const DEFAULT_CONFIG = {
  guard: {
    enabled: true,
  },
  l2: {
    enabled: true,
    excludeModels: ['deepseek-*'],
    block:
      'DSH tool-call conventions:\n' +
      '- Tool parameters named `sandbox_permissions` / `justification` exist only in sessions that can grant escalation. If they are absent from a tool schema in this session, escalation is impossible here: never send them — the environment will ignore them and the call runs at the session\'s current access level.\n' +
      '- Read a file before editing it; anchor `edit` with an exact `old_string`.\n' +
      '- Only tools in the CURRENT tool list exist. A tool name remembered from earlier history (for example a removed dynamic tool) is gone: if a call returns UNKNOWN_TOOL, never retry that name.\n' +
      '- Error texts are instructions: do exactly what they say.',
  },
  l0: {
    enabled: true,
    remindAfter: 2,
    vetoAfter: 0,
    reminderText:
      'Loop-breaker: tool {tool} has now failed {count} times in a row with different arguments. Stop retrying. Read the latest error text and follow it exactly. If no fix is obvious, stop and ask the user instead of retrying.',
    vetoText:
      'Loop-breaker veto: tool {tool} has failed {count} consecutive times, so this call is blocked. Read the latest error text and change your approach, or stop and ask the user before retrying.',
  },
  // UI surface (no pipeline effect). The composer pill stays hidden until the
  // user flips ui.pill on under 设置 → 插件 → ADAPT.
  ui: {
    pill: false,
  },
  // Gateway compat. Diagnosis is always on and free (it only observes a failed
  // request); PERSISTING the one-line fix is not, so it is off by default. The
  // settings card's explicit 「应用修复」 button works either way — this flag only
  // owns the unattended path.
  gateway: {
    autoRepair: false,
  },
  // Command Code (api.commandcode.ai — the baseURL behind both `commandcode` and
  // `goat-163`) refuses a whole request once its internal path-expansion budget is
  // spent. Measured against the live gateway on 2026-09-30: the budget is 512
  // candidates consumed at ~2 per tool call, so a request replaying more than
  // ~256 tool calls answers 400 `a single path expansion cannot exceed 512
  // candidates` — 200 calls pass, 300 fail, and paths in the text, image count,
  // max_tokens and body size (tested to 2 MB) are all irrelevant.
  //
  // DSH already owns exactly one recovery for "the replayed surface is too large":
  // dsh-compaction-basic's agent/request-error listener compacts the replayed
  // prefix to a checkpoint and returns { kind: 'retry' }, which makes the loop
  // re-issue the step against the reduced surface. It acts on
  // CONTEXT_WINDOW_EXCEEDED only, and pi-ai cannot classify this wording (it names
  // a gateway budget, not the model's window), so the failure is born
  // INVALID_REQUEST and the turn dies. This switch lets the host relabel exactly
  // that one signature into the existing lane at the waterfall, restoring the
  // original code whenever the chain does not decide to retry.
  surfaceOverflow: {
    autoRelabel: true,
  },
}

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function checkText(errors, path, value, fallback, cap) {
  if (value === undefined) return fallback
  if (typeof value === 'string' && value.length > 0 && value.length <= cap) return value
  errors.push(path + ' must be a non-empty string <= ' + cap + ' chars')
  return fallback
}

function checkBool(errors, path, value, fallback) {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  errors.push(path + ' must be a boolean')
  return fallback
}

function checkInt(errors, path, value, fallback, min, max) {
  if (value === undefined) return fallback
  if (Number.isInteger(value) && value >= min && value <= max) return value
  errors.push(path + ' must be an integer in [' + min + ', ' + max + ']')
  return fallback
}

function checkModelPatterns(errors, path, value, fallback) {
  if (value === undefined) return fallback.slice()
  if (!Array.isArray(value) || value.length > 50) {
    errors.push(path + ' must be an array of <= 50 entries')
    return fallback.slice()
  }
  const out = []
  for (const entry of value) {
    if (typeof entry === 'string' && /^[A-Za-z0-9.*_-]{1,64}$/.test(entry)) out.push(entry)
    else errors.push(path + ' entries must match [A-Za-z0-9.*_-]{1,64}')
  }
  return out
}

export function validateConfig(raw) {
  if (!isPlainObject(raw)) return { ok: false, errors: ['config must be a JSON object'] }
  const errors = []
  for (const key of Object.keys(raw)) {
    if (key !== 'guard' && key !== 'l2' && key !== 'l0' && key !== 'ui' && key !== 'gateway' && key !== 'surfaceOverflow') errors.push('unknown top-level key: ' + key)
  }
  const d = DEFAULT_CONFIG
  const guardRaw = isPlainObject(raw.guard) ? raw.guard : {}
  const l2raw = isPlainObject(raw.l2) ? raw.l2 : {}
  const l0raw = isPlainObject(raw.l0) ? raw.l0 : {}
  const uiraw = isPlainObject(raw.ui) ? raw.ui : {}
  const gatewayRaw = isPlainObject(raw.gateway) ? raw.gateway : {}
  const surfaceRaw = isPlainObject(raw.surfaceOverflow) ? raw.surfaceOverflow : {}
  if (raw.guard !== undefined && !isPlainObject(raw.guard)) errors.push('guard must be an object')
  if (raw.l2 !== undefined && !isPlainObject(raw.l2)) errors.push('l2 must be an object')
  if (raw.l0 !== undefined && !isPlainObject(raw.l0)) errors.push('l0 must be an object')
  if (raw.ui !== undefined && !isPlainObject(raw.ui)) errors.push('ui must be an object')
  if (raw.gateway !== undefined && !isPlainObject(raw.gateway)) errors.push('gateway must be an object')
  if (raw.surfaceOverflow !== undefined && !isPlainObject(raw.surfaceOverflow)) errors.push('surfaceOverflow must be an object')
  const config = {
    guard: {
      enabled: checkBool(errors, 'guard.enabled', guardRaw.enabled, d.guard.enabled),
    },
    l2: {
      enabled: checkBool(errors, 'l2.enabled', l2raw.enabled, d.l2.enabled),
      excludeModels: checkModelPatterns(errors, 'l2.excludeModels', l2raw.excludeModels, d.l2.excludeModels),
      block: checkText(errors, 'l2.block', l2raw.block, d.l2.block, 4000),
    },
    l0: {
      enabled: checkBool(errors, 'l0.enabled', l0raw.enabled, d.l0.enabled),
      remindAfter: checkInt(errors, 'l0.remindAfter', l0raw.remindAfter, d.l0.remindAfter, 2, 20),
      vetoAfter: checkInt(errors, 'l0.vetoAfter', l0raw.vetoAfter, d.l0.vetoAfter, 0, 20),
      reminderText: checkText(errors, 'l0.reminderText', l0raw.reminderText, d.l0.reminderText, 2000),
      vetoText: checkText(errors, 'l0.vetoText', l0raw.vetoText, d.l0.vetoText, 2000),
    },
    ui: {
      pill: checkBool(errors, 'ui.pill', uiraw.pill, d.ui.pill),
    },
    gateway: {
      autoRepair: checkBool(errors, 'gateway.autoRepair', gatewayRaw.autoRepair, d.gateway.autoRepair),
    },
    surfaceOverflow: {
      autoRelabel: checkBool(errors, 'surfaceOverflow.autoRelabel', surfaceRaw.autoRelabel, d.surfaceOverflow.autoRelabel),
    },
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, config }
}

export function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config || DEFAULT_CONFIG))
}

export function userSectionEmpty(user) {
  if (!isPlainObject(user)) return true
  return Object.keys(user).length === 0
}

export function parseExcludeModels(text) {
  if (typeof text !== 'string') return []
  return text.split(',').map((s) => s.trim()).filter(Boolean)
}

export function formatExcludeModels(list) {
  return Array.isArray(list) ? list.join(',') : ''
}

export function fieldAt(section, path) {
  let cur = section
  for (const key of path) {
    if (!isPlainObject(cur) || !(key in cur)) return undefined
    cur = cur[key]
  }
  return cur
}

export function userOverridesPath(user, path) {
  return fieldAt(user, path) !== undefined
}

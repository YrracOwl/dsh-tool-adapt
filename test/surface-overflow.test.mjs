import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  SURFACE_OVERFLOW_CODE,
  SURFACE_OVERFLOW_SIGNATURE,
  SURFACE_OVERFLOW_SOURCE_CODE,
  createSurfaceOverflowHandler,
  isSurfaceOverflowFailure,
} from '../lib/index.js'

const indexSource = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
const clientSource = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

// The exact failure `dsh-llm-pi-ai` produces for the reproduced gateway refusal:
// `classifyPiAiError` sees the "400" in the text and yields INVALID_REQUEST.
const REAL_MESSAGE = '400: {"message":"{\\"message\\":\\"a single path expansion cannot exceed 512 candidates trace_id: 123102932fc9f5d27e29ca332efa1fd8\\",\\"type\\":\\"invalid_request_error\\"}\\n","type":"invalid_request_error"}'

function realFailure() {
  return { message: REAL_MESSAGE, code: 'INVALID_REQUEST' }
}

function payload(failure, provider = 'goat-163') {
  return { turn: 34, step: 8, provider, failure, signal: { aborted: false } }
}

/**
 * Stand-in for the rest of the `agent/request-error` waterfall. `next` records
 * the code the chain was handed — that is exactly what `dsh-compaction-basic`'s
 * real listener branches on — and returns the scripted action.
 */
function downstream(failure, action) {
  const seen = []
  const next = () => {
    seen.push(failure.code)
    return typeof action === 'function' ? action() : action
  }
  return { next, seen }
}

// ── isSurfaceOverflowFailure ────────────────────────────────────────────────

test('the reproduced gateway refusal is the signature', () => {
  assert.equal(SURFACE_OVERFLOW_SIGNATURE, 'a single path expansion cannot exceed 512 candidates')
  assert.equal(SURFACE_OVERFLOW_SOURCE_CODE, 'INVALID_REQUEST')
  assert.equal(SURFACE_OVERFLOW_CODE, 'CONTEXT_WINDOW_EXCEEDED')
  assert.equal(isSurfaceOverflowFailure(realFailure()), true)
  // The message is what carries the vendor wording; the code is the adapter's own.
  assert.equal(isSurfaceOverflowFailure({ ...realFailure(), message: REAL_MESSAGE.slice(0, 40) }), false)
})

test('only that text, and only while the adapter still codes it INVALID_REQUEST', () => {
  assert.equal(isSurfaceOverflowFailure({ message: 'a single path expansion can exceed 512 candidates', code: 'INVALID_REQUEST' }), false)
  assert.equal(isSurfaceOverflowFailure({ message: REAL_MESSAGE, code: 'CONTEXT_WINDOW_EXCEEDED' }), false)
  assert.equal(isSurfaceOverflowFailure({ message: REAL_MESSAGE }), false)
  assert.equal(isSurfaceOverflowFailure({ message: REAL_MESSAGE, code: 'SERVER' }), false)
  assert.equal(isSurfaceOverflowFailure({ message: 512, code: 'INVALID_REQUEST' }), false)
  assert.equal(isSurfaceOverflowFailure(undefined), false)
  assert.equal(isSurfaceOverflowFailure(null), false)
  assert.equal(isSurfaceOverflowFailure('a single path expansion cannot exceed 512 candidates'), false)
  assert.equal(isSurfaceOverflowFailure([]), false)
})

// ── the handler: borrow the code, delegate, give it back ────────────────────

test('a compaction-style downstream is handed the code it acts on and its retry is propagated', () => {
  const failure = realFailure()
  const { next, seen } = downstream(failure, { kind: 'retry' })
  const relabels = []
  const handle = createSurfaceOverflowHandler({ onRelabel: (info) => relabels.push(info) })

  assert.deepEqual(handle(payload(failure), next), { kind: 'retry' })
  assert.deepEqual(seen, ['CONTEXT_WINDOW_EXCEEDED'], 'the downstream must see the recoverable code')
  assert.equal(relabels.length, 1)
  assert.equal(relabels[0].provider, 'goat-163')
  assert.equal(relabels[0].code, 'INVALID_REQUEST')
  // Borrowed for the chain only: the retry discards this failure, and anything
  // that reads it afterwards still sees the gateway's own code.
  assert.equal(failure.code, 'INVALID_REQUEST')
})

test('a chain that declines leaves the failure exactly as the gateway sent it', () => {
  const failure = realFailure()
  const { next, seen } = downstream(failure, undefined)
  assert.equal(createSurfaceOverflowHandler({})(payload(failure), next), undefined)
  assert.deepEqual(seen, ['CONTEXT_WINDOW_EXCEEDED'])
  assert.equal(failure.code, 'INVALID_REQUEST')
})

test('an async downstream is awaited, and the code is restored when it settles', async () => {
  const failure = realFailure()
  let duringChain = 'unset'
  const outcome = await createSurfaceOverflowHandler({})(payload(failure), () => new Promise((resolve) => {
    duringChain = failure.code
    resolve({ kind: 'retry' })
  }))
  assert.deepEqual(outcome, { kind: 'retry' })
  assert.equal(duringChain, 'CONTEXT_WINDOW_EXCEEDED', 'the relabel must be live while the chain decides')
  assert.equal(failure.code, 'INVALID_REQUEST')

  const declined = realFailure()
  assert.equal(await createSurfaceOverflowHandler({})(payload(declined), async () => undefined), undefined)
  assert.equal(declined.code, 'INVALID_REQUEST')
})

test('a throwing chain restores the code before the error escapes', async () => {
  const sync = realFailure()
  assert.throws(
    () => createSurfaceOverflowHandler({})(payload(sync), () => { throw new Error('boom') }),
    /boom/,
  )
  assert.equal(sync.code, 'INVALID_REQUEST')

  const asyncFailure = realFailure()
  await assert.rejects(
    () => createSurfaceOverflowHandler({})(payload(asyncFailure), async () => { throw new Error('async boom') }),
    /async boom/,
  )
  assert.equal(asyncFailure.code, 'INVALID_REQUEST')
})

test('the switch gates the relabel, and a live flip reaches the very next failure', () => {
  const failure = realFailure()
  const off = downstream(failure, undefined)
  const relabels = []
  assert.equal(
    createSurfaceOverflowHandler({ isEnabled: () => false, onRelabel: (info) => relabels.push(info) })(payload(failure), off.next),
    undefined,
  )
  assert.deepEqual(off.seen, ['INVALID_REQUEST'], 'with the switch off the code is never touched')
  assert.deepEqual(relabels, [])

  let enabled = true
  const live = createSurfaceOverflowHandler({ isEnabled: () => enabled })
  const first = realFailure()
  assert.deepEqual(live(payload(first), downstream(first, { kind: 'retry' }).next), { kind: 'retry' })
  enabled = false
  const second = realFailure()
  const offChain = downstream(second, { kind: 'retry' })
  assert.deepEqual(live(payload(second), offChain.next), { kind: 'retry' })
  assert.deepEqual(offChain.seen, ['INVALID_REQUEST'])
})

test('every other failure passes through byte-for-byte', () => {
  for (const failure of [
    { message: '429 rate limit', code: 'RATE_LIMIT' },
    { message: '422 invalid_request_error', code: 'INVALID_REQUEST' },
    { message: REAL_MESSAGE, code: 'CONTEXT_WINDOW_EXCEEDED' },
  ]) {
    const before = { ...failure }
    const { next, seen } = downstream(failure, undefined)
    assert.equal(createSurfaceOverflowHandler({})(payload(failure), next), undefined)
    assert.deepEqual(seen, [before.code])
    assert.deepEqual(failure, before)
  }
})

test('an unrelabellable failure falls back to the gateway wording instead of throwing', () => {
  const frozen = Object.freeze(realFailure())
  const frozenChain = downstream(frozen, { kind: 'retry' })
  // The chain still runs and its action still wins; only the relabel is skipped.
  assert.deepEqual(createSurfaceOverflowHandler({})(payload(frozen), frozenChain.next), { kind: 'retry' })
  assert.deepEqual(frozenChain.seen, ['INVALID_REQUEST'])

  const hostile = {}
  Object.defineProperty(hostile, 'message', { value: REAL_MESSAGE, enumerable: true })
  Object.defineProperty(hostile, 'code', { get: () => 'INVALID_REQUEST', set: () => { throw new Error('read-only') } })
  const hostileChain = downstream(hostile, { kind: 'retry' })
  assert.deepEqual(createSurfaceOverflowHandler({})(payload(hostile), hostileChain.next), { kind: 'retry' })
  assert.deepEqual(hostileChain.seen, ['INVALID_REQUEST'])
})

test('a failing onRelabel hook cannot break the recovery', () => {
  const failure = realFailure()
  const { next } = downstream(failure, { kind: 'retry' })
  const handle = createSurfaceOverflowHandler({ onRelabel: () => { throw new Error('logger down') } })
  assert.deepEqual(handle(payload(failure), next), { kind: 'retry' })
})

// ── ordering: a faithful replica of cordis's waterfall ──────────────────────

// Copied from `@deepseek-ai/cordis/src/events.ts`: `dispatch()` returns the
// listeners in registration order, `register()` unshifts on `prepend`, and the
// composer hands every listener the SAME argument list (so the payload object is
// shared). Reproducing it here is what makes the `prepend` requirement testable
// without a live host: with prepend the relabel reaches the compaction listener,
// without it the compaction listener has already declined.
//
// Two host facts this depends on, both read from the shipped sources:
//   - `dsh-compaction-basic` registers its `agent/request-error` listener by
//     APPEND, so an unshifted listener is ahead of it;
//   - a listener on an UNTAGGED context is admitted to every scope
//     (`dsh-scope`'s `scopeTarget`: `scopeOf(ctx) === undefined → true`), which is
//     why this plugin's own root-context listener sees agent-scoped events at all.
function waterfall(hooks, ...args) {
  const cbs = hooks.slice()
  const inner = args.pop()
  const next = () => {
    const cb = cbs.shift() ?? inner
    return cb(...args)
  }
  args.push(next)
  return next()
}

function compactionListener(payload, next) {
  if (payload.failure.code !== SURFACE_OVERFLOW_CODE) return next()
  return { kind: 'retry' }
}

test('the relabel reaches a compaction-style listener only because it is prepended', () => {
  const failure = realFailure()
  const payloadObject = payload(failure)
  const observe = (_, next) => next()
  const handle = createSurfaceOverflowHandler({})

  const withPrepend = [observe]
  withPrepend.unshift(handle) // cordis `register()` on { prepend: true }
  withPrepend.push(compactionListener)
  assert.deepEqual(waterfall(withPrepend, payloadObject, () => undefined), { kind: 'retry' })
  assert.equal(failure.code, 'INVALID_REQUEST')

  // Negative control: the same listener appended behind the compaction one is a
  // no-op — the compaction listener sees INVALID_REQUEST, declines, and the turn
  // dies exactly as it did before this fix.
  const withoutPrepend = [observe, compactionListener, handle]
  const declined = realFailure()
  assert.equal(waterfall(withoutPrepend, payload(declined), () => undefined), undefined)
  assert.equal(declined.code, 'INVALID_REQUEST')
})

// ── wiring guards: the recovery must reach compaction-basic ─────────────────

test('the listener is registered with prepend, which is the whole mechanism', () => {
  // cordis runs waterfall listeners in registration order and `register()`
  // unshifts on `prepend`, so this is what puts the relabel in front of
  // dsh-compaction-basic's own listener. Without it the relabel would arrive
  // after that listener already declined, and the recovery would be a no-op.
  assert.match(indexSource, /ctx\.on\('agent\/request-error', handleSurfaceOverflow, \{ prepend: true \}\)/)
  assert.match(indexSource, /dsh-compaction-basic/)
})

test('the relabel is gated on live settings and never writes configuration', () => {
  assert.match(indexSource, /isPlainObject\(state\.config\.surfaceOverflow\) && state\.config\.surfaceOverflow\.autoRelabel === true/)
  // The package still owns exactly one configuration write (the 422 compat fix).
  assert.equal((indexSource.match(/\.edit\(/g) || []).length, 1)
  assert.doesNotMatch(indexSource, /editor\.edit\([^)]*surfaceOverflow/)
})

test('the recovery is observable on /status and on the settings card', () => {
  assert.match(indexSource, /surfaceOverflow: \{\s*\n\s*relabeled: state\.surfaceOverflow\.relabeled/)
  assert.match(indexSource, /relabeled: 0, last: null/)
  assert.match(clientSource, /path: \['surfaceOverflow', 'autoRelabel'\]/)
  assert.match(clientSource, /data\.surfaceOverflow && data\.surfaceOverflow\.relabeled > 0/)
})

test('the observe-only listener stays separate and stays observe-only', () => {
  assert.equal([...indexSource.matchAll(/ctx\.on\('agent\/request-error'/g)].length, 2, 'one observer plus the one relabel listener')
  // The observer is still the first registration in source order, still returns
  // the downstream action and never decides.
  const observer = indexSource.slice(indexSource.indexOf("ctx.on('agent/request-error'"))
  const body = observer.slice(0, observer.indexOf('})'))
  assert.match(body, /observeRequestFailure\(payload\)/)
  assert.match(body, /return next\(\)/)
  assert.doesNotMatch(body, /kind: 'retry'/)
})

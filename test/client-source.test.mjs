import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

// ── Settings card (behavior unchanged) ───────────────────────────────────────

test('client registers an official-style expandable plugin card', () => {
  assert.match(source, /settings\.plugin\.item/)
  assert.match(source, /key: NS/)
  assert.match(source, /function SettingsCard/)
  assert.match(source, /e\('li'/)
  assert.match(source, /dtaCard/)
  assert.match(source, /dtaPending/)
  assert.match(source, /未保存/)
  assert.match(source, /放弃修改/)
  assert.match(source, /已覆盖/)
  assert.match(source, /恢复默认/)
  assert.match(source, /exports\.inject = \['slots', 'settingsScope', 'remote', 'remote\.settings'\]/)
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
  assert.ok(source.indexOf("ctx.slots.inject('settings.plugin.item'") < source.indexOf('ctx.effect(() => startPill(scope)'))
  assert.match(source, /return disposeSlot/)
})

// ── pill mounting: seat-only, no body fallback ──────────────────────────────

test('pill mounts only under the composer seat and waits for it', () => {
  assert.match(source, /ctx\.effect\(\(\) => startPill\(scope\)/)
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
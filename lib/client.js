// dsh-tool-adapt — client half (official __ModuleLoader__ web bundle)
//
// Browser-only bundle: consumed by the DSH web loader (window.__ModuleLoader__).
// Not importable in Node. Renders the ADAPT status pill and an official-style
// expandable Settings Card under settings.plugin.item / key tool-adapt.
//
// The pill is hidden by DEFAULT: the ui.pill switch in the Settings Card
// (设置 → 插件 → ADAPT「显示状态胶囊」) owns visibility; the polled /status
// config is the hot source of truth the pill follows.
//
// Lifecycle contract: every client side effect — the pill mounted flag, root
// element, shadow DOM, plugin-card style tag, MutationObserver, ResizeObserver,
// both intervals, the pending animation frame, and every window / document /
// element / pointer / drag listener — is owned by the Cordis fiber through
// ctx.effect() and released by the returned disposer. Cleanup is idempotent,
// so stop / update / HMR can dispose the bundle and a later apply re-mounts
// the pill from scratch.

window.__ModuleLoader__.load({
  id: 'dsh-tool-adapt',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    const NS = 'tool-adapt'
    const API = '/api/tool-adapt'
    const POLL_MS = 5000
    const e = React.createElement

    const FIELDS = [
      { path: ['ui', 'pill'], kind: 'bool', label: '显示状态胶囊', hint: '默认关闭。开启后输入框旁显示 ADAPT 胶囊；关闭只隐藏 UI，守卫逻辑不受影响。' },
      { path: ['guard', 'enabled'], kind: 'bool', label: '守卫启用', hint: '提权死状态下移除 schema 参数，并剥除仍携带的字段。' },
      { path: ['l2', 'enabled'], kind: 'bool', label: 'L2 惯例预装', hint: '向非排除模型注入 DSH 工具调用惯例。' },
      { path: ['l2', 'excludeModels'], kind: 'models', label: '排除模型', hint: '逗号分隔的 * 通配模式，默认 deepseek-*。' },
      { path: ['l2', 'block'], kind: 'textarea', label: '惯例块' },
      { path: ['l0', 'enabled'], kind: 'bool', label: 'L0 失败保险丝' },
      { path: ['l0', 'remindAfter'], kind: 'num', label: '提醒阈值', min: 2, max: 20 },
      { path: ['l0', 'vetoAfter'], kind: 'num', label: 'veto 阈值', min: 0, max: 20, hint: '0 表示关闭 veto。' },
      { path: ['l0', 'reminderText'], kind: 'textarea', label: '提醒文案' },
      { path: ['l0', 'vetoText'], kind: 'textarea', label: 'veto 文案' },
    ]

    function isPlainObject(v) {
      return v !== null && typeof v === 'object' && !Array.isArray(v)
    }

    function getAt(obj, path) {
      let cur = obj
      for (const key of path) {
        if (!isPlainObject(cur) || !(key in cur)) return undefined
        cur = cur[key]
      }
      return cur
    }

    function formatValue(field, value) {
      if (field.kind === 'bool') return value ? 'true' : 'false'
      if (field.kind === 'models') return Array.isArray(value) ? value.join(',') : ''
      if (value === undefined || value === null) return ''
      return String(value)
    }

    function parseValue(field, text) {
      if (field.kind === 'bool') return text === true || text === 'true'
      if (field.kind === 'models') {
        const list = String(text || '').split(',').map((s) => s.trim()).filter(Boolean)
        if (list.length > 50) return undefined
        for (const entry of list) {
          if (!/^[A-Za-z0-9.*_-]{1,64}$/.test(entry)) return undefined
        }
        return list
      }
      if (field.kind === 'num') {
        const n = Number.parseInt(String(text), 10)
        if (!Number.isInteger(n)) return undefined
        if (field.min !== undefined && n < field.min) return undefined
        if (field.max !== undefined && n > field.max) return undefined
        return n
      }
      const s = String(text || '')
      if (!s) return undefined
      if (field.path[1] === 'block' && s.length > 4000) return undefined
      if ((field.path[1] === 'reminderText' || field.path[1] === 'vetoText') && s.length > 2000) return undefined
      return s
    }

    function fieldKey(path) {
      return path.join('.')
    }

    // Official PluginCard / field chrome cannot be imported by an out-of-repo
    // plugin (bundle purity). Recreate the same disclosure card so ADAPT sits
    // in the Plugins list as one expandable <li> beside Shell / Agent loop.
    const CARD_CSS_ID = 'dsh-tool-adapt/plugin-card'
    const CARD_CSS = [
      '.dtaCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}',
      '.dtaCard:hover{border-color:var(--dsw-alias-label-dimmed)}',
      '.dtaCardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
      '.dtaHeader{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}',
      '.dtaHeader:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dtaHeadText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}',
      '.dtaName{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}',
      '.dtaDescription{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}',
      '.dtaChevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}',
      '.dtaChevronOpen{transform:rotate(180deg)}',
      '.dtaBody{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}',
      '.dtaReadOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}',
      '.dtaPending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}',
      '.dtaFooter{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}',
      '.dtaFailed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}',
      '.dtaDiscard,.dtaSave{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}',
      '.dtaDiscard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}',
      '.dtaDiscard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
      '.dtaSave{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
      '.dtaDiscard:disabled,.dtaSave:disabled{opacity:.4;cursor:default}',
      '.dtaDiscard:focus-visible,.dtaSave:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dtaField{flex-direction:column;gap:6px;padding:12px 0;display:flex}',
      '.dtaField+.dtaField{border-top:1px solid var(--dsw-alias-border-l2)}',
      '.dtaFieldHead{align-items:center;gap:8px;display:flex}',
      '.dtaLabel{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}',
      '.dtaBadges{align-items:center;gap:8px;display:inline-flex}',
      '.dtaBadge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}',
      '.dtaReset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}',
      '.dtaReset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
      '.dtaReset:disabled{cursor:default}',
      '.dtaInput,.dtaTextarea{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box}',
      '.dtaInput{height:34px;padding:0 12px}',
      '.dtaTextarea{min-height:88px;padding:8px 12px;resize:vertical}',
      '.dtaInput:focus-visible,.dtaTextarea:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}',
      '.dtaInput:disabled,.dtaTextarea:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
      '.dtaInputInvalid{border-color:var(--dsw-alias-label-error)}',
      '.dtaInvalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}',
      '.dtaHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}',
      '.dtaSwitch{appearance:none;width:36px;height:20px;margin:0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-3);position:relative;cursor:pointer;flex:none}',
      '.dtaSwitch::after{content:"";width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);position:absolute;top:2px;left:2px;transition:transform .16s,background .16s}',
      '.dtaSwitch:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.dtaSwitch:checked::after{background:var(--dsw-alias-bg-layer-3);transform:translateX(16px)}',
      '.dtaSwitch:disabled{opacity:.4;cursor:default}',
      '.dtaSwitch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
    ].join('')

    function ensureCardStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CARD_CSS_ID) + ']')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-tool-adapt'
      tag.dataset.pluginCss = CARD_CSS_ID
      tag.textContent = CARD_CSS
      document.head.appendChild(tag)
    }

    // Idempotent inverse of ensureCardStyles(): the plugin disposer removes the
    // card style tag so stop / update / HMR leave no style behind. A later
    // SettingsCard render re-creates it via ensureCardStyles().
    function removeCardStyles() {
      if (typeof document === 'undefined') return
      const tag = document.querySelector('style[data-plugin-css=' + JSON.stringify(CARD_CSS_ID) + ']')
      if (tag && tag.parentNode) tag.parentNode.removeChild(tag)
    }

    function Chevron(props) {
      return e('svg', {
        width: 14,
        height: 14,
        className: props.className,
        viewBox: '0 0 14 14',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': true,
      }, e('path', {
        d: 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z',
        fill: 'currentColor',
      }))
    }

    function FieldRow(props) {
      const id = props.id
      const head = [
        e('label', { key: 'lab', className: 'dtaLabel', htmlFor: id }, props.label),
      ]
      if (props.overridden) {
        head.push(e('span', { key: 'badges', className: 'dtaBadges' },
          e('span', { className: 'dtaBadge' }, '已覆盖'),
          e('button', {
            type: 'button',
            className: 'dtaReset',
            disabled: props.disabled,
            onClick: props.onReset,
          }, '恢复默认'),
        ))
      }
      const control = props.kind === 'bool'
        ? e('input', {
          id,
          className: 'dtaSwitch',
          type: 'checkbox',
          checked: props.text === 'true',
          disabled: props.disabled,
          onChange: (ev) => props.onEdit(ev.target.checked ? 'true' : 'false'),
        })
        : props.kind === 'textarea'
          ? e('textarea', {
            id,
            className: props.invalid ? 'dtaTextarea dtaInputInvalid' : 'dtaTextarea',
            value: props.text,
            disabled: props.disabled,
            'aria-invalid': props.invalid || undefined,
            onChange: (ev) => props.onEdit(ev.target.value),
          })
          : e('input', {
            id,
            className: props.invalid ? 'dtaInput dtaInputInvalid' : 'dtaInput',
            type: 'text',
            inputMode: props.kind === 'num' ? 'numeric' : undefined,
            value: props.text,
            disabled: props.disabled,
            'aria-invalid': props.invalid || undefined,
            onChange: (ev) => props.onEdit(ev.target.value),
          })
      return e('div', { className: 'dtaField' },
        e('div', { className: 'dtaFieldHead' }, head),
        control,
        e('p', { className: props.invalid ? 'dtaInvalid' : 'dtaHint' },
          props.invalid ? '当前草稿无法保存' : (props.hint || null),
        ),
      )
    }

    function SettingsCard(props) {
      ensureCardStyles()
      const scope = props.scope
      const api = props.api
      const [tick, setTick] = React.useState(0)
      const [open, setOpen] = React.useState(false)
      const [staged, setStaged] = React.useState({})
      const [saving, setSaving] = React.useState(false)
      const [failed, setFailed] = React.useState(false)

      React.useEffect(() => {
        if (!scope || typeof scope.subscribe !== 'function') return undefined
        return scope.subscribe(() => setTick((n) => n + 1))
      }, [scope])

      const snap = scope && typeof scope.getSnapshot === 'function'
        ? scope.getSnapshot()
        : { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false }

      const available = snap.status === 'ready'
      const writable = !!snap.writable
      const value = snap.value || {}
      const base = snap.base || {}
      const user = snap.user || {}

      const plan = []
      for (const field of FIELDS) {
        const key = fieldKey(field.path)
        const draft = staged[key]
        if (!draft) continue
        if (draft.clear) {
          if (getAt(user, field.path) !== undefined) plan.push({ field, op: 'unset', path: field.path })
          continue
        }
        const parsed = parseValue(field, draft.text)
        if (parsed === undefined) {
          plan.push({ field, invalid: true })
          continue
        }
        if (formatValue(field, getAt(value, field.path)) === formatValue(field, parsed)) continue
        plan.push({ field, op: 'set', path: field.path, value: parsed })
      }

      const dirty = plan.length > 0
      const invalid = plan.some((item) => item.invalid)
      const blocked = !dirty || invalid || saving

      function stage(field, next) {
        setFailed(false)
        setStaged((prev) => Object.assign({}, prev, { [fieldKey(field.path)]: next }))
      }

      function discard() {
        if (!dirty && !failed) return
        setStaged({})
        setFailed(false)
      }

      async function save() {
        if (!api || !api.settings || saving || !dirty || invalid || !writable) return
        setSaving(true)
        setFailed(false)
        try {
          const ops = plan.filter((item) => !item.invalid).map((item) => (
            item.op === 'unset'
              ? { op: 'unset', path: item.path }
              : { op: 'set', path: item.path, value: item.value }
          ))
          const payload = { ns: NS, ops }
          if (snap.revision !== undefined) payload.expectedRevision = snap.revision
          const response = await api.settings.mutate(payload)
          const ok = !!(response && response.result && response.result.ok)
          if (ok) setStaged({})
          else setFailed(true)
        } catch (_) {
          setFailed(true)
        }
        setSaving(false)
      }

      void tick
      if (!available) return null

      const fields = FIELDS.map((field) => {
        const key = fieldKey(field.path)
        const draft = staged[key]
        const current = getAt(value, field.path)
        const stored = getAt(user, field.path) !== undefined
        const overridden = draft
          ? !draft.clear
          : stored
        const text = draft ? draft.text : formatValue(field, current)
        const parsed = draft && !draft.clear ? parseValue(field, draft.text) : current
        const invalidField = !!(draft && !draft.clear && parsed === undefined)
        return e(FieldRow, {
          key,
          id: 'plugin-config-tool-adapt-' + key.replace(/\./g, '-'),
          kind: field.kind,
          label: field.label,
          hint: field.hint,
          text,
          overridden,
          invalid: invalidField,
          disabled: !writable || saving,
          onEdit: (next) => stage(field, { text: next, clear: false }),
          onReset: () => stage(field, { text: formatValue(field, getAt(base, field.path)), clear: true }),
        })
      })

      const body = open ? e('div', { className: 'dtaBody' },
        writable ? null : e('p', { className: 'dtaReadOnly', role: 'status' }, '本部署的设置为只读。'),
        fields,
        e('div', { className: 'dtaFooter' },
          failed ? e('p', { className: 'dtaFailed', role: 'status' }, '本部署没有接受这些值，已保留供你修改。') : null,
          e('button', {
            type: 'button',
            className: 'dtaDiscard',
            disabled: !dirty || saving,
            onClick: discard,
          }, '放弃修改'),
          e('button', {
            type: 'button',
            className: 'dtaSave',
            disabled: blocked || !writable,
            onClick: save,
          }, saving ? '保存中…' : '保存'),
        ),
      ) : null

      return e('li', { className: open ? 'dtaCard dtaCardOpen' : 'dtaCard' },
        e('button', {
          type: 'button',
          className: 'dtaHeader',
          'aria-expanded': open,
          'aria-label': (open ? '收起设置' : '展开设置') + ': ADAPT',
          onClick: () => setOpen(!open),
        },
          e('span', { className: 'dtaHeadText' },
            e('span', { className: 'dtaName' }, 'ADAPT'),
            e('span', { className: 'dtaDescription' }, '模型适配守卫。配置热生效，作用于下一次工具调用与提示词组装。'),
          ),
          dirty ? e('span', { className: 'dtaPending' }, '未保存') : null,
          e(Chevron, { className: open ? 'dtaChevron dtaChevronOpen' : 'dtaChevron' }),
        ),
        body,
      )
    }

    // ── composer pill ───────────────────────────────────────────────────────

    const PILL_ROOT_ID = 'dsh-tool-adapt-root'
    const ANCHOR_KEY = 'dsh.toolAdapt.anchor'
    const ANCHORS = ['tl', 'tr', 'bl', 'br']
    const ENSURE_MS = 2000

    // Mounted flag owned by the plugin lifecycle: set when the pill starts and
    // reset by the idempotent disposer, so a later apply (update / HMR / re-run)
    // mounts a fresh pill instead of being blocked by a stale flag.
    let pillMounted = false
    let pillDispose = null

    function startPill(scope) {
      if (typeof document === 'undefined') return
      if (pillMounted) {
        // Previous mount leaked (disposal was skipped). Dispose it first, then
        // mount again: every apply must end with exactly one live pill.
        const previous = pillDispose
        pillDispose = null
        if (typeof previous === 'function') previous()
        return startPill()
      }
      pillMounted = true

      // Idempotent re-mount: drop any root a previous bundle left behind
      // before creating a fresh one.
      const stale = document.getElementById(PILL_ROOT_ID)
      if (stale && stale.parentNode) stale.parentNode.removeChild(stale)

      const cleanups = []
      const track = (fn) => cleanups.push(fn)

      let disposed = false
      let root = null
      let dragCleanup = null

      // Mount target is ONLY the composer seat. There is deliberately no
      // document.body fallback (and no composer-card parent fallback): the pill
      // must stay inside the composer stacking context so DSH overlays can
      // cover it. When the seat has not appeared yet, the document observer
      // below waits for [data-composer-seat] and mounts as soon as it exists.
      function findSeat() {
        return document.querySelector('[data-composer-seat]')
      }
      function ensureMounted() {
        const seat = findSeat()
        if (!seat) return false
        if (root.parentNode !== seat || !root.isConnected) seat.appendChild(root)
        return true
      }

      root = document.createElement('div')
      root.id = PILL_ROOT_ID
      // Hidden by default (ui.pill defaults to false): the visibility gate
      // below flips this to '' only once the settings snapshot or a status
      // poll reports ui.pill === true.
      root.style.cssText = 'position:fixed;z-index:1;display:none;font-family:ui-sans-serif,system-ui,sans-serif;'

      const shadow = root.attachShadow({ mode: 'open' })
      shadow.innerHTML = '<style>' + [
        ':host{all:initial}',
        '.pill{display:flex;align-items:center;gap:7px;padding:7px 14px;border:1px solid var(--dsw-alias-border-l1,#444);border-radius:999px;background:var(--dsw-alias-bg-layer-1,#222);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#222) 82%, transparent);backdrop-filter:blur(8px);color:var(--dsw-alias-label-primary,#eee);font-size:12px;font-weight:600;letter-spacing:.04em;cursor:grab;box-shadow:0 2px 10px rgba(0,0,0,.28);user-select:none;touch-action:none;transition:border-color .18s ease,box-shadow .18s ease,transform .18s ease}',
        '.pill:active{cursor:grabbing}',
        '.pill:hover{border-color:var(--dsw-alias-brand-primary,#4a9eff);box-shadow:0 4px 16px rgba(0,0,0,.38);transform:translateY(-1px)}',
        '.pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4a9eff);outline-offset:2px}',
        '.glyph{display:flex;width:14px;height:14px;color:var(--dsw-alias-brand-primary,#4a9eff)}',
        '.glyph svg{width:14px;height:14px;fill:currentColor}',
        '.dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-secondary,#999);transition:background .3s ease}',
        '.dot.on{background:var(--dsw-alias-state-success-primary,#3fb950);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary,#3fb950) 22%, transparent)}',
        '.dot.off{background:var(--dsw-alias-label-secondary,#999)}',
        '.panel{position:fixed;right:0;bottom:calc(100% + 10px);width:360px;max-height:50vh;overflow:auto;display:none;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-l1,#444);border-radius:16px;background:var(--dsw-alias-bg-layer-1,#222);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#222) 92%, transparent);backdrop-filter:blur(14px);color:var(--dsw-alias-label-primary,#eee);font-size:12px;box-shadow:0 12px 40px rgba(0,0,0,.45)}',
        '.panel.open{display:flex}',
        '.head{display:flex;align-items:baseline;gap:8px}',
        '.head .t{font-size:14px;font-weight:700}',
        '.head .sub{color:var(--dsw-alias-label-secondary,#999);font-size:11px}',
        '.close{margin-left:auto;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#999);cursor:pointer;font-size:14px}',
        '.hint{color:var(--dsw-alias-label-secondary,#999);font-size:11px;line-height:1.5}',
        '.status{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary,#999);font-size:11px}',
        '.status .sdot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#3fb950)}',
        '.status .sdot.off{background:var(--dsw-alias-label-secondary,#999)}',
        '.err{color:var(--dsw-alias-state-error-primary,#f85149);font-size:11px;word-break:break-all}',
      ].join('') + '</style>'

      const SHIELD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 3.5v5.2c0 5-3.4 9.3-8 11.3-4.6-2-8-6.3-8-11.3V5.5L12 2zm0 2.2L6 6.4v4.3c0 3.9 2.6 7.4 6 9.1 3.4-1.7 6-5.2 6-9.1V6.4l-6-2.2z"/><path d="M10.8 14.6l-2.3-2.3-1.4 1.4 3.7 3.7 6.1-6.1-1.4-1.4-4.7 4.7z" opacity=".9"/></svg>'
      const pill = document.createElement('button')
      pill.className = 'pill'
      pill.title = 'ADAPT 适配守卫（点击查看状态；拖动可吸附到输入框四角）'
      const glyph = document.createElement('span')
      glyph.className = 'glyph'
      glyph.innerHTML = SHIELD
      const dot = document.createElement('span')
      dot.className = 'dot'
      const label = document.createElement('span')
      label.textContent = 'ADAPT'
      pill.append(glyph, label, dot)

      const cluster = document.createElement('div')
      cluster.style.cssText = 'display:flex;align-items:center'
      cluster.append(pill)

      const panel = document.createElement('div')
      panel.className = 'panel'
      const head = document.createElement('div')
      head.className = 'head'
      const title = document.createElement('span')
      title.className = 't'
      title.textContent = 'ADAPT 模型适配守卫'
      const sub = document.createElement('span')
      sub.className = 'sub'
      sub.textContent = 'dsh-tool-adapt'
      const closeBtn = document.createElement('button')
      closeBtn.className = 'close'
      closeBtn.textContent = '✕'
      head.append(title, sub, closeBtn)
      const statusEl = document.createElement('div')
      statusEl.className = 'status'
      const hint = document.createElement('div')
      hint.className = 'hint'
      hint.textContent = '完整配置请到 设置 → 插件 → ADAPT。这里只显示当前守卫状态。'
      const errEl = document.createElement('div')
      errEl.className = 'err'
      panel.append(head, statusEl, hint, errEl)
      shadow.append(cluster, panel)

      let anchor = 'br'
      try {
        const saved = localStorage.getItem(ANCHOR_KEY)
        if (saved === 'left') anchor = 'bl'
        else if (saved === 'right') anchor = 'br'
        else if (ANCHORS.indexOf(saved) !== -1) anchor = saved
      } catch (_) {}

      root.style.right = '16px'
      root.style.bottom = '64px'
      let lastX = null
      let lastY = null
      let dragging = false

      function findComposer() {
        return document.querySelector('[data-composer-card]') || findSeat() || null
      }

      function place() {
        if (dragging || !root.isConnected) return
        const seat = findComposer()
        if (!seat) return
        const r = seat.getBoundingClientRect()
        const pr = cluster.getBoundingClientRect()
        const gap = 8
        const leftSide = anchor === 'tl' || anchor === 'bl'
        const topSide = anchor === 'tl' || anchor === 'tr'
        let x = leftSide ? r.left - pr.width - gap : r.right + gap
        let y = topSide ? r.top - pr.height - gap : r.bottom + gap
        x = Math.max(4, Math.min(window.innerWidth - pr.width - 4, x))
        y = Math.max(4, Math.min(window.innerHeight - pr.height - 4, y))
        if (x === lastX && y === lastY) return
        lastX = x
        lastY = y
        root.style.left = x + 'px'
        root.style.top = y + 'px'
        root.style.right = 'auto'
        root.style.bottom = 'auto'
        if (panel.classList.contains('open')) placePanel()
      }

      let rafId = 0
      let rafPending = false
      function schedulePlace() {
        if (disposed || rafPending) return
        rafPending = true
        rafId = requestAnimationFrame(function () {
          rafPending = false
          rafId = 0
          place()
        })
      }

      // Wait for [data-composer-seat]: observe the whole document so the pill
      // mounts whenever the seat first appears and follows later re-inserts.
      const domObserver = new MutationObserver(function () {
        if (ensureMounted()) schedulePlace()
      })
      domObserver.observe(document.documentElement, { childList: true, subtree: true })
      track(function () { domObserver.disconnect() })

      window.addEventListener('scroll', schedulePlace, { capture: true, passive: true })
      track(function () { window.removeEventListener('scroll', schedulePlace, { capture: true }) })

      window.addEventListener('resize', schedulePlace)
      track(function () { window.removeEventListener('resize', schedulePlace) })

      const seatRo = new ResizeObserver(schedulePlace)
      let seatObserved = null
      function watchSeat() {
        const seat = findComposer()
        if (seat && seat !== seatObserved) {
          if (seatObserved) seatRo.unobserve(seatObserved)
          seatRo.observe(seat)
          seatObserved = seat
        }
      }
      watchSeat()
      track(function () { seatRo.disconnect() })

      const ensureTimer = setInterval(function () {
        ensureMounted() // React may have re-rendered the composer seat away
        watchSeat()
        place()
      }, ENSURE_MS)
      track(function () { clearInterval(ensureTimer) })

      let lastDragAt = 0
      function onPointerDown(ev) {
        if (ev.button !== 0 || disposed) return
        ev.preventDefault()
        dragging = true
        panel.classList.remove('open')
        const startX = ev.clientX
        const startY = ev.clientY
        const startLeft = root.getBoundingClientRect().left
        const startTop = root.getBoundingClientRect().top
        let moved = false
        const prevSelect = document.body.style.userSelect
        document.body.style.userSelect = 'none'
        function onMove(mv) {
          const dx = mv.clientX - startX
          const dy = mv.clientY - startY
          if (Math.abs(dx) + Math.abs(dy) > 3) moved = true
          root.style.left = (startLeft + dx) + 'px'
          root.style.top = (startTop + dy) + 'px'
          root.style.right = 'auto'
          root.style.bottom = 'auto'
        }
        function onUp() {
          dragCleanup = null
          document.removeEventListener('pointermove', onMove)
          document.removeEventListener('pointerup', onUp)
          document.body.style.userSelect = prevSelect
          dragging = false
          if (!moved) return
          lastDragAt = Date.now()
          const rect = root.getBoundingClientRect()
          const cx = rect.left + rect.width / 2
          const cy = rect.top + rect.height / 2
          const seat = findComposer()
          if (seat) {
            const r = seat.getBoundingClientRect()
            const leftSide = cx < r.left + r.width / 2
            const topSide = cy < r.top + r.height / 2
            anchor = (topSide ? 't' : 'b') + (leftSide ? 'l' : 'r')
            try { localStorage.setItem(ANCHOR_KEY, anchor) } catch (_) {}
          }
          lastX = null
          lastY = null
          place()
        }
        // Disposal during an active drag must still release the document-level
        // listeners and restore the body selection style.
        dragCleanup = function () {
          document.removeEventListener('pointermove', onMove)
          document.removeEventListener('pointerup', onUp)
          document.body.style.userSelect = prevSelect
          dragging = false
        }
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
      }
      cluster.addEventListener('pointerdown', onPointerDown)
      track(function () { cluster.removeEventListener('pointerdown', onPointerDown) })

      function placePanel() {
        panel.style.position = 'fixed'
        const r = cluster.getBoundingClientRect()
        const pw = panel.offsetWidth || 360
        const ph = panel.offsetHeight || 220
        let left = r.left
        const maxLeft = Math.max(4, window.innerWidth - pw - 4)
        if (left > maxLeft) left = maxLeft
        if (left < 4) left = 4
        const below = window.innerHeight - r.bottom - 8 >= ph || r.top < ph + 8
        if (below) {
          panel.style.left = left + 'px'
          panel.style.top = (r.bottom + 8) + 'px'
          panel.style.right = 'auto'
          panel.style.bottom = 'auto'
        } else {
          panel.style.left = left + 'px'
          panel.style.top = 'auto'
          panel.style.right = 'auto'
          panel.style.bottom = (window.innerHeight - r.top + 8) + 'px'
        }
      }

      function renderPill(cfg) {
        const on = !!(cfg && cfg.guard && cfg.guard.enabled)
        dot.className = 'dot ' + (on ? 'on' : 'off')
        pill.title = on ? 'ADAPT 适配守卫：已启用' : 'ADAPT 适配守卫：已停用'
      }

      function renderStatus(data) {
        statusEl.textContent = ''
        const sdot = document.createElement('span')
        sdot.className = data && data.ok ? 'sdot' : 'sdot off'
        const txt = document.createElement('span')
        if (data && data.ok) {
          const via = data.settingsReady ? '官方 Settings（tool-adapt）' : '兼容 JSON 文件'
          txt.textContent = '守卫 ' + (data.config && data.config.guard && data.config.guard.enabled ? '已启用' : '已停用') + ' · ' + via
        } else {
          txt.textContent = (data && data.error) || '状态获取失败'
        }
        statusEl.append(sdot, txt)
      }

      async function refresh() {
        try {
          const res = await fetch(API + '/status', { cache: 'no-store' })
          const data = await res.json()
          if (data && data.ok) {
            renderPill(data.config)
            renderStatus(data)
            noteStatusConfig(data.config)
            errEl.textContent = data.fileError ? '配置警告: ' + data.fileError : ''
          } else {
            renderStatus(data)
            errEl.textContent = (data && data.error) || '状态获取失败'
          }
        } catch (err) {
          renderStatus(null)
          errEl.textContent = String((err && err.message) || err)
        }
      }

      async function pollPill() {
        try {
          const res = await fetch(API + '/status', { cache: 'no-store' })
          const data = await res.json()
          if (data && data.ok) {
            renderPill(data.config)
            noteStatusConfig(data.config)
          }
        } catch (_) {}
      }

      function onPillClick() {
        if (Date.now() - lastDragAt < 350) return
        panel.classList.toggle('open')
        if (panel.classList.contains('open')) {
          placePanel()
          refresh()
        }
      }
      function onCloseClick() {
        panel.classList.remove('open')
      }
      pill.addEventListener('click', onPillClick)
      track(function () { pill.removeEventListener('click', onPillClick) })
      closeBtn.addEventListener('click', onCloseClick)
      track(function () { closeBtn.removeEventListener('click', onCloseClick) })

      refresh()
      pollPill()
      const pollTimer = setInterval(pollPill, POLL_MS)
      track(function () { clearInterval(pollTimer) })

      // ── visibility gate: 设置 → 插件 → ADAPT「显示状态胶囊」(ui.pill) ─────
      // Default OFF: the root is created display:none and only the polled
      // /status config (hot, host-authoritative, also correct for the legacy
      // JSON file mode) may reveal it. Placed after every binding above is
      // initialized because applyVisibility() can call schedulePlace().
      let pillVisible = false

      function applyVisibility() {
        if (!root) return
        root.style.display = pillVisible ? '' : 'none'
        if (!pillVisible) {
          if (panel.classList.contains('open')) panel.classList.remove('open')
        } else {
          schedulePlace() // cluster rect was 0 while hidden — reposition now
        }
      }

      function noteStatusConfig(cfg) {
        const show = !!(cfg && isPlainObject(cfg.ui) && cfg.ui.pill === true)
        if (show === pillVisible) return
        pillVisible = show
        applyVisibility()
      }

      if (scope && typeof scope.subscribe === 'function') {
        // A settings save reaches the host config immediately; re-fetch right
        // away so the pill flips without waiting up to POLL_MS. The 5s poll
        // below remains the safety net (and covers other tabs).
        const unsubscribe = scope.subscribe(function () { refresh() })
        track(function () { unsubscribe() })
      }

      // Mount immediately when the seat already exists; otherwise the document
      // observer mounts the pill as soon as [data-composer-seat] appears.
      ensureMounted()
      place()

      function disposePill() {
        if (disposed) return
        disposed = true
        pillMounted = false
        if (rafPending && rafId !== 0) cancelAnimationFrame(rafId)
        rafPending = false
        rafId = 0
        if (dragCleanup) {
          const cleanupDrag = dragCleanup
          dragCleanup = null
          cleanupDrag()
        }
        for (let i = cleanups.length - 1; i >= 0; i--) {
          try { cleanups[i]() } catch (_) {}
        }
        cleanups.length = 0
        if (root && root.parentNode) root.parentNode.removeChild(root)
        root = null
        pillDispose = null
      }
      pillDispose = disposePill
      return disposePill
    }

    function apply(ctx) {
      // Settings card first: pill mounting waits for the composer seat
      // asynchronously and must never delay or break the Settings Slot.
      const scope = ctx.settingsScope.bind({ namespace: NS })
      // Compatibility layer: prefer DSH 0.1.2 fine-grained remote settings;
      // retain the legacy RC connection API for older hosts.
      const remote = ctx.get('remote')
      const api = remote && remote.settings
        ? { settings: { mutate: (payload) => remote.settings.mutate(payload.ns, payload.ops, payload.expectedRevision).then((result) => ({ result })) } }
        : (ctx.get('connection') && ctx.get('connection').api)
      const disposeSlot = ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: NS,
        label: 'ADAPT',
      }, function ToolAdaptCard() {
        return e(SettingsCard, { scope, api })
      }))

      // Pill: fully lifecycle-owned. The effect runs startPill() now and the
      // returned disposer on stop / update / HMR, idempotently releasing the
      // mounted flag, root, shadow DOM, observers, both intervals, the rAF,
      // and every listener so the next apply re-mounts from scratch. The pill
      // starts hidden: startPill gates visibility on ui.pill (default false)
      // via the settings scope plus the /status poll fallback.
      ctx.effect(() => startPill(scope), 'dsh-tool-adapt: composer pill')

      // Plugin-card style tag: created lazily by SettingsCard renders and
      // removed here so no style is left behind after stop / update.
      ctx.effect(() => () => removeCardStyles(), 'dsh-tool-adapt: plugin card style')

      return disposeSlot
    }

    exports.apply = apply
    exports.inject = ['slots', 'settingsScope', 'connection']
    return module.exports
  },
})
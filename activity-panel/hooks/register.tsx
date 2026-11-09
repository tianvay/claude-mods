import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode, Timer } from 'claude-code'

import type { Activity, DirEntry, FileMark, Phase, Running } from '../types'

import { HEX, extOf, fileChip, folderIcon, pill, shimmerText, statusIcon, sweepBar, timeoutBar } from './art'
import type { Art, IconKind } from './art'

const PANE = 'activity-panel'
const TITLE = 'Activity'
const TICK_MS = 500
const MAX_TREE_ROWS = 400
const SLOW_MODEL_MS = 45_000
const SLOW_TOOL_MS = 30_000
const DEFAULT_SHELL_TIMEOUT_MS = 120_000

const EMPTY: Activity = {
  phase: 'idle',
  phaseSince: 0,
  turnStartedAt: 0,
  running: [],
  log: [],
  turnTouched: [],
  turnCommitted: 0,
}
const activity = atom({ plugin: 'activity-panel', key: 'activity' } as const, EMPTY, { shape: 'a1' })
const files = atom({ plugin: 'activity-panel', key: 'files' } as const, {} as Record<string, FileMark>, { shape: 'f1' })
const dirs = atom({ plugin: 'activity-panel', key: 'dirs' } as const, {} as Record<string, DirEntry[]>, { shape: 'd1' })
const expanded = atom({ plugin: 'activity-panel', key: 'expanded' } as const, { '': true } as Record<string, boolean>, { shape: 'e1' })
const now = atom({ plugin: 'activity-panel', key: 'now' } as const, 0)
const query = atom({ plugin: 'activity-panel', key: 'query' } as const, '')

// Module variables start over on every reload; session.start sets them again.
let root = ''
let ticker: Timer | undefined

type $ = EngineInterface

/** Bookkeeping never breaks the work it watches. */
async function safe(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch {
    // ignored on purpose
  }
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** Project-relative path when inside the project, else the absolute one. */
function rel(p: string): string {
  const n = norm(p)
  if (root === '') return n
  if (n.toLowerCase() === root.toLowerCase()) return ''
  if (n.toLowerCase().startsWith(root.toLowerCase() + '/')) return n.slice(root.length + 1)
  return n
}
const isInside = (r: string) => !/^([a-zA-Z]:)?\//.test(r)
const abs = (r: string) => (r === '' ? root : `${root}/${r}`)
const parentOf = (r: string) => (r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : '')
const baseOf = (r: string) => r.slice(r.lastIndexOf('/') + 1)

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}
const clockTime = (at: number) => new Date(at).toTimeString().slice(0, 8)
const short = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

type Described = {
  label: string
  path?: string
  verb?: NonNullable<Activity['current']>['verb']
  timeoutMs?: number
}

function describe(tool: string, a: Record<string, unknown>): Described {
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : undefined)
  const path = str('file_path') ?? str('notebook_path')
  switch (tool) {
    case 'Read':
      return { label: rel(path ?? ''), path, verb: 'reading' }
    case 'Edit':
    case 'NotebookEdit':
      return { label: rel(path ?? ''), path, verb: 'editing' }
    case 'Write':
      return { label: rel(path ?? ''), path, verb: 'writing' }
    case 'Grep':
    case 'Glob':
      return { label: `${str('pattern') ?? ''}${str('path') ? ' in ' + rel(str('path')!) : ''}` }
    case 'Bash':
    case 'PowerShell': {
      const bg = a.run_in_background === true
      const t = typeof a.timeout === 'number' ? (a.timeout as number) : DEFAULT_SHELL_TIMEOUT_MS
      return { label: (bg ? '[bg] ' : '') + short(str('command') ?? '', 80), timeoutMs: bg ? undefined : t }
    }
    case 'Agent':
      return { label: str('description') ?? str('subagent_type') ?? 'subagent' }
    case 'WebFetch':
      return { label: str('url') ?? '' }
    case 'WebSearch':
      return { label: str('query') ?? '' }
    default:
      return { label: short(str('description') ?? str('command') ?? str('query') ?? '', 60) }
  }
}

async function setPhase($: $, phase: Phase) {
  const t = await $.clock.now()
  await update($, activity, a => (a.phase === phase ? a : { ...a, phase, phaseSince: t }))
}

async function log($: $, text: string, kind: 'ok' | 'err' | 'info') {
  const at = await $.clock.now()
  await update($, activity, a => ({ ...a, log: [...a.log, { at, text, kind }].slice(-40) }))
}

async function listDir($: $, r: string) {
  const entries = await $.fs.list(abs(r))
  const list: DirEntry[] = entries
    .filter(x => x.kind !== 'other' || x.isLink)
    .map(x => ({ name: x.name, isDir: x.kind === 'dir' }))
    .sort((x, y) => (x.isDir === y.isDir ? x.name.localeCompare(y.name) : x.isDir ? -1 : 1))
  await update($, dirs, d => ({ ...d, [r]: list }))
}

/** Expands and lists every folder above a project file so it shows in the tree. */
async function reveal($: $, r: string, isNew: boolean) {
  if (root === '' || !isInside(r)) return
  const chain: string[] = ['']
  const parts = r.split('/').slice(0, -1)
  parts.forEach((_, i) => chain.push(parts.slice(0, i + 1).join('/')))
  const known = await read($, dirs)
  await update($, expanded, ex => {
    const opened = { ...ex }
    for (const d of chain) opened[d] = true
    return opened
  })
  for (const d of chain) {
    if (known[d] === undefined || (isNew && d === parentOf(r))) await safe(() => listDir($, d))
  }
}

function startTicker($: $) {
  if (ticker) return
  ticker = $.clock.every(TICK_MS, () => {
    void safe(async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
    })
  })
}
function stopTicker() {
  ticker?.cancel()
  ticker = undefined
}

const COMMIT_RE = /\bgit\b[^\n|;&]*\bcommit\b/
const COMMIT_OUT_RE = /\[([^\s\]]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\]/

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    root = norm(e.cwd)
    await safe(() =>
      $.command.register({ name: 'activity', description: 'Open the activity panel' }),
    )
    await safe(() => listDir($, ''))
    // If a reload landed mid-turn, keep the clock running for the drawing.
    await safe(async () => {
      if ((await read($, activity)).phase !== 'idle') startTicker($)
    })
    void $.ui.open({ id: PANE, title: TITLE })
    return r
  })

  on('command.run', { command: 'activity' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
    return { text: 'Activity panel opened.' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await safe(async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
      await update($, activity, (a): Activity => ({
        ...a,
        phase: 'waiting',
        phaseSince: t,
        turnStartedAt: t,
        current: undefined,
        turnTouched: [],
        turnCommitted: 0,
        lastCommit: undefined,
        endReason: undefined,
        turnEndedAt: undefined,
      }))
      startTicker($)
    })
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    await safe(() => setPhase($, 'waiting'))
    const stream = next(e)
    let last: Phase | '' = ''
    for await (const c of stream) {
      const k: Phase | '' =
        c.kind === 'thinking' ? 'thinking' : c.kind === 'text' || c.kind === 'tool' || c.kind === 'input' ? 'writing' : ''
      if (k !== '' && k !== last) {
        last = k
        void safe(() => setPhase($, k))
      }
      yield c
    }
    return await stream.result
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    await safe(async () => {
      const t = await $.clock.now()
      await update($, activity, (a): Activity => ({
        ...a,
        phase: 'idle',
        phaseSince: t,
        current: undefined,
        endReason: e.reason,
        turnEndedAt: t,
      }))
      await update($, now, () => t)
      const label = e.reason === 'answer' ? 'Turn finished' : `Turn ended: ${e.reason}`
      await log($, label, e.reason === 'answer' ? 'info' : 'err')
    })
    stopTicker()
    return r
  })

  on('tool.call', async ($, e, next) => {
    const args = e as unknown as Record<string, unknown>
    const d = describe(e.tool, args)
    const path = d.path ? rel(d.path) : undefined
    let startedAt = 0
    let isNew = false

    await safe(async () => {
      startedAt = await $.clock.now()
      if (e.tool === 'Write' && d.path) isNew = !(await $.fs.exists(d.path).catch(() => true))
      const run: Running = {
        id: e.tool_use_id,
        tool: e.tool,
        label: d.label,
        startedAt,
        timeoutMs: d.timeoutMs,
        agentId: e.agentId,
        path,
        verb: d.verb,
      }
      await update($, activity, a => ({
        ...a,
        phase: e.agentId === undefined ? 'tool' : a.phase,
        phaseSince: e.agentId === undefined ? startedAt : a.phaseSince,
        running: [...a.running.filter(x => x.id !== run.id), run],
        current: path !== undefined && d.verb ? { path, verb: d.verb } : a.current,
      }))
      if (path !== undefined) await reveal($, path, isNew)
    })

    const ran = await next(e)

    await safe(async () => {
      const t = await $.clock.now()
      const failed = ran.deny !== undefined || ran.isError === true
      const isFileWrite = e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit'

      if (path !== undefined && !failed) {
        await update($, files, f => {
          const old: FileMark = f[path] ?? { read: 0, edited: 0, isCreated: false, isCommitted: false, lastAt: 0 }
          const mark: FileMark = {
            ...old,
            read: old.read + (e.tool === 'Read' ? 1 : 0),
            edited: old.edited + (isFileWrite ? 1 : 0),
            isCreated: old.isCreated || isNew,
            isCommitted: isFileWrite ? false : old.isCommitted,
            lastAt: t,
          }
          return { ...f, [path]: mark }
        })
      }

      let commitNote = ''
      const command = typeof args.command === 'string' ? (args.command as string) : ''
      if ((e.tool === 'Bash' || e.tool === 'PowerShell') && !failed && COMMIT_RE.test(command)) {
        const out = typeof ran.text === 'string' ? ran.text : ''
        const hit = COMMIT_OUT_RE.exec(out)
        const m = hit ? { branch: hit[1] ?? '', hash: (hit[2] ?? '').slice(0, 7) } : undefined
        let count = 0
        await update($, files, f => {
          const marked: Record<string, FileMark> = {}
          count = 0
          for (const [k, v] of Object.entries(f)) {
            const becomes = v.edited > 0 && !v.isCommitted
            if (becomes) count++
            marked[k] = becomes ? { ...v, isCommitted: true } : v
          }
          return marked
        })
        commitNote = ` — committed ${count} file${count === 1 ? '' : 's'}${m ? ` (${m.hash})` : ''}`
        await update($, activity, a => ({
          ...a,
          turnCommitted: a.turnCommitted + count,
          lastCommit: m ?? a.lastCommit,
        }))
      }

      await update($, activity, a => {
        const running = a.running.filter(x => x.id !== e.tool_use_id)
        const touched =
          path !== undefined && !failed && !a.turnTouched.includes(path) ? [...a.turnTouched, path] : a.turnTouched
        const mainBusy = running.some(x => x.agentId === undefined)
        return {
          ...a,
          running,
          turnTouched: touched,
          phase: e.agentId === undefined && !mainBusy && a.phase === 'tool' ? 'waiting' : a.phase,
          phaseSince: e.agentId === undefined && !mainBusy && a.phase === 'tool' ? t : a.phaseSince,
        }
      })

      const who = e.agentId !== undefined ? '[agent] ' : ''
      const why = ran.deny !== undefined ? ' — denied' : ran.isError === true ? ' — error' : ''
      await log($, `${who}${e.tool} ${short(d.label, 70)} (${fmt(t - startedAt)})${why}${commitNote}`, failed ? 'err' : 'ok')
    })

    return ran
  }).catch(($, e, next) => next(e)) // never block a tool over a panel bug

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // The table answers 'in' for tags its surface cannot draw, so decide by surface.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined
    const Input = (e.surface === 'desktop' || e.surface === 'vscode') && 'Input' in els ? els.Input : undefined
    const a = await read($, activity)
    const f = await read($, files)
    const ds = await read($, dirs)
    const ex = await read($, expanded)
    const q = (await read($, query)).trim().toLowerCase()
    const t = Math.max(await read($, now), a.phaseSince)
    const frame = Math.floor(t / TICK_MS)
    const cols = e.props.bodyColumns
    const widthPx = Math.max(180, Math.min(620, cols * 7.4))

    const art = (s: Art, alt: string) =>
      Svg ? <Svg source={s.source} alt={alt} width={s.width} height={s.height} /> : null

    // ── what is going on ────────────────────────────────────────
    const mainRun = a.running.filter(x => x.agentId === undefined)
    const phaseAge = t - a.phaseSince
    const lastRun = mainRun[mainRun.length - 1]
    const runAge = lastRun ? t - lastRun.startedAt : 0
    const runHung = lastRun
      ? lastRun.timeoutMs !== undefined
        ? runAge > lastRun.timeoutMs * 0.75
        : runAge > 5 * 60_000
      : false

    let kind: IconKind = 'idle'
    let tone = 'inactive'
    let kicker = 'IDLE'
    let title = 'Waiting for you'
    let meta = 'Nothing running. Send a message to get going.'
    let subtitle = ''
    let warn = ''
    const summaryPills: [string, string][] = []

    if (a.phase === 'idle') {
      const touched = a.turnTouched.map(p => [p, f[p]] as const).filter(([, m]) => m !== undefined)
      const edited = touched.filter(([, m]) => m!.edited > 0)
      const created = touched.filter(([, m]) => m!.isCreated)
      const uncommitted = edited.filter(([, m]) => !m!.isCommitted)
      const opened = touched.length - edited.length
      if (a.endReason !== undefined) {
        const n = (k: number) => `${k} file${k === 1 ? '' : 's'}`
        kind = a.endReason === 'answer' ? 'done' : a.endReason === 'aborted' ? 'stopped' : 'error'
        tone = a.endReason === 'answer' ? 'success' : a.endReason === 'aborted' ? 'warning' : 'error'
        kicker = a.endReason === 'answer' ? 'DONE' : a.endReason === 'aborted' ? 'STOPPED' : a.endReason.toUpperCase()
        title =
          a.turnCommitted > 0
            ? `Claude committed ${n(a.turnCommitted)}`
            : edited.length > 0
              ? `Claude edited ${n(edited.length)}`
              : opened > 0
                ? `Claude read ${n(opened)}`
                : 'Claude answered'
        const bits: string[] = [`took ${fmt((a.turnEndedAt ?? t) - a.turnStartedAt)}`]
        if (a.lastCommit) bits.unshift(`${a.lastCommit.hash} on ${a.lastCommit.branch}`)
        meta = bits.join(' · ')
        if (opened > 0) summaryPills.push([`${opened} opened`, HEX.purple])
        if (edited.length > 0) summaryPills.push([`${edited.length} edited`, HEX.amber])
        if (created.length > 0) summaryPills.push([`${created.length} new`, HEX.orange])
        if (a.turnCommitted > 0) summaryPills.push([`${a.turnCommitted} committed`, HEX.green])
        if (uncommitted.length > 0) summaryPills.push([`${uncommitted.length} not committed`, HEX.red])
        else if (edited.length > 0) summaryPills.push(['working tree clean', HEX.green])
      }
    } else {
      kicker = 'WORKING'
      meta = `turn running ${fmt(t - a.turnStartedAt)}`
      if (a.phase === 'waiting') {
        kind = 'waiting'
        tone = 'suggestion'
        title = 'Waiting on the model'
        meta = `${fmt(phaseAge)} so far · ${meta}`
        if (phaseAge > SLOW_MODEL_MS) warn = 'The API is slow to answer. This is not a hung command.'
      } else if (a.phase === 'thinking') {
        kind = 'thinking'
        tone = 'merged'
        title = 'Thinking'
        meta = `${fmt(phaseAge)} · ${meta}`
      } else if (a.phase === 'writing') {
        kind = 'writing'
        tone = 'claude'
        title = 'Writing'
        meta = `${fmt(phaseAge)} · ${meta}`
      } else {
        kind = runHung ? 'hung' : runAge > SLOW_TOOL_MS ? 'slow' : 'tool'
        tone = runHung ? 'error' : runAge > SLOW_TOOL_MS ? 'warning' : 'claude'
        title = lastRun ? `Running ${lastRun.tool}` : 'Running a tool'
        meta = `${fmt(runAge)} · ${meta}`
        if (runHung) warn = 'No result for a long time. The command may be hung.'
      }
      kicker = `${kicker} · ${kind === 'hung' ? 'MAYBE STUCK' : kind.toUpperCase()}`
      if (a.current) subtitle = `${a.current.verb} ${a.current.path}`
    }

    const toneHex: Record<string, string> = {
      success: HEX.green,
      warning: HEX.amber,
      error: HEX.red,
      claude: HEX.orange,
      merged: HEX.purple,
      suggestion: HEX.indigo,
      inactive: HEX.grey,
    }

    // ── running commands with timeout bars ──────────────────────
    const runRows = a.running.map(r => {
      const age = t - r.startedAt
      const limit = r.timeoutMs
      const fraction = limit !== undefined ? age / limit : 0
      const hung = limit !== undefined ? fraction > 0.75 : age > 5 * 60_000
      const slow = age > SLOW_TOOL_MS
      const color = hung ? 'error' : slow ? 'warning' : 'claude'
      const note = hung ? 'no result yet: may be hung' : slow ? 'still running' : ''
      const bar = Svg
        ? limit !== undefined
          ? art(timeoutBar(widthPx - 40, fraction), `${Math.round(fraction * 100)}% of the timeout used`)
          : art(sweepBar(widthPx - 40, HEX.orange), 'running')
        : (
            <Text color={color}>
              {textBar(limit !== undefined ? fraction : (frame % 20) / 20, 24)}
            </Text>
          )
      return (
        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text color={color} weight="semibold">
              {hung ? '⚠ ' : ''}
              {r.agentId !== undefined ? 'subagent · ' : ''}
              {r.tool}
              {note !== '' ? `  ${note}` : ''}
            </Text>
            <Text color={color} tabular>
              {fmt(age)}
              {limit !== undefined ? ` / ${fmt(limit)}` : ''}
            </Text>
          </Box>
          {r.label !== '' && (
            <Text mono dimColor size="footnote">
              {short(r.label, Math.max(20, cols - 4))}
            </Text>
          )}
          {bar}
        </Box>
      )
    })

    // ── files ───────────────────────────────────────────────────
    const active: Record<string, string> = {}
    if (a.phase !== 'idle') {
      if (a.current) active[a.current.path] = a.current.verb
      for (const r of a.running) if (r.path !== undefined && r.verb) active[r.path] = r.verb
    }
    const isReadVerb = (verb: string) => verb === 'reading' || verb === 'searching'

    const textShimmer = (name: string, color: string) => {
      const span = 3
      const pos = (frame % (name.length + span * 2)) - span
      const lo = Math.max(0, pos)
      const hi = Math.max(0, Math.min(name.length, pos + span))
      return (
        <Box>
          <Text color={color} bold>{name.slice(0, lo)}</Text>
          <Text color="text" bold>{name.slice(lo, hi)}</Text>
          <Text color={color} bold>{name.slice(hi)}</Text>
        </Box>
      )
    }

    type State = { label: string; hex: string; key: string; pulse?: boolean; solid?: boolean }
    const stateOf = (path: string): State | undefined => {
      const verb = active[path]
      if (verb !== undefined)
        return isReadVerb(verb)
          ? { label: verb, hex: HEX.purple, key: 'merged', pulse: true }
          : { label: verb, hex: HEX.orange, key: 'claude', pulse: true }
      const m = f[path]
      if (!m) return undefined
      if (m.isCommitted) return { label: 'committed', hex: HEX.green, key: 'success', solid: true }
      if (m.isCreated) return { label: 'new', hex: HEX.orange, key: 'claude' }
      if (m.edited > 0) return { label: m.edited > 1 ? `edited ×${m.edited}` : 'edited', hex: HEX.amber, key: 'warning' }
      return { label: 'opened', hex: HEX.purple, key: 'merged' }
    }

    const fileRow = (path: string, label: string, depth: number, hint?: string) => {
      const st = stateOf(path)
      const verb = active[path]
      const name =
        verb !== undefined
          ? Svg
            ? art(
                shimmerText(label, isReadVerb(verb) ? HEX.purple : HEX.orange, isReadVerb(verb) ? HEX.purpleHi : HEX.orangeHi),
                label,
              )
            : textShimmer(label, st?.key ?? 'claude')
          : (
              <Text color={st?.key} weight={st ? 'semibold' : 'regular'} dimColor={!st}>
                {label}
              </Text>
            )
      const ext = extOf(label)
      return (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          <Box flexDirection="row" alignItems="center" gap={1} flexShrink={1} paddingLeft={depth * 2}>
            {Svg ? art(fileChip(label), ext === '' ? 'file' : ext) : <Text dimColor>{(ext || '·').slice(0, 4).padEnd(4)}</Text>}
            {name}
            {hint !== undefined && hint !== '' && (
              <Text dimColor size="footnote">
                {hint}
              </Text>
            )}
          </Box>
          {st &&
            (Svg ? (
              art(pill(st.label, st.hex, { pulse: st.pulse, solid: st.solid }), st.label)
            ) : (
              <Text color={st.key} bold={st.pulse === true || st.solid === true}>
                {st.pulse || st.solid ? ` ${st.label} ` : st.label}
              </Text>
            ))}
        </Box>
      )
    }

    const touchedAll = Object.entries(f).sort((x, y) => y[1].lastAt - x[1].lastAt)
    const counts = { opened: 0, edited: 0, committed: 0 }
    for (const [, m] of touchedAll) {
      if (m.isCommitted) counts.committed++
      else if (m.edited > 0) counts.edited++
      else counts.opened++
    }

    const tile = (value: string, label: string, color: string) => (
      <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={color} paddingX={1}>
        <Text size="heading" weight="bold" color={color} tabular>
          {value}
        </Text>
        <Text size="caption" dimColor>
          {label}
        </Text>
      </Box>
    )

    const section = (label: string, right?: string) => (
      <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
        <Text size="caption" weight="bold" dimColor>
          {label}
        </Text>
        {right !== undefined && (
          <Text size="caption" dimColor tabular>
            {right}
          </Text>
        )}
      </Box>
    )

    // ── tree ────────────────────────────────────────────────────
    const touchedUnder = (dir: string) => {
      const prefix = dir === '' ? '' : dir + '/'
      let changed = 0
      let opened = 0
      let allCommitted = true
      let isActive = false
      for (const [k, v] of touchedAll) {
        if (!isInside(k) || !k.startsWith(prefix)) continue
        if (v.edited > 0) {
          changed++
          if (!v.isCommitted) allCommitted = false
        } else opened++
      }
      for (const k of Object.keys(active)) if (k.startsWith(prefix)) isActive = true
      return { changed, opened, allCommitted, isActive }
    }

    const toggle = async (dir: string) => {
      const isOpen = (await read($, expanded))[dir] === true
      if (!isOpen && (await read($, dirs))[dir] === undefined) await safe(() => listDir($, dir))
      await update($, expanded, x => ({ ...x, [dir]: !isOpen }))
    }

    const treeRows: RenderNode[] = []
    const walk = (dir: string, depth: number) => {
      const list = ds[dir]
      if (!list) return
      for (const entry of list) {
        if (treeRows.length >= MAX_TREE_ROWS) return
        const path = dir === '' ? entry.name : `${dir}/${entry.name}`
        if (entry.isDir) {
          const isOpen = ex[path] === true
          const u = touchedUnder(path)
          const folderColor = u.isActive ? HEX.orange : u.changed > 0 ? (u.allCommitted ? HEX.green : HEX.amber) : u.opened > 0 ? HEX.purple : '#6CA8F0'
          treeRows.push(
            <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
              <Box flexDirection="row" alignItems="center" gap={1} paddingLeft={depth * 2}>
                {Svg && art(folderIcon(isOpen, folderColor), isOpen ? 'open folder' : 'folder')}
                <Button key={'dir:' + path} onPress={() => toggle(path)}>
                  {Svg ? '' : isOpen ? '▾ ' : '▸ '}
                  {entry.name}
                </Button>
              </Box>
              {u.changed > 0
                ? Svg
                  ? art(pill(`${u.changed} changed`, u.allCommitted ? HEX.green : HEX.amber), `${u.changed} changed`)
                  : <Text color={u.allCommitted ? 'success' : 'warning'}>{u.changed} changed</Text>
                : u.opened > 0
                  ? Svg
                    ? art(pill(`${u.opened} opened`, HEX.purple), `${u.opened} opened`)
                    : <Text color="merged">{u.opened} opened</Text>
                  : null}
            </Box>,
          )
          if (isOpen) walk(path, depth + 1)
        } else {
          treeRows.push(fileRow(path, entry.name, depth))
        }
      }
    }

    // A search replaces the tree with the matching files Claude knows of.
    let matches: string[] = []
    if (q !== '') {
      const known = new Set<string>(touchedAll.map(([k]) => k))
      for (const [dir, list] of Object.entries(ds))
        for (const entry of list) if (!entry.isDir) known.add(dir === '' ? entry.name : `${dir}/${entry.name}`)
      matches = [...known].filter(p => p.toLowerCase().includes(q)).sort().slice(0, 60)
    } else walk('', 0)

    const refresh = async () => {
      const opened = await read($, expanded)
      for (const d of Object.keys(opened)) if (opened[d]) await safe(() => listDir($, d))
    }
    const collapse = () => update($, expanded, () => ({ '': true }))

    const logRows = [...a.log].reverse().slice(0, 12)

    return (
      <Box flexDirection="column" gap={1}>
        {/* hero card */}
        <Box flexDirection="column" borderStyle="round" borderColor={tone} paddingX={1} paddingY={Svg ? 1 : 0}>
          <Box flexDirection="row" alignItems="center" gap={2}>
            {Svg ? art(statusIcon(kind), kicker) : <Text color={tone} bold>●</Text>}
            <Box flexDirection="column" flexShrink={1}>
              <Text size="caption" weight="bold" color={tone}>
                {kicker}
              </Text>
              <Text size="title" weight="bold">
                {title}
              </Text>
              <Text size="footnote" dimColor tabular>
                {meta}
              </Text>
            </Box>
          </Box>
          {subtitle !== '' && (
            <Box marginTop={1}>
              <Text mono size="footnote" color={tone}>
                {short(subtitle, Math.max(20, cols - 4))}
              </Text>
            </Box>
          )}
          {warn !== '' && (
            <Box marginTop={1}>
              <Text color={kind === 'hung' ? 'error' : 'warning'} weight="semibold">
                {warn}
              </Text>
            </Box>
          )}
          {summaryPills.length > 0 && (
            <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
              {summaryPills.map(([label, hex]) =>
                Svg ? art(pill(label, hex), label) : <Text color={Object.keys(toneHex).find(k => toneHex[k] === hex) ?? 'text'}>[{label}]</Text>,
              )}
            </Box>
          )}
          {runRows}
        </Box>

        {/* stat tiles */}
        <Box flexDirection="row" gap={1}>
          {tile(String(counts.opened), 'opened', 'merged')}
          {tile(String(counts.edited), 'edited', 'warning')}
          {tile(String(counts.committed), 'committed', 'success')}
          {tile(a.turnStartedAt > 0 ? fmt((a.phase === 'idle' ? (a.turnEndedAt ?? t) : t) - a.turnStartedAt) : '–', a.phase === 'idle' ? 'last turn' : 'this turn', tone)}
        </Box>

        {/* touched */}
        {touchedAll.length > 0 && (
          <Box flexDirection="column" gap={Svg ? 1 : 0}>
            {section('CLAUDE TOUCHED', `${touchedAll.length} file${touchedAll.length === 1 ? '' : 's'}`)}
            {touchedAll
              .slice(0, 12)
              .map(([p]) => fileRow(p, baseOf(p), 0, isInside(p) ? parentOf(p) : 'outside project'))}
            {touchedAll.length > 12 && <Text dimColor size="footnote">…and {touchedAll.length - 12} more</Text>}
          </Box>
        )}

        {/* all files */}
        <Box flexDirection="column" gap={Svg ? 1 : 0}>
          {section('ALL FILES', (baseOf(root) || root).toUpperCase())}
          {Input && (
            <Input key="find" placeholder="Find a file" onInput={v => update($, query, () => v)} onSubmit={v => update($, query, () => v)} />
          )}
          <Box flexDirection="row" gap={1}>
            <Button key="refresh" onPress={refresh}>
              Refresh
            </Button>
            <Button key="collapse" onPress={collapse}>
              Collapse all
            </Button>
            {q !== '' && (
              <Button key="clear" onPress={() => update($, query, () => '')}>
                Clear search
              </Button>
            )}
          </Box>
          {q !== '' ? (
            <Box flexDirection="column" gap={Svg ? 1 : 0}>
              {matches.length === 0 && <Text dimColor>No file matches “{q}”.</Text>}
              {matches.map(p => fileRow(p, baseOf(p), 0, parentOf(p)))}
            </Box>
          ) : (
            <Box flexDirection="column" gap={Svg ? 1 : 0}>
              {ds[''] === undefined && <Text dimColor>Listing the project…</Text>}
              {treeRows}
              {treeRows.length >= MAX_TREE_ROWS && (
                <Text dimColor size="footnote">
                  Tree cut at {MAX_TREE_ROWS} rows. Collapse some folders.
                </Text>
              )}
            </Box>
          )}
        </Box>

        {/* timeline */}
        <Box flexDirection="column">
          {section('RECENT ACTIVITY')}
          {logRows.length === 0 && <Text dimColor>Nothing yet.</Text>}
          {logRows.map(l => (
            <Box flexDirection="row" gap={1}>
              <Text color={l.kind === 'err' ? 'error' : l.kind === 'ok' ? 'success' : 'inactive'}>
                {l.kind === 'err' ? '✗' : l.kind === 'ok' ? '●' : '○'}
              </Text>
              <Text size="footnote" dimColor tabular>
                {clockTime(l.at)}
              </Text>
              <Text size="footnote" color={l.kind === 'err' ? 'error' : undefined} dimColor={l.kind === 'info'}>
                {short(l.text, Math.max(20, cols - 14))}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}

function textBar(fraction: number, cells: number): string {
  const n = Math.max(0, Math.min(cells, Math.round(fraction * cells)))
  return '▰'.repeat(n) + '▱'.repeat(cells - n)
}

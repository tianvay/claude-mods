import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode, Timer } from 'claude-code'

import type { Activity, DirEntry, FileMark, Phase, Running } from '../types'

const PANE = 'activity-panel'
const TITLE = 'Activity'
const TICK_MS = 250
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const a = await read($, activity)
    const f = await read($, files)
    const ds = await read($, dirs)
    const ex = await read($, expanded)
    const t = Math.max(await read($, now), a.phaseSince)
    const frame = Math.floor(t / TICK_MS)

    // ── status card ─────────────────────────────────────────────
    const mainRun = a.running.filter(x => x.agentId === undefined)
    const phaseAge = t - a.phaseSince
    let dotColor = 'inactive'
    let kicker = 'IDLE'
    let title = 'Waiting for you'
    let subtitle = ''
    let warn = ''

    if (a.phase === 'idle') {
      const touched = a.turnTouched.map(p => [p, f[p]] as const).filter(([, m]) => m !== undefined)
      const edited = touched.filter(([, m]) => m!.edited > 0)
      const created = touched.filter(([, m]) => m!.isCreated)
      const uncommitted = edited.filter(([, m]) => !m!.isCommitted)
      const readOnly = touched.length - edited.length
      if (a.endReason === undefined) {
        kicker = 'IDLE'
      } else {
        kicker = a.endReason === 'answer' ? 'DONE' : a.endReason === 'aborted' ? 'STOPPED' : 'ENDED WITH ' + a.endReason.toUpperCase()
        dotColor = a.endReason === 'answer' ? 'success' : 'error'
        const n = (k: number) => `${k} file${k === 1 ? '' : 's'}`
        title =
          a.turnCommitted > 0
            ? `Claude committed ${n(a.turnCommitted)}`
            : edited.length > 0
              ? `Claude edited ${n(edited.length)}`
              : readOnly > 0
                ? `Claude read ${n(readOnly)}`
                : 'Claude answered'
        const bits: string[] = []
        if (a.lastCommit) bits.push(`${a.lastCommit.hash} on ${a.lastCommit.branch}`)
        if (created.length > 0) bits.push(`${created.length} new`)
        if (edited.length > 0 && a.turnCommitted > 0 && readOnly > 0) bits.push(`${readOnly} read`)
        if (uncommitted.length > 0) bits.push(`${uncommitted.length} not committed`)
        else if (edited.length > 0) bits.push('nothing left uncommitted')
        bits.push(`took ${fmt((a.turnEndedAt ?? t) - a.turnStartedAt)}`)
        subtitle = bits.join(' · ')
      }
    } else {
      kicker = 'WORKING · ' + fmt(t - a.turnStartedAt)
      dotColor = 'claude'
      if (a.phase === 'waiting') {
        title = `Waiting on the model · ${fmt(phaseAge)}`
        if (phaseAge > SLOW_MODEL_MS) warn = 'The API is slow to answer — not a hung command.'
      } else if (a.phase === 'thinking') {
        title = `Thinking · ${fmt(phaseAge)}`
      } else if (a.phase === 'writing') {
        title = `Writing · ${fmt(phaseAge)}`
      } else {
        const r = mainRun[mainRun.length - 1]
        title = r ? `Running ${r.tool} · ${fmt(t - r.startedAt)}` : 'Running a tool'
        if (r) subtitle = r.label
      }
      if (a.current && a.phase !== 'waiting') subtitle = subtitle || `${a.current.verb} ${baseOf(a.current.path)}`
    }

    const runRows = a.running.map(r => {
      const age = t - r.startedAt
      const limit = r.timeoutMs
      const hung = limit !== undefined ? age > limit * 0.75 : age > 5 * 60_000
      const slow = age > SLOW_TOOL_MS
      const color = hung ? 'error' : slow ? 'warning' : 'text'
      const note = hung
        ? limit !== undefined
          ? ` no result yet — may be hung (times out at ${fmt(limit)})`
          : ' no result yet — may be hung'
        : slow
          ? ' still running'
          : ''
      return (
        <Box flexDirection="column">
          <Text color={color}>
            {hung ? '⚠ ' : '⏳ '}
            {r.agentId !== undefined ? '[agent] ' : ''}
            {r.tool} · {fmt(age)}
            {note}
          </Text>
          {r.label !== '' && <Text dimColor>{'   ' + short(r.label, Math.max(20, e.props.bodyColumns - 4))}</Text>}
        </Box>
      )
    })

    // ── file name drawing ──────────────────────────────────────
    // Every file a running call works on is active (parallel reads shimmer
    // together); the last file touched stays active until the turn ends.
    const active: Record<string, string> = {}
    if (a.phase !== 'idle') {
      if (a.current) active[a.current.path] = a.current.verb
      for (const r of a.running) if (r.path !== undefined && r.verb) active[r.path] = r.verb
    }
    const verbColor = (verb: string) => (verb === 'reading' || verb === 'searching' ? 'merged' : 'claude')

    const shimmer = (name: string, color: string) => {
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

    const chip = (name: string) => {
      const dot = name.lastIndexOf('.')
      const ext = dot > 0 ? name.slice(dot + 1).toUpperCase().slice(0, 4) : ''
      return <Text dimColor>{ext === '' ? '     ' : ` ${ext.padEnd(4)}`}</Text>
    }

    const badge = (path: string) => {
      const m = f[path]
      const verb = active[path]
      if (verb !== undefined)
        return <Text backgroundColor={verbColor(verb)} color="inverseText" bold>{` ${verb} `}</Text>
      if (!m) return null
      if (m.isCommitted) return <Text backgroundColor="success" color="inverseText" bold> committed </Text>
      if (m.isCreated) return <Text color="warning" bold>new · not committed</Text>
      if (m.edited > 0) return <Text color="warning" bold>edited ×{m.edited}</Text>
      return <Text backgroundColor="merged" color="inverseText"> opened </Text>
    }

    const fileRow = (path: string, label: string, indent: string, hint?: string) => {
      const m = f[path]
      const verb = active[path]
      const color = m?.isCommitted ? 'success' : m && m.edited > 0 ? 'warning' : m ? 'merged' : undefined
      return (
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" flexShrink={1}>
            <Text>{indent}</Text>
            {chip(label)}
            <Text> </Text>
            {verb !== undefined ? shimmer(label, verbColor(verb)) : <Text color={color} bold={m !== undefined} dimColor={m === undefined}>{label}</Text>}
            {hint !== undefined && <Text dimColor>{'  ' + hint}</Text>}
          </Box>
          {badge(path)}
        </Box>
      )
    }

    // ── touched list ───────────────────────────────────────────
    const touchedAll = Object.entries(f).sort((x, y) => y[1].lastAt - x[1].lastAt)
    const legend = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text color="merged">● opened</Text>
        <Text color="warning">● edited, not committed</Text>
        <Text color="success">● committed</Text>
        <Text color="claude">● working on it</Text>
      </Box>
    )

    // ── tree ───────────────────────────────────────────────────
    const touchedUnder = (dir: string) => {
      const prefix = dir === '' ? '' : dir + '/'
      let n = 0
      let opened = 0
      let allCommitted = true
      for (const [k, v] of touchedAll) {
        if (!isInside(k) || !k.startsWith(prefix)) continue
        if (v.edited > 0) {
          n++
          if (!v.isCommitted) allCommitted = false
        } else opened++
      }
      return { n, opened, allCommitted }
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
        const indent = '  '.repeat(depth)
        if (entry.isDir) {
          const isOpen = ex[path] === true
          const { n, opened, allCommitted } = touchedUnder(path)
          treeRows.push(
            <Box flexDirection="row" justifyContent="space-between">
              <Button key={'dir:' + path} onPress={() => toggle(path)}>
                {indent}
                {isOpen ? '▾ ' : '▸ '}
                {entry.name}
              </Button>
              {n > 0 ? (
                <Text color={allCommitted ? 'success' : 'warning'}>{n} changed</Text>
              ) : opened > 0 ? (
                <Text color="merged">{opened} opened</Text>
              ) : null}
            </Box>,
          )
          if (isOpen) walk(path, depth + 1)
        } else {
          treeRows.push(fileRow(path, entry.name, indent + '  '))
        }
      }
    }
    walk('', 0)
    const outside = touchedAll.filter(([k]) => !isInside(k))

    const refresh = async () => {
      const ex2 = await read($, expanded)
      for (const d of Object.keys(ex2)) if (ex2[d]) await safe(() => listDir($, d))
    }
    const collapse = () => update($, expanded, () => ({ '': true }))

    const logRows = [...a.log].reverse().slice(0, 10)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column" borderStyle="round" borderColor={dotColor} paddingX={1}>
          <Text color={dotColor} bold>
            ● {kicker}
          </Text>
          <Text bold>{title}</Text>
          {subtitle !== '' && <Text dimColor>{short(subtitle, Math.max(20, e.props.bodyColumns - 4))}</Text>}
          {warn !== '' && <Text color="warning">{warn}</Text>}
          {runRows.length > 0 && <Box flexDirection="column" marginTop={1}>{runRows}</Box>}
          <Box marginTop={1}>{legend}</Box>
        </Box>

        {touchedAll.length > 0 && (
          <Box flexDirection="column">
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold>CLAUDE TOUCHED</Text>
              <Text dimColor>
                {touchedAll.length} file{touchedAll.length === 1 ? '' : 's'}
              </Text>
            </Box>
            {touchedAll.slice(0, 12).map(([p]) => fileRow(p, baseOf(p), '', isInside(p) ? parentOf(p) : '(outside project)'))}
            {touchedAll.length > 12 && <Text dimColor>…and {touchedAll.length - 12} more</Text>}
          </Box>
        )}

        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold>ALL FILES</Text>
            <Text dimColor>{baseOf(root) || root}</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Button key="refresh" onPress={refresh}>
              Refresh
            </Button>
            <Button key="collapse" onPress={collapse}>
              Collapse all
            </Button>
          </Box>
          {ds[''] === undefined && <Text dimColor>Listing the project…</Text>}
          {treeRows}
          {treeRows.length >= MAX_TREE_ROWS && <Text dimColor>(tree cut at {MAX_TREE_ROWS} rows — collapse folders)</Text>}
          {outside.length > 0 && <Text dimColor>{outside.length} touched file(s) outside the project, listed above</Text>}
        </Box>

        <Box flexDirection="column">
          <Text bold>RECENT ACTIVITY</Text>
          {logRows.length === 0 && <Text dimColor>Nothing yet.</Text>}
          {logRows.map(l => (
            <Text color={l.kind === 'err' ? 'error' : undefined} dimColor={l.kind === 'info'}>
              {clockTime(l.at)} {l.kind === 'ok' ? '✓' : l.kind === 'err' ? '✗' : '·'} {l.text}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}

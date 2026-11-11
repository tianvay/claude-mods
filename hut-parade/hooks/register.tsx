import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, HatKind } from '../types'

const PANE = 'hut-parade'
const TITLE = 'Hut-Parade'

// Change the tag when AgentRow's fields change: values an earlier version
// stored outlive a reload and are then read as the initial value.
const agents = atom({ plugin: 'hut-parade', key: 'agents' } as const, [] as AgentRow[], {
  shape: 'agents-1',
})
const tick = atom({ plugin: 'hut-parade', key: 'tick' } as const, 0)

// ---------------------------------------------------------------- hats

type Hat = { label: string; emoji: string; color: string; dark: string }

const HATS: Record<HatKind, Hat> = {
  research: { label: 'Recherche', emoji: '🔵', color: '#3B82F6', dark: '#1D4ED8' },
  design: { label: 'Design', emoji: '🟣', color: '#8B5CF6', dark: '#6D28D9' },
  coding: { label: 'Coding', emoji: '🟢', color: '#22C55E', dark: '#15803D' },
  plan: { label: 'Planung', emoji: '🟡', color: '#EAB308', dark: '#A16207' },
  review: { label: 'Review & Tests', emoji: '🔴', color: '#EF4444', dark: '#B91C1C' },
  other: { label: 'Sonstiges', emoji: '⚪', color: '#9CA3AF', dark: '#4B5563' },
}
const ORDER: HatKind[] = ['research', 'design', 'coding', 'plan', 'review', 'other']

const KEYWORDS: [HatKind, RegExp][] = [
  ['review', /\b(review|prüf|check|test|verif|audit|qa|validier)/i],
  ['design', /\b(design|layout|ui\b|ux\b|mockup|gestalt|farb|styl|icon|logo|grafik|svg|visual)/i],
  ['plan', /\b(plan|architekt|konzept|strategie|roadmap|entwurf)/i],
  ['research', /\b(recherch|research|such|search|find|explor|untersuch|analys|lies|read|doku|docs|fetch|web)/i],
  ['coding', /\b(code|coding|implement|fix|bug|refactor|build|bau|schreib|program|feature|migrat|script)/i],
]

export function classify(type: string, description: string, prompt: string): HatKind {
  const t = type.toLowerCase()
  if (t === 'explore' || t === 'web-fetch' || t === 'claude-code-guide') return 'research'
  if (t === 'plan') return 'plan'
  if (/review|test/.test(t)) return 'review'
  if (/design/.test(t)) return 'design'
  // The short description says most; the prompt's opening breaks a tie.
  for (const text of [description, prompt.slice(0, 400)]) {
    for (const [kind, re] of KEYWORDS) if (re.test(text)) return kind
  }
  return 'other'
}

// ---------------------------------------------------------------- details

const base = (p: unknown) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''
const cut = (s: unknown, n: number) => {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}
const host = (u: unknown) => {
  const m = /^[a-z]+:\/\/([^/]+)/i.exec(String(u ?? ''))
  return m ? m[1] : cut(u, 40)
}

export function describeStep(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Read':
      return `liest ${base(input.file_path)}`
    case 'Write':
      return `schreibt ${base(input.file_path)}`
    case 'Edit':
    case 'NotebookEdit':
      return `bearbeitet ${base(input.file_path ?? input.notebook_path)}`
    case 'Grep':
      return `sucht „${cut(input.pattern, 40)}“`
    case 'Glob':
      return `sucht Dateien ${cut(input.pattern, 40)}`
    case 'Bash':
    case 'PowerShell':
      return `führt aus: ${cut(input.description ?? input.command, 60)}`
    case 'WebFetch':
      return `liest Webseite ${host(input.url)}`
    case 'WebSearch':
      return `sucht im Web „${cut(input.query, 50)}“`
    case 'Agent':
      return `schickt Helfer los: ${cut(input.description, 50)}`
    default:
      return `nutzt ${tool.replace(/^mcp__[^_]+__/, '')}`
  }
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------- mascot

function hatSvg(kind: HatKind): string {
  const { color, dark } = HATS[kind]
  switch (kind) {
    case 'research': // deerstalker + magnifier
      return `<path d="M16 30 Q32 8 48 30 Z" fill="${color}"/>
        <rect x="9" y="27" width="46" height="4" rx="2" fill="${dark}"/>
        <path d="M30 12 L32 6 L34 12 Z" fill="${dark}"/>
        <circle cx="58" cy="35" r="4.5" fill="none" stroke="#374151" stroke-width="2"/>
        <rect x="55" y="39" width="2" height="7" fill="#374151" transform="rotate(20 56 42)"/>`
    case 'design': // beret + pencil
      return `<ellipse cx="30" cy="25" rx="20" ry="7" fill="${color}" transform="rotate(-8 30 25)"/>
        <rect x="31" y="14" width="3" height="5" rx="1" fill="${dark}"/>
        <rect x="55" y="30" width="3" height="16" fill="#F59E0B" transform="rotate(15 56 38)"/>
        <path d="M54 45 L57 51 L58 45 Z" fill="#374151" transform="rotate(15 56 38)"/>`
    case 'coding': // hard hat
      return `<path d="M14 30 Q14 11 32 11 Q50 11 50 30 Z" fill="${color}"/>
        <rect x="30" y="11" width="4" height="19" fill="${dark}"/>
        <rect x="9" y="27" width="46" height="4" rx="2" fill="${dark}"/>`
    case 'plan': // top hat
      return `<rect x="20" y="5" width="24" height="23" rx="1" fill="${color}"/>
        <rect x="20" y="21" width="24" height="4" fill="${dark}"/>
        <rect x="11" y="27" width="42" height="4" rx="2" fill="${dark}"/>`
    case 'review': // firefighter helmet
      return `<path d="M15 30 Q15 12 32 12 Q49 12 49 30 Z" fill="${color}"/>
        <path d="M44 27 L58 32 L58 34 L44 31 Z" fill="${dark}"/>
        <rect x="10" y="27" width="38" height="4" rx="2" fill="${dark}"/>
        <circle cx="32" cy="21" r="4" fill="#FACC15"/>`
    default: // beanie
      return `<path d="M16 30 Q16 13 32 13 Q48 13 48 30 Z" fill="${color}"/>
        <rect x="14" y="25" width="36" height="6" rx="2" fill="${dark}"/>
        <circle cx="32" cy="11" r="4" fill="${dark}"/>`
  }
}

function eyesSvg(status: AgentRow['status']): string {
  if (status === 'done')
    return `<path d="M21 43 L24 39 L27 43 M37 43 L40 39 L43 43" fill="none" stroke="#1F2937" stroke-width="2.4" stroke-linecap="round"/>`
  if (status === 'failed')
    return `<path d="M21 38 L27 44 M27 38 L21 44 M37 38 L43 44 M43 38 L37 44" stroke="#1F2937" stroke-width="2.4" stroke-linecap="round"/>`
  return `<rect x="22" y="37" width="4" height="7" fill="#1F2937"/><rect x="38" y="37" width="4" height="7" fill="#1F2937"/>`
}

export function mascotSvg(kind: HatKind, status: AgentRow['status']): string {
  const body = '#D97757'
  const hat =
    status === 'failed'
      ? `<g transform="rotate(-20 32 28) translate(-3 2)">${hatSvg(kind)}</g>`
      : hatSvg(kind)
  const bob =
    status === 'running'
      ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -2;0 0" dur="1.1s" repeatCount="indefinite"/>`
      : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 68" width="64" height="68">
  <g>${bob}
    <rect x="16" y="56" width="4" height="8" fill="${body}"/>
    <rect x="24" y="56" width="4" height="8" fill="${body}"/>
    <rect x="36" y="56" width="4" height="8" fill="${body}"/>
    <rect x="44" y="56" width="4" height="8" fill="${body}"/>
    <rect x="6" y="40" width="7" height="8" fill="${body}"/>
    <rect x="51" y="40" width="7" height="8" fill="${body}"/>
    <rect x="12" y="29" width="40" height="28" rx="2" fill="${body}"/>
    ${eyesSvg(status)}
    ${hat}
  </g>
</svg>`
}

// ---------------------------------------------------------------- state helpers

let counter = 0

const patch = ($: EngineInterface, match: (a: AgentRow) => boolean, fn: (a: AgentRow) => AgentRow) =>
  update($, agents, list => list.map(a => (match(a) ? fn(a) : a)))

// ---------------------------------------------------------------- register

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hats',
      description: 'Hut-Parade öffnen: alle Agents mit ihren Hüten',
    })
    // Rows a reload or a lost worker left "running" can no longer finish.
    await update($, agents, list =>
      list.map(a => (a.status === 'running' && !a.agentId ? { ...a, status: 'failed' as const } : a)),
    )
    void $.ui.open({ id: PANE, title: TITLE })
    $.clock.every(1000, () => {
      void (async () => {
        const list = await read($, agents)
        if (list.some(a => a.status === 'running')) await update($, tick, n => (n ?? 0) + 1)
      })()
    })
    return next(e)
  })

  on('command.run', { command: 'hats' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Hut-Parade geöffnet.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const key = `${e.tool_use_id}#${++counter}`
    const row: AgentRow = {
      key,
      toolUseId: e.tool_use_id,
      hat: classify(e.subagentType, e.description, e.prompt),
      type: e.subagentType,
      description: e.description || cut(e.prompt, 60),
      prompt: cut(e.prompt, 240),
      background: e.background,
      startedAt: await $.clock.now(),
      status: 'running',
      steps: 0,
      recent: [],
    }
    await update($, agents, list => [...list.filter(a => !(e.resume && a.agentId === e.resume.agentId)), row].slice(-40))
    void $.ui.open({ id: PANE, title: TITLE })

    const res = await next(e)
    if (res.deny !== undefined) {
      await update($, agents, list => list.filter(a => a.key !== key))
    } else if (res.agentId) {
      const id = res.agentId
      await patch($, a => a.key === key, a => ({ ...a, agentId: id }))
    }
    return res
  }).catch(($, e, next) => next(e))

  // What a subagent is doing right now: every tool call in its own loop.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const step = describeStep(e.tool, e as unknown as Record<string, unknown>)
      await patch(
        $,
        a => a.agentId === id && a.status === 'running',
        a => ({ ...a, steps: a.steps + 1, current: step, recent: [step, ...a.recent].slice(0, 4) }),
      )
    }
    const ran = await next(e)

    // A foreground Agent call that returns has finished its agent, whatever
    // turn.complete said (or did not, where the loop was cut short).
    if (e.tool === 'Agent' && !e.run_in_background) {
      const now = await $.clock.now()
      const failed = 'isError' in ran && Boolean((ran as { isError?: boolean }).isError)
      await patch(
        $,
        a => a.toolUseId === e.tool_use_id && a.status === 'running' && !a.background,
        a => ({ ...a, status: failed ? 'failed' : 'done', endedAt: now, current: undefined }),
      )
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const list = await read($, agents)
      const row = list.find(a => a.agentId === id && a.status === 'running')
      if (row) {
        const failed = e.reason === 'error' || e.reason === 'aborted' || e.reason === 'refusal'
        const now = await $.clock.now()
        await patch($, a => a.key === row.key, a => ({
          ...a,
          status: failed ? 'failed' : 'done',
          endedAt: now,
          current: undefined,
        }))
        const hat = HATS[row.hat]
        void $.ui.toast(
          failed
            ? `${hat.emoji} ${hat.label}-Hut kam zerknittert zurück: ${row.description}`
            : `${hat.emoji} ${hat.label}-Hut ist zurück: ${row.description}`,
        )
      }
    }
    return next(e)
  })

  // ---------------------------------------------------------------- drawing

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e) as unknown as Record<string, any>
    const { Box, Text, Button } = ui
    const Svg = ui.Svg as undefined | ((p: object) => unknown)
    const list = await read($, agents)
    await read($, tick)
    const now = await $.clock.now()

    const running = list.filter(a => a.status === 'running')
    const finished = list.filter(a => a.status !== 'running').reverse()

    const mascot = (a: AgentRow, size: number) =>
      Svg ? (
        <Svg
          source={mascotSvg(a.hat, a.status)}
          alt={`Maskottchen mit ${HATS[a.hat].label}-Hut`}
          width={size}
          height={Math.round(size * 1.06)}
          isInteractive={a.status === 'running' ? true : undefined}
        />
      ) : (
        <Text>{HATS[a.hat].emoji}</Text>
      )

    const statusText = (a: AgentRow) =>
      a.status === 'running' ? '⏳ läuft' : a.status === 'done' ? '✅ fertig' : '❌ abgebrochen'

    const legend = (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={0} marginBottom={1}>
        {ORDER.map(k => (
          <Text size="caption" color={HATS[k].color}>
            {HATS[k].emoji} {HATS[k].label}
          </Text>
        ))}
      </Box>
    )

    const bigRow = (a: AgentRow) => {
      const hat = HATS[a.hat]
      return (
        <Box key={a.key} flexDirection="row" gap={2} paddingY={1} borderStyle="single" borderColor={hat.color} paddingX={1} marginBottom={1}>
          <Box flexShrink={0} alignItems="center">
            {mascot(a, 64)}
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text size="caption" weight="bold" color={hat.color}>
              {hat.emoji} {hat.label.toUpperCase()}-HUT
            </Text>
            <Text weight="semibold" wrap="wrap">
              {a.description}
            </Text>
            <Text size="caption" dimColor>
              {statusText(a)} · {clock(now - a.startedAt)} · {a.steps} {a.steps === 1 ? 'Schritt' : 'Schritte'} · {a.type}
              {a.background ? ' · Hintergrund' : ''}
            </Text>
            <Text wrap="wrap">▶ {a.current ?? 'denkt nach …'}</Text>
            {a.recent.slice(1).map(s => (
              <Text size="caption" dimColor wrap="truncate-end">
                · {s}
              </Text>
            ))}
            <Text size="caption" dimColor italic wrap="wrap">
              Auftrag: {a.prompt}
            </Text>
          </Box>
        </Box>
      )
    }

    const smallRow = (a: AgentRow) => {
      const hat = HATS[a.hat]
      return (
        <Box key={a.key} flexDirection="row" gap={2} alignItems="center" marginBottom={1}>
          <Box flexShrink={0}>{mascot(a, 32)}</Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={hat.color}>{hat.label}</Text> · {a.description}
            </Text>
            <Text size="caption" dimColor>
              {statusText(a)} nach {clock((a.endedAt ?? now) - a.startedAt)} · {a.steps}{' '}
              {a.steps === 1 ? 'Schritt' : 'Schritte'}
            </Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {legend}
        {running.length === 0 && (
          <Box flexDirection="row" gap={2} alignItems="center" marginBottom={1}>
            {Svg && (
              <Svg source={sleepingSvg()} alt="Schlafendes Maskottchen ohne Hut" width={48} height={51} />
            )}
            <Text dimColor>Gerade keine Helfer unterwegs.</Text>
          </Box>
        )}
        {running.map(bigRow)}
        {finished.length > 0 && (
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" marginTop={1} marginBottom={1}>
            <Text size="caption" weight="bold" dimColor>
              ERLEDIGT ({finished.length})
            </Text>
            <Button
              label="Leeren"
              onPress={() => update($, agents, l => l.filter(a => a.status === 'running'))}
            />
          </Box>
        )}
        {finished.slice(0, 15).map(smallRow)}
      </Box>
    )
  })
}

function sleepingSvg(): string {
  const body = '#D97757'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 68" width="64" height="68">
  <rect x="16" y="56" width="4" height="8" fill="${body}"/><rect x="24" y="56" width="4" height="8" fill="${body}"/>
  <rect x="36" y="56" width="4" height="8" fill="${body}"/><rect x="44" y="56" width="4" height="8" fill="${body}"/>
  <rect x="6" y="40" width="7" height="8" fill="${body}"/><rect x="51" y="40" width="7" height="8" fill="${body}"/>
  <rect x="12" y="29" width="40" height="28" rx="2" fill="${body}"/>
  <path d="M20 41 h7 M37 41 h7" stroke="#1F2937" stroke-width="2.4" stroke-linecap="round"/>
  <text x="46" y="20" font-family="sans-serif" font-size="11" font-weight="bold" fill="#9CA3AF">z</text>
  <text x="53" y="12" font-family="sans-serif" font-size="8" font-weight="bold" fill="#9CA3AF">z</text>
</svg>`
}

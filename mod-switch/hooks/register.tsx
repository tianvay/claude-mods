import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModView } from '../types'

const SELF = 'mod-switch'
const PANE = 'mod-switch'
const TITLE = 'Mods'

// Names of the mods turned off in this session.
const off = atom({ plugin: 'mod-switch', key: 'off' } as const, [] as string[])
// The panel's filter text and which group it shows.
const query = atom({ plugin: 'mod-switch', key: 'query' } as const, '')
const view = atom({ plugin: 'mod-switch', key: 'view' } as const, 'all' as ModView)
// Mods whose description is shown in full.
const expanded = atom({ plugin: 'mod-switch', key: 'expanded' } as const, [] as string[])

type Mod = {
  name: string
  commands: string[]
  isMine: boolean
  description?: string
  version?: string
}

// command name -> plugin that owns it, refreshed whenever the panel draws.
let owner = new Map<string, string>()

function pluginOf(name: string): string | undefined {
  return owner.get(name) ?? (name.includes(':') ? name.split(':')[0] : undefined)
}

async function listMods($: EngineInterface): Promise<Mod[]> {
  const mods = new Map<string, Mod>()
  const add = (name: string, isMine: boolean) => {
    if (name === SELF) return undefined
    const mod = mods.get(name) ?? { name, commands: [], isMine }
    mod.isMine = mod.isMine || isMine
    mods.set(name, mod)
    return mod
  }

  // Mods Claude wrote: the sibling folders of this one, with their manifests.
  try {
    const root = $.plugin.root.replace(/[\\/]+$/, '')
    const parent = root.slice(0, Math.max(root.lastIndexOf('/'), root.lastIndexOf('\\')))
    for (const entry of await $.fs.list(parent)) {
      if (entry.kind !== 'dir') continue
      const mod = add(entry.name, true)
      if (!mod) continue
      try {
        const manifest = JSON.parse(
          await $.fs.read(`${parent}/${entry.name}/.claude-plugin/plugin.json`),
        ) as { description?: unknown; version?: unknown }
        if (typeof manifest.description === 'string') mod.description = manifest.description
        if (typeof manifest.version === 'string') mod.version = manifest.version
      } catch {}
    }
  } catch {}

  // Every plugin that adds a command or skill.
  const found = new Map<string, string>()
  for (const c of await $.command.list()) {
    if (c.source !== 'plugin' || !c.plugin) continue
    found.set(c.name, c.plugin)
    const mod = add(c.plugin, false)
    if (!mod) continue
    mod.commands.push(c.name)
    mod.description ??= c.description || undefined
  }
  owner = found

  return [...mods.values()].sort(
    (a, b) => Number(b.isMine) - Number(a.isMine) || a.name.localeCompare(b.name),
  )
}

// ---------------------------------------------------------------------------
// Auto-load: every mod Claude writes (in ~/.claude/dev-mods/<session>/<mod>)
// is copied to ~/.claude/mods/<mod> and listed in CLAUDE_CODE_PLUGIN_DIRS in
// ~/.claude/settings.json, so it loads in every new session.
// ---------------------------------------------------------------------------

const ENV_KEY = 'CLAUDE_CODE_PLUGIN_DIRS'
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'))
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const same = (a: string, b: string) => norm(a).toLowerCase() === norm(b).toLowerCase()

async function isMod($: EngineInterface, dir: string): Promise<boolean> {
  return $.fs.exists(`${dir}/.claude-plugin/plugin.json`).catch(() => false)
}

function skip(dir: string, name: string): boolean {
  return name === 'node_modules' || (name === 'types' && baseOf(dir) === '.claude-plugin')
}

// Newest file mtime under a folder, skipping the engine-written types.
async function newest($: EngineInterface, dir: string): Promise<number> {
  let max = 0
  for (const e of await $.fs.list(dir)) {
    if (skip(dir, e.name)) continue
    if (e.kind === 'dir') max = Math.max(max, await newest($, `${dir}/${e.name}`))
    else if (e.kind === 'file') max = Math.max(max, e.mtimeMs)
  }
  return max
}

async function copyTree($: EngineInterface, from: string, to: string): Promise<void> {
  for (const e of await $.fs.list(from)) {
    if (skip(from, e.name)) continue
    if (e.kind === 'dir') await copyTree($, `${from}/${e.name}`, `${to}/${e.name}`)
    else if (e.kind === 'file') await $.fs.write(`${to}/${e.name}`, await $.fs.read(`${from}/${e.name}`))
  }
}

async function autoload($: EngineInterface): Promise<string[]> {
  const modsDir = dirOf(norm($.plugin.root))
  if (baseOf(modsDir) !== 'mods') return [] // only from the permanent copy
  const claudeDir = dirOf(modsDir)
  const devDir = `${claudeDir}/dev-mods`
  const stored = (await $.store.get('imported')) as Record<string, number> | undefined
  const isFirstRun = stored === undefined
  const imported = stored ?? {}
  const added: string[] = []

  // 1. Copy new or edited mods out of every session's dev folder.
  if (await $.fs.exists(devDir)) {
    for (const session of await $.fs.list(devDir)) {
      if (session.kind !== 'dir') continue
      for (const mod of await $.fs.list(`${devDir}/${session.name}`)) {
        const src = `${devDir}/${session.name}/${mod.name}`
        if (mod.kind !== 'dir' || !(await isMod($, src))) continue
        const stamp = await newest($, src)
        if (stamp <= (imported[mod.name] ?? 0)) continue // nothing new since last import
        // First run: mods already in ~/.claude/mods are taken as current.
        if (isFirstRun && (await isMod($, `${modsDir}/${mod.name}`))) {
          imported[mod.name] = Math.max(imported[mod.name] ?? 0, stamp)
          continue
        }
        await copyTree($, src, `${modsDir}/${mod.name}`)
        imported[mod.name] = stamp
        if (!added.includes(mod.name)) added.push(mod.name)
      }
    }
    await $.store.set('imported', imported)
  }

  // 2. List every mod in ~/.claude/mods in settings.json (drop deleted ones).
  const settingsPath = `${claudeDir}/settings.json`
  const settings = (await $.fs.exists(settingsPath))
    ? (JSON.parse(await $.fs.read(settingsPath)) as Record<string, any>)
    : {}
  const env = (settings.env ??= {}) as Record<string, string>
  const sep = /^[A-Za-z]:/.test(modsDir) ? ';' : ':'
  const before = (env[ENV_KEY] ?? '').split(sep).filter(Boolean)
  const wanted: string[] = []
  for (const e of await $.fs.list(modsDir)) {
    const dir = `${modsDir}/${e.name}`
    if (e.kind === 'dir' && (await isMod($, dir))) wanted.push(dir)
  }
  const outside = before.filter(p => !same(dirOf(norm(p)), modsDir))
  const kept = before.filter(p => wanted.some(w => same(w, p)))
  const fresh = wanted.filter(w => !before.some(p => same(w, p)))
  const after = [...outside, ...kept, ...fresh]
  if (after.join(sep) !== before.join(sep)) {
    env[ENV_KEY] = after.join(sep)
    await $.fs.write(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  }
  return added
}

async function isOff($: EngineInterface, name: string): Promise<boolean> {
  const plugin = pluginOf(name)
  return plugin !== undefined && (await read($, off)).includes(plugin)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mods', description: 'Show the Mods panel with on/off switches' })
    await listMods($)
    void $.ui.open({ id: PANE, title: TITLE })
    void autoload($)
      .then(added => {
        if (added.length) $.ui.toast(`Saved for auto-load: ${added.join(', ')} (active from the next session)`)
      })
      .catch(err => $.ui.toast(`Mod auto-load failed: ${String(err)}`))
    return next(e)
  })

  on('command.run', { command: 'mods' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Mods panel opened.' }
  })

  // Turned-off mods: their commands stop running and leave the menu...
  on('command.run', async ($, e, next) =>
    (await isOff($, e.command))
      ? { text: `/${e.command} is turned off in the Mods panel.` }
      : next(e),
  )
  on('command.describe', async ($, e, next) =>
    (await isOff($, e.command)) ? next({ ...e, isHidden: true }) : next(e),
  )

  // ...and Claude can't call their skills either.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) =>
    (await isOff($, e.skill))
      ? { deny: `The ${pluginOf(e.skill)} mod is turned off in the Mods panel.` }
      : next(e),
  )

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Input = 'Input' in table ? table.Input : undefined

    // Width breakpoints, in the pane body's own columns.
    const cols = e.props.bodyColumns
    const compact = cols < 60 // stats collapse to one line, card text stacks
    const tiny = cols < 40 // badge, version and tab counts drop; buttons get their own row

    const mods = await listMods($)
    const offNow = await read($, off)
    const rawQuery = await read($, query)
    const q = rawQuery.trim().toLowerCase()
    const shown = await read($, view)
    const openNow = await read($, expanded)

    const isOn = (m: Mod) => !offNow.includes(m.name)
    const canPause = (m: Mod) => m.commands.length > 0
    const paused = mods.filter(m => !isOn(m)).length
    const active = mods.length - paused
    const mine = mods.filter(m => m.isMine).length
    const commands = mods.reduce((n, m) => n + m.commands.length, 0)

    const toggle = (name: string) => async () => {
      const wasOff = offNow.includes(name)
      await update($, off, list =>
        list.includes(name) ? list.filter(n => n !== name) : [...list, name],
      )
      $.ui.invalidate('command.describe')
      $.ui.toast(`${name} ${wasOff ? 'resumed' : 'paused'}`)
    }
    const resumeAll = async () => {
      await update($, off, () => [])
      $.ui.invalidate('command.describe')
      $.ui.toast('All mods resumed')
    }
    const pick = (v: ModView) => () => update($, view, () => v)
    const flip = (name: string) => () =>
      update($, expanded, list => (list.includes(name) ? list.filter(n => n !== name) : [...list, name]))

    // One truncated line, with a toggle when the text is longer than the room it gets.
    const Desc = (p: { mod: Mod; room: number }) => {
      const text = p.mod.description!
      const isOpen = openNow.includes(p.mod.name)
      const long = text.length > p.room
      return (
        <Box flexDirection="row" gap={1} alignItems="flex-start" minWidth={0}>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text size="footnote" dimColor wrap={isOpen ? 'wrap' : 'truncate'}>{text}</Text>
          </Box>
          {long && (
            <Box flexShrink={0}>
              <Button
                key={`expand-${p.mod.name}`}
                label={isOpen ? 'less' : 'more'}
                variant="secondary"
                dimColor
                onPress={flip(p.mod.name)}
              />
            </Box>
          )}
        </Box>
      )
    }

    const matches = (m: Mod) =>
      (shown === 'all' ||
        (shown === 'on' && isOn(m)) ||
        (shown === 'off' && !isOn(m)) ||
        (shown === 'mine' && m.isMine)) &&
      (!q ||
        m.name.toLowerCase().includes(q) ||
        (m.description ?? '').toLowerCase().includes(q) ||
        m.commands.some(c => c.toLowerCase().includes(q)))
    const visible = mods.filter(matches)
    const yours = visible.filter(m => m.isMine)
    const plugins = visible.filter(m => !m.isMine)

    const TONES = ['claude', 'suggestion', 'success', 'merged', 'ide', 'planMode', 'autoAccept', 'permission']
    const toneOf = (name: string) => {
      let h = 0
      for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
      return TONES[h % TONES.length]!
    }
    const initials = (name: string) => {
      const parts = name.replace(/^.*:/, '').split(/[-_\s.]+/).filter(Boolean)
      const two = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? '?').slice(0, 2)
      return two.toUpperCase().padEnd(2, ' ')
    }

    const Stat = (p: { value: number; label: string; tone?: string }) => (
      <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="subtle" borderDimColor paddingX={1}>
        <Text size="heading" weight="bold" tabular color={p.tone}>{String(p.value)}</Text>
        <Text size="caption" dimColor>{p.label}</Text>
      </Box>
    )

    const Tab = (p: { id: ModView; label: string; count: number }) => (
      <Button
        key={`view-${p.id}`}
        variant={shown === p.id ? 'primary' : 'secondary'}
        dimColor={shown !== p.id}
        onPress={pick(p.id)}
      >
        {p.label}
        {!tiny && ' '}
        {!tiny && <Text dimColor>{String(p.count)}</Text>}
      </Button>
    )

    // One wrapping line of stats for narrow panes, in place of three boxes.
    const StatLine = () => (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text size="footnote" color="success" tabular>{`● ${active} active`}</Text>
        <Text size="footnote" color={paused ? 'warning' : 'inactive'} tabular>{`◌ ${paused} paused`}</Text>
        <Text size="footnote" color="claude" tabular>{`✦ ${mine} yours`}</Text>
      </Box>
    )

    const Section = (p: { title: string; count: number }) => (
      <Box flexDirection="row" gap={1} marginTop="sm">
        <Text size="caption" weight="semibold" color="subtle">{p.title.toUpperCase()}</Text>
        <Text size="caption" dimColor tabular>{String(p.count)}</Text>
      </Box>
    )

    const Card = (p: { mod: Mod }) => {
      const m = p.mod
      const live = isOn(m)
      const pausable = canPause(m)
      const shownCmds = tiny ? 2 : compact ? 3 : 4
      const extra = m.commands.length - shownCmds
      const action = pausable ? (
        <Button
          key={`toggle-${m.name}`}
          label={live ? 'Pause' : 'Resume'}
          variant={live ? 'secondary' : 'primary'}
          onPress={toggle(m.name)}
        />
      ) : (
        <Text size="caption" dimColor wrap="truncate">always on</Text>
      )
      return (
        <Box
          key={`card-${m.name}`}
          flexDirection="column"
          borderStyle="round"
          borderColor={live ? 'promptBorder' : 'inactive'}
          borderDimColor={!live}
          paddingX={1}
          gap="xs"
          hover={{ borderColor: 'claude' }}
        >
          <Box flexDirection="row" alignItems="center" gap={1}>
            {!tiny && (
              <Box flexShrink={0}>
                <Text backgroundColor={live ? toneOf(m.name) : 'inactive'} color="inverseText" weight="bold" mono>
                  {` ${initials(m.name)} `}
                </Text>
              </Box>
            )}
            <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
              <Box flexDirection="row" gap={1} minWidth={0}>
                <Box flexShrink={1} minWidth={0}>
                  <Text weight="semibold" dimColor={!live} strikethrough={!live && pausable} wrap="truncate">
                    {m.name}
                  </Text>
                </Box>
                {m.version && !tiny && (
                  <Box flexShrink={0}>
                    <Text size="caption" mono dimColor>{`v${m.version}`}</Text>
                  </Box>
                )}
              </Box>
              {m.description && !compact && <Desc mod={m} room={cols - 28} />}
            </Box>
            {!tiny && <Box flexShrink={0}>{action}</Box>}
          </Box>
          {m.description && compact && <Desc mod={m} room={cols - 13} />}
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Text size="caption" color={live ? 'success' : 'warning'}>{live ? '● active' : '◌ paused'}</Text>
            {m.isMine && <Text size="caption" color="claude">✦ yours</Text>}
            {!pausable && <Text size="caption" color="subtle">⚙ hooks only</Text>}
            {m.commands.slice(0, shownCmds).map(c => (
              <Text size="caption" mono color={live ? 'suggestion' : 'inactive'}>{`/${c}`}</Text>
            ))}
            {extra > 0 && <Text size="caption" dimColor>{`+${extra} more`}</Text>}
          </Box>
          {tiny && pausable && <Box flexDirection="row">{action}</Box>}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap="sm" paddingX={1}>
        <Box flexDirection="column">
          <Text size="title" weight="bold">Mods</Text>
          <Text size="footnote" dimColor>
            {`${mods.length} installed · ${commands} command${commands === 1 ? '' : 's'}`}
          </Text>
        </Box>

        {compact ? (
          <StatLine />
        ) : (
          <Box flexDirection="row" gap={1}>
            <Stat value={active} label="active" tone="success" />
            <Stat value={paused} label="paused" tone={paused ? 'warning' : 'inactive'} />
            <Stat value={mine} label="yours" tone="claude" />
          </Box>
        )}

        {Input && (
          <Input
            key="q"
            placeholder="Search mods, commands…"
            value={rawQuery}
            submitLabel="filter"
            onInput={v => void update($, query, () => v)}
            onSubmit={v => void update($, query, () => v)}
          />
        )}

        <Box flexDirection="row" flexWrap="wrap" gap="xs">
          <Tab id="all" label="All" count={mods.length} />
          <Tab id="on" label="Active" count={active} />
          <Tab id="off" label="Paused" count={paused} />
          <Tab id="mine" label="Yours" count={mine} />
        </Box>

        {mods.length === 0 && (
          <Box borderStyle="dashed" borderColor="subtle" paddingX={1} paddingY={1} flexDirection="column" alignItems="center">
            <Text weight="semibold">No mods yet</Text>
            <Text size="footnote" dimColor>Ask Claude to build one — it shows up here.</Text>
          </Box>
        )}
        {mods.length > 0 && visible.length === 0 && (
          <Box borderStyle="dashed" borderColor="subtle" paddingX={1} paddingY={1} flexDirection="column" alignItems="center">
            <Text weight="semibold">Nothing matches</Text>
            <Text size="footnote" dimColor>Try another search or filter.</Text>
          </Box>
        )}

        {yours.length > 0 && <Section title="Your mods" count={yours.length} />}
        {yours.map(m => <Card mod={m} />)}

        {plugins.length > 0 && <Section title="Plugins" count={plugins.length} />}
        {plugins.map(m => <Card mod={m} />)}

        <Box
          flexDirection={compact ? 'column' : 'row'}
          alignItems={compact ? 'flex-start' : 'center'}
          justifyContent="space-between"
          marginTop="sm"
          gap={1}
        >
          <Text size="caption" dimColor wrap="wrap">
            Pauses last for this session. Hooks-only mods can't be paused.
          </Text>
          {paused > 0 && <Button key="resume-all" label="Resume all" variant="primary" onPress={resumeAll} />}
        </Box>
      </Box>
    )
  })
}

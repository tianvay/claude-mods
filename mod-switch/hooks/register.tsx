import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModUpdate, ModView } from '../types'

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
// Set when the person closes the panel by hand; /mods clears it.
const hidden = atom({ plugin: 'mod-switch', key: 'hidden' } as const, false)
// Update check: what is outdated, what was updated, what is running.
const updates = atom({ plugin: 'mod-switch', key: 'updates' } as const, [] as ModUpdate[])
const updated = atom({ plugin: 'mod-switch', key: 'updated' } as const, [] as string[])
const busy = atom({ plugin: 'mod-switch', key: 'busy' } as const, [] as string[])
const checkedAt = atom({ plugin: 'mod-switch', key: 'checkedAt' } as const, 0)
const updateError = atom({ plugin: 'mod-switch', key: 'updateError' } as const, '')

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

type Manifest = Record<string, unknown> & { version?: string }

async function readManifest($: EngineInterface, dir: string): Promise<Manifest | undefined> {
  try {
    return JSON.parse(await $.fs.read(`${dir}/.claude-plugin/plugin.json`)) as Manifest
  } catch {
    return undefined
  }
}

const versionParts = (v: unknown) => (/^(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? '')) ?? []).slice(1).map(Number)
function isNewer(a: unknown, b: unknown): boolean {
  const x = versionParts(a)
  const y = versionParts(b)
  if (x.length < 3) return false
  if (y.length < 3) return true
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!
  return false
}

// A dev copy's manifest is usually older than the published one: sync bumps
// the version and the published copy carries the author and the short
// description the README shows. Copying the dev manifest over it would roll
// those back, so the published version (when newer), author and description stay.
async function keepPublished($: EngineInterface, dest: string, published: Manifest): Promise<void> {
  const copied = await readManifest($, dest)
  if (!copied) return
  const merged: Manifest = { ...copied }
  if (isNewer(published.version, copied.version)) merged.version = published.version
  for (const key of ['author', 'description', 'license', 'homepage', 'repository'])
    if (published[key] !== undefined) merged[key] = published[key]
  await $.fs.write(`${dest}/.claude-plugin/plugin.json`, JSON.stringify(merged, null, 2) + '\n')
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
        const dest = `${modsDir}/${mod.name}`
        const published = await readManifest($, dest)
        await copyTree($, src, dest)
        if (published) await keepPublished($, dest, published)
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

// ---------------------------------------------------------------------------
// Auto-publish: where ~/.claude/mod-publish.json names a repository folder
// ({ "repo": "<folder>" }) holding sync.ps1, run it after auto-load so the
// shared repository follows ~/.claude/mods. Absent file: nothing happens, so
// people who install this mod are never affected.
// ---------------------------------------------------------------------------

async function autopublish($: EngineInterface): Promise<string | undefined> {
  const modsDir = dirOf(norm($.plugin.root))
  if (baseOf(modsDir) !== 'mods') return undefined
  const configPath = `${dirOf(modsDir)}/mod-publish.json`
  if (!(await $.fs.exists(configPath).catch(() => false))) return undefined
  const config = JSON.parse(await $.fs.read(configPath)) as { repo?: unknown; enabled?: unknown }
  if (config.enabled === false || typeof config.repo !== 'string') return undefined
  const script = `${norm(config.repo)}/sync.ps1`
  if (!(await $.fs.exists(script))) return `Mod publishing: no sync.ps1 in ${config.repo}`

  const { exitCode, stdout, stderr } = await $.process.run(
    ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
    { cwd: norm(config.repo), timeoutMs: 5 * 60_000 },
  )
  const result = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .reverse()
    .find(l => l.startsWith('RESULT: '))
    ?.slice('RESULT: '.length)
  if (exitCode !== 0) return `Mod publishing ${result ?? `failed (exit ${exitCode})`}`
  if (!result || result.startsWith('up to date') || result.startsWith('skipped')) return undefined
  return `Mods ${result}`
}

// ---------------------------------------------------------------------------
// Update check: compares each installed plugin's version with the version its
// marketplace lists, after refreshing those marketplaces from their source.
// An update installs with `claude plugin update` and applies next session.
// ---------------------------------------------------------------------------

async function claudeDir($: EngineInterface): Promise<string> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configured) return norm(configured)
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  return `${norm(home)}/.claude`
}

// The claude executable. The desktop app's bundled copy is usually not on
// PATH and CLAUDE_CODE_EXECPATH may not reach mods, so look where sync.ps1 does:
// the variable, the native installer, then the newest desktop-app copy.
let claudePath: string | undefined
async function claudeCommand($: EngineInterface): Promise<string> {
  if (claudePath) return claudePath
  const fromEnv = await $.env.get('CLAUDE_CODE_EXECPATH').catch(() => undefined)
  if (fromEnv) return (claudePath = fromEnv)
  const exists = (p: string) => $.fs.exists(p).catch(() => false)
  const home = norm((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '')
  for (const p of [`${home}/.local/bin/claude.exe`, `${home}/.local/bin/claude`])
    if (home && (await exists(p))) return (claudePath = p)
  const local = await $.env.get('LOCALAPPDATA')
  if (local) {
    const data = `${norm(local)}/Claude-Data`
    let best: { path: string; version: string } | undefined
    try {
      for (const app of await $.fs.list(data)) {
        if (app.kind !== 'dir') continue
        const cc = `${data}/${app.name}/claude-code`
        for (const ver of await $.fs.list(cc).catch(() => [])) {
          if (ver.kind !== 'dir' || (best && !isNewer(ver.name, best.version))) continue
          for (const build of await $.fs.list(`${cc}/${ver.name}`).catch(() => [])) {
            const exe = `${cc}/${ver.name}/${build.name}/claude.exe`
            if (build.kind === 'dir' && (await exists(exe))) {
              best = { path: exe, version: ver.name }
              break
            }
          }
        }
      }
    } catch {}
    if (best) return (claudePath = best.path)
  }
  return 'claude'
}

async function readJson<T>($: EngineInterface, path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await $.fs.read(path)) as T
  } catch {
    return undefined
  }
}

type Installed = { id: string; name: string; marketplace: string; scope: string; version: string }

async function listInstalled($: EngineInterface, dir: string): Promise<Installed[]> {
  const file = await readJson<{ plugins?: Record<string, { scope?: string; version?: string }[]> }>(
    $,
    `${dir}/plugins/installed_plugins.json`,
  )
  const out: Installed[] = []
  for (const [id, entries] of Object.entries(file?.plugins ?? {})) {
    const at = id.lastIndexOf('@')
    if (at <= 0 || !Array.isArray(entries)) continue
    const entry = entries.find(x => x.scope === 'user') ?? entries[0]
    if (!entry?.version) continue
    out.push({ id, name: id.slice(0, at), marketplace: id.slice(at + 1), scope: entry.scope ?? 'user', version: entry.version })
  }
  return out
}

// name -> version, as the marketplace's local copy lists it.
async function catalog($: EngineInterface, dir: string, marketplace: string): Promise<Map<string, string>> {
  const known = await readJson<Record<string, { installLocation?: string }>>($, `${dir}/plugins/known_marketplaces.json`)
  const location = known?.[marketplace]?.installLocation
  const versions = new Map<string, string>()
  if (!location) return versions
  const root = norm(location)
  const manifest = await readJson<{ plugins?: { name?: string; version?: string; source?: unknown }[] }>(
    $,
    `${root}/.claude-plugin/marketplace.json`,
  )
  for (const p of manifest?.plugins ?? []) {
    if (!p.name) continue
    let version = p.version
    if (!version && typeof p.source === 'string' && p.source.startsWith('./'))
      version = (await readJson<{ version?: string }>($, `${root}/${p.source.slice(2)}/.claude-plugin/plugin.json`))?.version
    if (version) versions.set(p.name, version)
  }
  return versions
}

const setBusy = ($: EngineInterface, id: string, on: boolean) =>
  update($, busy, list => (on ? [...list.filter(x => x !== id), id] : list.filter(x => x !== id)))

/** Refreshes the marketplaces (unless `refresh` is false) and records what is outdated. */
async function checkUpdates($: EngineInterface, refresh = true): Promise<void> {
  if ((await read($, busy)).includes('check')) return
  await setBusy($, 'check', true)
  try {
    const dir = await claudeDir($)
    const installed = await listInstalled($, dir)
    const marketplaces = [...new Set(installed.map(p => p.marketplace))]
    const failed: string[] = []
    if (refresh) {
      const claude = await claudeCommand($)
      for (const m of marketplaces) {
        const r = await $.process
          .run([claude, 'plugin', 'marketplace', 'update', m], { timeoutMs: 120_000 })
          .catch(() => undefined)
        if (!r || r.exitCode !== 0) failed.push(m)
      }
    }
    const found: ModUpdate[] = []
    for (const m of marketplaces) {
      const versions = await catalog($, dir, m)
      for (const p of installed.filter(x => x.marketplace === m)) {
        const latest = versions.get(p.name)
        if (latest && isNewer(latest, p.version))
          found.push({ id: p.id, name: p.name, marketplace: m, scope: p.scope, installed: p.version, latest })
      }
    }
    const done = await read($, updated)
    await update($, updates, () => found.filter(u => !done.includes(u.id)))
    await update($, updateError, () =>
      failed.length ? `Couldn't refresh ${failed.join(', ')} (offline?); versions may be stale.` : '',
    )
    const now = await $.clock.now()
    await update($, checkedAt, () => now)
  } finally {
    await setBusy($, 'check', false)
  }
}

async function installUpdate($: EngineInterface, u: ModUpdate): Promise<boolean> {
  await setBusy($, u.id, true)
  try {
    const claude = await claudeCommand($)
    const r = await $.process.run([claude, 'plugin', 'update', u.id, '--scope', u.scope], { timeoutMs: 180_000 })
    if (r.exitCode !== 0) {
      const why = `${r.stderr}\n${r.stdout}`.trim().split(/\r?\n/).filter(Boolean).pop() ?? `exit ${r.exitCode}`
      await update($, updateError, () => `Updating ${u.name} failed: ${why}`)
      return false
    }
    await update($, updates, list => list.filter(x => x.id !== u.id))
    await update($, updated, list => [...list.filter(x => x !== u.id), u.id])
    await update($, updateError, () => '')
    return true
  } catch (err) {
    await update($, updateError, () => `Updating ${u.name} failed: ${String(err)}`)
    return false
  } finally {
    await setBusy($, u.id, false)
  }
}

/** Opens the pane unless it is already on screen or the person closed it. */
async function show($: EngineInterface) {
  if (await read($, hidden)) return
  const mine = (await $.ui.panes()).find(p => p.id === PANE)
  if (mine?.isShown) return
  await $.ui.open({ id: PANE, title: TITLE })
}

async function announceUpdates($: EngineInterface): Promise<void> {
  const list = await read($, updates)
  if (list.length === 1) $.ui.toast(`Update available: ${list[0]!.name} v${list[0]!.latest} (see the Mods panel)`)
  else if (list.length > 1) $.ui.toast(`${list.length} mod updates available (see the Mods panel)`)
}

async function isOff($: EngineInterface, name: string): Promise<boolean> {
  const plugin = pluginOf(name)
  return plugin !== undefined && (await read($, off)).includes(plugin)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mods', description: 'Show the Mods panel with on/off switches' })
    await listMods($)
    // Opened unasked, the pane only shows in a wide window; the hooks below
    // open it again from the person's own input, which shows at any width.
    void show($).catch(() => {})
    void autoload($)
      .then(added => {
        if (added.length) $.ui.toast(`Saved for auto-load: ${added.join(', ')} (active from the next session)`)
      })
      .catch(err => $.ui.toast(`Mod auto-load failed: ${String(err)}`))
      .then(() => autopublish($))
      .then(note => {
        if (note) $.ui.toast(note)
      })
      .catch(err => $.ui.toast(`Mod publishing failed: ${String(err)}`))
      // After publishing, so a mod just pushed counts as available.
      .then(() => checkUpdates($))
      .then(() => announceUpdates($))
      .catch(() => {})
    return next(e)
  })

  // A prompt the person sends is "asked": a pane opened from it is placed at any width.
  on('prompt.submit', async ($, e, next) => {
    await show($).catch(() => {})
    return next(e)
  })

  // The desktop app may attach after the session started.
  on('session.attach', async ($, e, next) => {
    const r = await next(e)
    await show($).catch(() => {})
    return r
  })

  // Closed by hand: stay closed until /mods.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, hidden, () => true).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'mods' }, async $ => {
    await update($, hidden, () => false)
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
    const outdated = await read($, updates)
    const doneNow = await read($, updated)
    const busyNow = await read($, busy)
    const checked = await read($, checkedAt)
    const problem = await read($, updateError)
    const now = checked ? await $.clock.now().catch(() => checked) : 0
    const checking = busyNow.includes('check')
    const updateFor = (m: Mod) => outdated.find(u => u.name === m.name)
    const isDone = (m: Mod) => doneNow.some(id => id.slice(0, id.lastIndexOf('@')) === m.name)

    const runUpdate = (u: ModUpdate) => async () => {
      if (busyNow.includes(u.id)) return
      if (await installUpdate($, u)) $.ui.toast(`${u.name} updated to v${u.latest}; start a new session to use it`)
    }
    const updateAll = async () => {
      let n = 0
      for (const u of outdated) if (await installUpdate($, u)) n++
      if (n) $.ui.toast(`${n} mod${n === 1 ? '' : 's'} updated; start a new session to use them`)
    }
    const checkNow = async () => {
      await checkUpdates($)
      const n = (await read($, updates)).length
      $.ui.toast(n ? `${n} update${n === 1 ? '' : 's'} available` : 'All mods are up to date')
    }
    const ago = (ms: number) => {
      const min = Math.floor((now - ms) / 60_000)
      return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`
    }

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
            {updateFor(m) && <Text size="caption" color="warning">{`↑ v${updateFor(m)!.latest} available`}</Text>}
            {!updateFor(m) && isDone(m) && <Text size="caption" color="success">✓ updated, new session</Text>}
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

        {outdated.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1} gap="xs">
            <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
              <Text weight="semibold" color="warning">
                {`↑ ${outdated.length} update${outdated.length === 1 ? '' : 's'} available`}
              </Text>
              {outdated.length > 1 && (
                <Box flexShrink={0}>
                  <Button key="update-all" label="Update all" variant="primary" onPress={updateAll} />
                </Box>
              )}
            </Box>
            {outdated.map(u => {
              const running = busyNow.includes(u.id)
              return (
                <Box
                  key={`update-row-${u.name}`}
                  flexDirection={tiny ? 'column' : 'row'}
                  alignItems={tiny ? 'flex-start' : 'center'}
                  justifyContent="space-between"
                  gap={1}
                >
                  <Box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={1} minWidth={0}>
                    <Text weight="semibold" wrap="truncate">{u.name}</Text>
                    <Text size="caption" mono dimColor>{`v${u.installed} → v${u.latest}`}</Text>
                  </Box>
                  <Box flexShrink={0}>
                    <Button
                      key={`update-${u.name}`}
                      label={running ? 'Updating…' : 'Update'}
                      variant={running ? 'secondary' : 'primary'}
                      dimColor={running}
                      onPress={runUpdate(u)}
                    />
                  </Box>
                </Box>
              )
            })}
            <Text size="caption" dimColor wrap="wrap">Updates apply from the next session.</Text>
          </Box>
        )}

        {problem && (
          <Text size="footnote" color="error" wrap="wrap">{problem}</Text>
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

        <Box
          flexDirection={compact ? 'column' : 'row'}
          alignItems={compact ? 'flex-start' : 'center'}
          justifyContent="space-between"
          gap={1}
        >
          <Text size="caption" dimColor wrap="wrap">
            {checking
              ? 'Checking for updates…'
              : checked
                ? `Updates checked ${ago(checked)}${outdated.length ? '' : ' · all up to date'}`
                : 'Updates not checked yet'}
          </Text>
          {!checking && (
            <Button key="check-updates" label="Check for updates" variant="secondary" dimColor onPress={checkNow} />
          )}
        </Box>
      </Box>
    )
  })
}

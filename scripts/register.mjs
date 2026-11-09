// Lists every mod in the mods folder in CLAUDE_CODE_PLUGIN_DIRS in
// ~/.claude/settings.json, so the next Claude session loads it. mod-switch
// does the same at session start, but a session reads that setting only as it
// starts, so a mod mod-switch adds loads one session late. Running this when
// a mod is published closes that gap.
//
//   node scripts/register.mjs <mods folder> <settings.json>
//
// Entries outside the mods folder are kept; mods deleted from it are dropped.
// Prints "registered: <names>" when something was added, nothing otherwise.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const KEY = 'CLAUDE_CODE_PLUGIN_DIRS'
const [modsArg, settingsPath] = process.argv.slice(2)
if (!modsArg || !settingsPath) {
  console.error('usage: node scripts/register.mjs <mods folder> <settings.json>')
  process.exit(2)
}

const norm = p => p.replace(/\\/g, '/').replace(/\/+$/, '')
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase()
const parentOf = p => norm(p).slice(0, norm(p).lastIndexOf('/'))
const modsDir = norm(modsArg)
const sep = /^[A-Za-z]:/.test(modsDir) ? ';' : ':'

const raw = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8').replace(/^﻿/, '') : '{}'
const settings = JSON.parse(raw || '{}')
const env = (settings.env ??= {})
const before = String(env[KEY] ?? '').split(sep).filter(Boolean)

const wanted = readdirSync(modsDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && existsSync(join(modsDir, d.name, '.claude-plugin', 'plugin.json')))
  .map(d => `${modsDir}/${d.name}`)

const outside = before.filter(p => !same(parentOf(p), modsDir))
const kept = before.filter(p => wanted.some(w => same(w, p)))
const fresh = wanted.filter(w => !before.some(p => same(w, p)))
const after = [...outside, ...kept, ...fresh]

if (after.join(sep) !== before.join(sep)) {
  env[KEY] = after.join(sep)
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
}
if (fresh.length) console.log(`registered: ${fresh.map(p => p.slice(p.lastIndexOf('/') + 1)).join(', ')}`)

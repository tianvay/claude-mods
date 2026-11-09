// Bumps the patch version of every mod whose files changed since the last
// commit and whose version wasn't already changed by hand, so people who
// installed it get the update.
//
//   node scripts/bump.mjs [<source mods folder>]
//
// The new version is also written to the mod's copy in <source mods folder>
// (normally ~/.claude/mods), so the next sync doesn't copy the old one back.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = process.argv[2]
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })

const hasHead = (() => {
  try {
    git('rev-parse', '-q', '--verify', 'HEAD')
    return true
  } catch {
    return false
  }
})()

const bumpPatch = v => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v ?? '')
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : '0.1.0'
}
const setVersion = (file, version) => {
  const text = readFileSync(file, 'utf8')
  const next = /"version"\s*:\s*"[^"]*"/.test(text)
    ? text.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${version}"`)
    : text.replace(/\{/, `{ "version": "${version}",`)
  writeFileSync(file, next)
}

for (const d of readdirSync(root, { withFileTypes: true })) {
  if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'scripts') continue
  const manifestPath = join(root, d.name, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifestPath) || !hasHead) continue

  let before
  try {
    before = JSON.parse(git('show', `HEAD:${d.name}/.claude-plugin/plugin.json`)).version
  } catch {
    continue // a new mod: it ships with the version it has
  }
  const changed = git('status', '--porcelain', '--', d.name).trim() !== ''
  const now = JSON.parse(readFileSync(manifestPath, 'utf8')).version
  if (!changed || now !== before) continue // untouched, or bumped by hand

  const version = bumpPatch(now)
  setVersion(manifestPath, version)
  const sourceManifest = source && join(source, d.name, '.claude-plugin', 'plugin.json')
  if (sourceManifest && existsSync(sourceManifest)) setVersion(sourceManifest, version)
  console.log(`bump: ${d.name} ${now} -> ${version}`)
}

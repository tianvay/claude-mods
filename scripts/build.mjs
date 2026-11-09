// Regenerates README.md and .claude-plugin/marketplace.json from the mod
// folders in this repository (every top-level folder holding
// .claude-plugin/plugin.json).
//
//   node scripts/build.mjs           write both files
//   node scripts/build.mjs --check   also refuse if a tracked file looks like it holds a key
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OWNER = 'tianvay'
const MARKETPLACE = 'claude-mods'
const REPO = `${OWNER}/${MARKETPLACE}`

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = p => JSON.parse(readFileSync(p, 'utf8'))

// --- collect mods ---------------------------------------------------------
const mods = readdirSync(root, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'scripts')
  .filter(d => existsSync(join(root, d.name, '.claude-plugin', 'plugin.json')))
  .map(d => {
    const dir = join(root, d.name)
    const manifest = readJson(join(dir, '.claude-plugin', 'plugin.json'))
    return { folder: d.name, ...manifest, commands: commandsOf(dir) }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

// Slash commands a mod adds: its skills/ and commands/ folders, plus names a
// hooks module registers with $.command.register({ name: '...' }).
function commandsOf(dir) {
  const found = new Set()
  const skills = join(dir, 'skills')
  if (existsSync(skills))
    for (const s of readdirSync(skills, { withFileTypes: true })) if (s.isDirectory()) found.add(s.name)
  const cmds = join(dir, 'commands')
  if (existsSync(cmds))
    for (const f of readdirSync(cmds)) if (f.endsWith('.md')) found.add(f.slice(0, -3))
  const hooks = join(dir, 'hooks')
  if (existsSync(hooks))
    for (const f of readdirSync(hooks)) {
      if (!/\.(t|j)sx?$/.test(f) || /\.test\./.test(f)) continue
      const src = readFileSync(join(hooks, f), 'utf8')
      for (const m of src.matchAll(/command\.register\(\s*\{\s*name:\s*['"]([^'"]+)['"]/g)) found.add(m[1])
    }
  return [...found].sort()
}

// --- marketplace.json -----------------------------------------------------
const marketplace = {
  name: MARKETPLACE,
  owner: { name: OWNER },
  description: `Mods for Claude Code: ${mods.map(m => m.name).join(', ')}.`,
  plugins: mods.map(m => ({
    name: m.name,
    source: `./${m.folder}`,
    ...(m.description ? { description: m.description } : {}),
    ...(m.version ? { version: m.version } : {}),
  })),
}
writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify(marketplace, null, 2) + '\n')

// --- README.md ------------------------------------------------------------
const install = m => `claude plugin install ${m.name} --marketplace ${REPO}`
const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
const table = [
  '| Mod | What it does | How to use it |',
  '| --- | --- | --- |',
  ...mods.map(
    m =>
      `| **[${m.name}](${m.folder})** <sub>v${esc(m.version ?? '?')}</sub> | ${esc(m.description)} | ${
        m.commands.length ? `Type ${m.commands.map(c => `\`/${c}\``).join(' or ')} in Claude` : 'Works on its own'
      } |`,
  ),
].join('\n')
const updateAll = [
  `claude plugin marketplace update ${MARKETPLACE}`,
  ...mods.map(m => `claude plugin update ${m.name}@${MARKETPLACE}`),
].join('; ')
const uninstallAll = [
  ...mods.map(m => `claude plugin uninstall ${m.name}@${MARKETPLACE}`),
  `claude plugin marketplace remove ${MARKETPLACE}`,
].join('; ')

const template = readFileSync(join(root, 'scripts', 'README.template.md'), 'utf8')
const readme = template
  .replaceAll('{{INSTALL_ALL}}', mods.map(install).join('; '))
  .replaceAll('{{TABLE}}', table)
  .replaceAll('{{UPDATE_ALL}}', updateAll)
  .replaceAll('{{UNINSTALL_ALL}}', uninstallAll)
  .replaceAll('{{REPO}}', REPO)
writeFileSync(join(root, 'README.md'), readme)

console.log(`build: ${mods.length} mod(s): ${mods.map(m => `${m.name}@${m.version ?? '?'}`).join(', ')}`)

// --- key check ------------------------------------------------------------
if (process.argv.includes('--check')) {
  const PATTERNS = [
    ['AWS access key', /AKIA[0-9A-Z]{16}/],
    ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|github_pat_[A-Za-z0-9_]{40,}/],
    ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
    ['OpenAI-style key', /\bsk-[A-Za-z0-9]{32,}\b/],
    ['Slack token', /xox[abprs]-[A-Za-z0-9-]{10,}/],
    ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
    ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ]
  const files = execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  const hits = []
  for (const f of files) {
    let text
    try {
      text = readFileSync(join(root, f), 'utf8')
    } catch {
      continue
    }
    for (const [kind, re] of PATTERNS) if (re.test(text)) hits.push(`${f}: looks like a ${kind}`)
  }
  if (hits.length) {
    console.error('check: refusing, possible secrets found:\n  ' + hits.join('\n  '))
    process.exit(1)
  }
  console.log(`check: ${files.length} file(s), no known key formats`)
}

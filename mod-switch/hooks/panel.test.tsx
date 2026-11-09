import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'mod-switch',
  component: 'Pane',
  requestId: 'mod-switch',
  props: {
    title: 'Mods',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('the panel draws, pauses and resumes on every surface', async ($, on) => {
  on('command.list', () => ({
    value: [
      {
        name: 'notes',
        description: 'Keep notes in a side file that survives across sessions, with tags, search and a daily digest',
        source: 'plugin',
        plugin: 'notes-mod',
      },
      { name: 'notes-clear', description: 'Clear notes', source: 'plugin', plugin: 'notes-mod' },
      { name: 'help', description: 'Help', source: 'builtin' },
    ],
  }))
  on('fs.list', () => ({ value: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) for (const bodyColumns of [80, 48, 30]) {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface })
    expect((await ui.find({ type: 'Text', text: /^Mods$/ }))?.text).toBe('Mods')
    expect(await ui.find({ type: 'Text', text: /notes-mod/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '/notes-clear' })).toBeDefined()

    // The long description gets a more/less toggle that flips back.
    expect((await ui.find({ key: 'expand-notes-mod' }))?.text).toMatch(/more/)
    await ui.press({ key: 'expand-notes-mod' })
    expect((await ui.find({ key: 'expand-notes-mod' }))?.text).toMatch(/less/)
    await ui.press({ key: 'expand-notes-mod' })

    await ui.press({ key: 'toggle-notes-mod' })
    expect(await ui.find({ type: 'Text', text: /paused/ })).toBeDefined()
    await ui.press({ key: 'resume-all' })
    expect(await ui.find({ key: 'resume-all' })).toBeUndefined()

    await ui.press({ key: 'view-off' })
    expect(await ui.find({ type: 'Text', text: 'Nothing matches' })).toBeDefined()
    await ui.press({ key: 'view-all' })
    await ui.unmount()
  }
})

test('outdated mods get an Update button that runs claude plugin update', async ($, on) => {
  const files: Record<string, string> = {
    'C:/Users/me/.claude/plugins/installed_plugins.json': JSON.stringify({
      version: 2,
      plugins: {
        'notes-mod@shop': [{ scope: 'user', version: '0.1.0' }],
        'fresh-mod@shop': [{ scope: 'user', version: '1.0.0' }],
      },
    }),
    'C:/Users/me/.claude/plugins/known_marketplaces.json': JSON.stringify({
      shop: { installLocation: 'C:\\Users\\me\\.claude\\plugins\\marketplaces\\shop' },
    }),
    'C:/Users/me/.claude/plugins/marketplaces/shop/.claude-plugin/marketplace.json': JSON.stringify({
      name: 'shop',
      plugins: [
        { name: 'notes-mod', source: './notes-mod', version: '0.2.0' },
        { name: 'fresh-mod', source: './fresh-mod', version: '1.0.0' },
      ],
    }),
  }
  const runs: string[][] = []
  on('command.list', () => ({
    value: [{ name: 'notes', description: 'Notes', source: 'plugin', plugin: 'notes-mod' }],
  }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => {
    const path = e.path.replace(/\\/g, '/')
    return path in files ? { value: files[path]! } : { deny: 'no such file' }
  })
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:\\Users\\me' : e.name === 'CLAUDE_CODE_EXECPATH' ? 'claude.exe' : undefined }))
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('clock.now', () => ({ value: 1_000_000 }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'update-notes-mod' })).toBeUndefined()

  await ui.press({ key: 'check-updates' })
  expect(runs.some(r => r.join(' ') === 'claude.exe plugin marketplace update shop')).toBe(true)
  expect(await ui.find({ type: 'Text', text: 'v0.1.0 → v0.2.0' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↑ v0.2.0 available' })).toBeDefined()
  expect(await ui.find({ key: 'update-fresh-mod' })).toBeUndefined()

  await ui.press({ key: 'update-notes-mod' })
  expect(runs.some(r => r.join(' ') === 'claude.exe plugin update notes-mod@shop --scope user')).toBe(true)
  expect(await ui.find({ key: 'update-notes-mod' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '✓ updated, new session' })).toBeDefined()
  await ui.unmount()
})

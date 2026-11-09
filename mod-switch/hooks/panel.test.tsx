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

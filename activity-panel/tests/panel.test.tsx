import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'activity-panel',
  component: 'Pane',
  requestId: 'activity-panel',
  props: {
    title: 'Activity',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })

test('a turn that reads, edits and commits ends in a summary', async ($, on) => {
  mock.clock(on, { now: 1_762_700_000_000 })
  on('command.register', () => ({ value: { command: 'activity' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', (_, e) => {
    const p = String((e as { path?: string }).path ?? '')
    return {
      value: p.endsWith('/src')
        ? [entry('client.js', 'file'), entry('stations.js', 'file')]
        : [entry('src', 'dir'), entry('README.md', 'file')],
    }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  on('tool.call', (_, e) =>
    e.tool === 'Bash'
      ? { result: {}, text: '[main a1c9e42] Raise MAX_RETRIES to 3\n 1 file changed' }
      : { result: {} },
  )

  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: 'C:\\proj\\README.md' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\proj\\src\\client.js', old_string: '2', new_string: '3' })

  const mid = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await mid.find({ type: 'Text', text: /editing/ }))?.text).toBe(' editing ')
  expect((await mid.find({ type: 'Text', text: /^ opened $/ }))?.text).toBe(' opened ')
  await mid.unmount()

  await $.tool.call({ tool: 'Bash', command: 'git commit -am "Raise MAX_RETRIES to 3"' })
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'Done.' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /DONE/ }))?.text).toBe('● DONE')
    expect((await ui.find({ type: 'Text', text: /^Claude committed/ }))?.text).toBe('Claude committed 1 file')
    expect((await ui.find({ type: 'Text', text: /a1c9e42 on main/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /committed $/ }))?.text).toBe(' committed ')
    await ui.unmount()
  }
})

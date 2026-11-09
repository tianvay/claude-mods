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

/** The alt texts of every Svg drawn: what a pill or icon says. */
async function alts(ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }): Promise<string[]> {
  return (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.alt))
}

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

  // Mid-turn: the edited file shimmers with an "editing" pill, the read one says "opened".
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const midAlts = await alts(desk)
  expect(midAlts).toContain('editing')
  expect(midAlts).toContain('opened')
  expect(midAlts).toContain('client.js') // the shimmering name
  await desk.unmount()

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /^ editing $/ }))?.text).toBe(' editing ')
  expect((await term.find({ type: 'Text', text: /^opened$/ }))?.text).toBe('opened')
  await term.unmount()

  await $.tool.call({ tool: 'Bash', command: 'git commit -am "Raise MAX_RETRIES to 3"' })
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'Done.' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^DONE$/ }))?.text).toBe('DONE')
    expect((await ui.find({ type: 'Text', text: /^Claude committed/ }))?.text).toBe('Claude committed 1 file')
    expect(await ui.find({ type: 'Text', text: /a1c9e42 on main/ })).toBeTruthy()
    if (surface === 'terminal') {
      expect((await ui.find({ type: 'Text', text: /^ committed $/ }))?.text).toBe(' committed ')
    } else {
      const done = await alts(ui)
      expect(done).toContain('DONE') // the status icon
      expect(done).toContain('committed')
      expect(done).toContain('1 committed') // summary pill
    }
    await ui.unmount()
  }
})

test('a command near its timeout is flagged as maybe hung', async ($, on) => {
  const clock = mock.clock(on, { now: 1_762_700_000_000 })
  on('command.register', () => ({ value: { command: 'activity' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.list', () => ({ value: [] }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  // The command never answers within the test.
  on('tool.call', () => new Promise(() => {}))

  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  void $.tool.call({ tool: 'Bash', command: 'npm test', timeout: 60_000 })
  await clock.advance(50_000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /may be hung/ })).toBeTruthy()
  expect(await alts(ui)).toContain('WORKING · MAYBE STUCK')
  await ui.unmount()
})

test('the panel shows itself on the first prompt in a narrow window', async ($, on) => {
  const clock = mock.clock(on, { now: 1_762_700_000_000 })
  const shown = false
  let opens = 0
  on('command.register', () => ({ value: { command: 'activity' } }))
  // A narrow window: an unasked open waits undrawn.
  on('ui.open', () => {
    opens++
    return { value: { isPlaced: false, reason: 'narrow' } }
  })
  on('ui.panes', () => ({ value: shown ? [{ id: 'activity-panel', title: 'Activity', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.list', () => ({ value: [] }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('command.run', () => ({ text: '' }))

  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const atStart = opens
  expect(atStart).toBeGreaterThan(0)

  await $.prompt.submit({ text: 'hello' })
  expect(opens).toBe(atStart + 1) // reopened from the person's prompt

  await $.command.run({ command: 'activity' } as never)
  expect(opens).toBe(atStart + 2) // /activity opens it too
})

test('a turn that ends with a background task running shows WAITING, not DONE', async ($, on) => {
  mock.clock(on, { now: 1_762_700_000_000 })
  on('command.register', () => ({ value: { command: 'activity' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.list', () => ({ value: [] }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  on('classic.Stop', () => ({}))

  await $.session.start({ cwd: 'C:\proj', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'maps', command: 'bash tools/maps-batch.sh' }],
  })
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'Started it.' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^DONE$/ })).toBeFalsy()
    expect((await ui.find({ type: 'Text', text: /^Waiting on/ }))?.text).toBe('Waiting on 1 background task')
    expect(await ui.find({ type: 'Text', text: /maps-batch\.sh/ })).toBeTruthy()
    await ui.unmount()
  }

  // Claude is woken when the task finishes; that turn ends with nothing in flight: DONE.
  await $.turn.start({ text: 'task finished', turnId: 't2' })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  await $.turn.complete({ turnId: 't2', reason: 'answer', answer: 'All done.' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^DONE$/ }))?.text).toBe('DONE')
  await ui.unmount()
})

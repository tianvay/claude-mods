import { expect, test } from 'claude-code/testing'

import { classify, clock, describeStep, mascotSvg } from '../hooks/register'

test('durations show hours once past an hour', async () => {
  expect(clock(42_000)).toBe('0:42')
  expect(clock(3_599_000)).toBe('59:59')
  expect(clock(3_725_000)).toBe('1:02:05')
  expect(clock(-5)).toBe('0:00')
})

const PANE = {
  plugin: 'hut-parade',
  component: 'Pane',
  requestId: 'hut-parade',
  props: {
    title: 'Hut-Parade',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('hats are picked by type, then by words', async () => {
  expect(classify('Explore', 'irgendwas', '')).toBe('research')
  expect(classify('Plan', '', '')).toBe('plan')
  expect(classify('general-purpose', 'Layout der Seite entwerfen', '')).toBe('design')
  expect(classify('general-purpose', 'Login-Bug fixen', '')).toBe('coding')
  expect(classify('general-purpose', 'Tests prüfen', '')).toBe('review')
  expect(classify('general-purpose', 'Hallo', 'Kaffee')).toBe('other')
  expect(describeStep('Read', { file_path: 'C:\\a\\b\\foo.ts' })).toBe('liest foo.ts')
  expect(mascotSvg('coding', 'running')).toContain('<svg')
})

test('a spawned agent is listed with its hat and what it does', async ($, on) => {
  on('command.register', () => ({ value: { command: 'hats' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'opus', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({}))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'Finde heraus, wie X funktioniert',
    description: 'Docs zu X recherchieren',
    subagentType: 'general-purpose',
  } as never)
  await $.tool.call({ tool: 'Read', file_path: '/x/notes.md', agentId: 'a1' } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /RECHERCHE-HUT/ }))?.text).toContain('RECHERCHE')
    expect((await ui.find({ type: 'Text', text: /liest notes\.md/ }))?.text).toContain('notes.md')
    await ui.unmount()
  }
})

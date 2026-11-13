import { expect, test } from 'claude-code/testing'

import { ACCESSORIES, classify, clock, describeStep, mascotSvg, pickAccessory } from '../hooks/register'

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

test('the finer hats: translation, writing, git and operations', async () => {
  expect(classify('general-purpose', 'Translate drafthelper page part 1', 'First read common.md')).toBe('translate')
  expect(classify('general-purpose', 'Texte ins Englische übersetzen', '')).toBe('translate')
  expect(classify('general-purpose', 'i18n-Schlüssel ergänzen', '')).toBe('translate')
  expect(classify('general-purpose', 'Blogartikel zusammenfassen', '')).toBe('writing')
  expect(classify('general-purpose', 'Anschreiben formulieren', '')).toBe('writing')
  expect(classify('general-purpose', 'Release vorbereiten und pushen', '')).toBe('ops')
  expect(classify('general-purpose', 'Docker-Setup einrichten', '')).toBe('ops')
  // Words the old list knew still land where they did.
  expect(classify('general-purpose', 'Docs zu X recherchieren', '')).toBe('research')
  expect(classify('general-purpose', 'Feature implementieren', '')).toBe('coding')
})

test('the accessory follows the task, else the hat', async () => {
  expect(pickAccessory('coding', 'Login-Bug fixen')).toBe('bugnet')
  expect(pickAccessory('coding', 'Feature implementieren')).toBe('laptop')
  expect(pickAccessory('coding', 'Datenbank-Migration schreiben')).toBe('database')
  expect(pickAccessory('review', 'Tests prüfen')).toBe('testtube')
  expect(pickAccessory('review', 'Code-Review')).toBe('clipboard')
  expect(pickAccessory('research', 'Docs zu X recherchieren')).toBe('book')
  expect(pickAccessory('research', 'Webseite von Y lesen')).toBe('globe')
  expect(pickAccessory('research', 'Wo wird foo benutzt')).toBe('magnifier')
  expect(pickAccessory('design', 'Farben anpassen')).toBe('palette')
  expect(pickAccessory('translate', 'Translate battle report')).toBe('bubbles')
  expect(pickAccessory('ops', 'Änderungen committen')).toBe('branch')
  expect(pickAccessory('ops', 'App veröffentlichen')).toBe('rocket')
  expect(pickAccessory('ops', 'Server neu starten')).toBe('wheel')
  expect(pickAccessory('other', 'Hallo')).toBe('coffee')

  // Every accessory draws, held or dropped, and the drawing stays well-formed.
  for (const tool of Object.keys(ACCESSORIES) as (keyof typeof ACCESSORIES)[]) {
    for (const status of ['running', 'done', 'failed'] as const) {
      const svg = mascotSvg('other', status, tool)
      expect(svg).toContain('viewBox="0 0 80 68"')
      expect(svg.split('<g').length).toBe(svg.split('</g>').length)
    }
  }
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
    expect((await ui.find({ type: 'Text', text: /RECHERCHE-HUT/ }))?.text).toContain('mit Buch')
    expect((await ui.find({ type: 'Text', text: /liest notes\.md/ }))?.text).toContain('notes.md')
    await ui.unmount()
  }
})

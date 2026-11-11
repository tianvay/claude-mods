import { expect, mock, test } from 'claude-code/testing'

const HOME = 'C:\\Users\\Someone'

type Asked = { questions: { question: string }[] }

/** Stands for the engine: a session in `root`, a person answering `answers` in turn. */
function world(on: Parameters<Parameters<typeof test>[1]>[1], root: string, answers: string[]) {
  const calls: { tool: string; path?: unknown }[] = []
  let asked = 0

  mock.env(on, { USERPROFILE: HOME })
  on('session.root', () => ({ value: root }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('tool.call', (_, e) => {
    if (e.tool === 'AskUserQuestion') {
      const { questions } = e as unknown as Asked
      const answer = answers[asked++] ?? 'Ohne Ordner weiter'
      return { result: { questions, answers: { [questions[0]!.question]: answer } } }
    }
    calls.push({ tool: String(e.tool), path: (e as { path?: unknown }).path })
    return String(e.tool).endsWith('request_directory')
      ? { result: {}, text: 'Access granted to C:\\code\\picked' }
      : { result: {}, text: 'ok' }
  })

  return { calls, asked: () => asked }
}

test('a project folder raises no question', async ($, on) => {
  const w = world(on, 'C:\\code\\app', [])
  const sent = await $.prompt.submit({ text: 'hi' })

  expect(w.asked()).toBe(0)
  expect(sent.text).toBe('hi')
})

test('skip lets the prompt through and is asked once', async ($, on) => {
  const w = world(on, `${HOME}\\Documents\\claude`, ['Ohne Ordner weiter'])

  const first = await $.prompt.submit({ text: 'hi' })
  const second = await $.prompt.submit({ text: 'again' })

  expect(w.asked()).toBe(1)
  expect(w.calls.length).toBe(0)
  expect(first.text).toBe('hi')
  expect(first.context).toBe(undefined)
  expect(second.text).toBe('again')
})

test('picking opens the picker and moves the session there', async ($, on) => {
  const w = world(on, HOME, ['Ordner auswählen'])
  const sent = await $.prompt.submit({ text: 'hi' })

  expect(w.calls.map(c => c.tool.split('__').pop())).toEqual(['request_directory', 'change_directory'])
  expect(w.calls[1]!.path).toBe('C:\\code\\picked')
  expect(sent.text).toBe('hi')
  expect(sent.context?.[0]).toContain('C:\\code\\picked')
})

test('a typed path moves the session without the picker', async ($, on) => {
  const w = world(on, HOME, ['C:\\mcctl\\mcportal'])
  await $.prompt.submit({ text: 'hi' })

  expect(w.calls.map(c => c.tool.split('__').pop())).toEqual(['change_directory'])
  expect(w.calls[0]!.path).toBe('C:\\mcctl\\mcportal')
})

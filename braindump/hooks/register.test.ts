import { test, expect } from 'claude-code/testing'
import { braindumpReason } from './register'

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}.`).join(' ')

test('100+ words fires as long', () => {
  expect(braindumpReason(words(100))).toBe('long')
  expect(braindumpReason(words(99))).toBe(undefined)
})

test('short everyday messages do not fire', () => {
  expect(braindumpReason('i mean the one i created myself')).toBe(undefined)
  expect(braindumpReason('the braindump mod was updated, right?')).toBe(undefined)
  expect(
    braindumpReason(
      'Please rename the function getUser to fetchUser in src/api.ts and update every call site. Then run the tests and tell me if anything fails. Keep the old name exported as an alias for now.',
    ),
  ).toBe(undefined)
})

test('rambling medium-length messages fire as erratic', () => {
  expect(
    braindumpReason(
      'ok so um i want like a thing for my mods, you know, that shows stuff... wait no actually more like a list of them and oh and also maybe a button to turn them off or something, idk, whatever is easiest',
    ),
  ).toBe('erratic')
  expect(
    braindumpReason(
      'also ich will halt irgendwie dass das ding automatisch startet wenn ich so viel schreibe oder so, keine ahnung wie das geht, übrigens soll es auch auf deutsch gehen und ach und vielleicht doch nicht immer',
    ),
  ).toBe('erratic')
})

import type { Register } from 'claude-code'

// A message at least this many words long counts as a braindump.
const MIN_WORDS = 150

const NOTE = [
  'This message looks like a long, spoken braindump.',
  'Before doing anything else, use the Skill tool to run the "braindump:braindump" skill,',
  'and treat the user message above as the braindump (not $ARGUMENTS).',
  'Start your reply with one short line saying you switched to braindump mode',
  'and that they can say "skip" to have you just do it as it is.',
  'If the Skill tool refuses because the mod is turned off, ignore this note and answer normally.',
].join(' ')

export const register: Register = on => {
  on('prompt.submit', ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const words = e.text.trim().split(/\s+/).filter(Boolean).length
    const isLong =
      isPerson &&
      !e.command &&
      !e.isMeta &&
      !e.text.trimStart().startsWith('/') &&
      !e.text.includes('```') &&
      words >= MIN_WORDS

    return isLong ? next({ ...e, context: [...(e.context ?? []), NOTE] }) : next(e)
  })
}

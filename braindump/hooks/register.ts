import type { Register } from 'claude-code'

// A message at least this many words long counts as a braindump.
const MIN_WORDS = 100
// Shorter messages count when they read as rambling: at least this many words
// and enough "erratic" signals (see erraticSignals).
const MIN_ERRATIC_WORDS = 30

// Spoken fillers and hedges (English and German).
const FILLERS =
  /\b(u+m+|u+h+|uhm+|e+r+m+|hmm+|ä+h+m*|ö+h+m*|you know|i mean|basically|kinda|sorta|idk|dunno|whatever|or something|or whatever|and stuff|and so on|i guess|like,|halt|irgendwie|keine ahnung|oder so|sozusagen|quasi)(?![\p{L}])/giu
// Changing your mind mid-message.
const CORRECTIONS =
  /\b(wait|no actually|actually no|or rather|scratch that|never ?mind|nvm|or maybe|or no|not sure|oder doch|nee|ach nee|warte|eigentlich doch|vielleicht doch)(?![\p{L}])/giu
// Jumping to another topic.
const JUMPS =
  /\b(oh and|oh also|and also|anyway|anyways|btw|by the way|another thing|übrigens|ach und|und noch|apropos)(?![\p{L}])/giu
// Trailing-off and stacked punctuation.
const TRAILS = /(\.{3,}|…|\?{2,}|!{2,}|\s[-–—]\s)/g

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length
const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean)

/** How many signs of rambling a message shows. */
export function erraticSignals(text: string): number {
  const sentences = text
    .split(/[.!?…\n]+/)
    .map(s => wordsOf(s).length)
    .filter(n => n > 0)
  const longest = Math.max(0, ...sentences)
  const runOn = longest >= 40 ? 2 : longest >= 30 ? 1 : 0
  return count(text, FILLERS) + count(text, CORRECTIONS) + count(text, JUMPS) + count(text, TRAILS) + runOn
}

/** Why a message should start braindump mode, or undefined when it shouldn't. */
export function braindumpReason(text: string): 'long' | 'erratic' | undefined {
  const words = wordsOf(text).length
  if (words >= MIN_WORDS) return 'long'
  // Needs more signals the longer the message is: 3 at 30 words, 5 at 99.
  if (words >= MIN_ERRATIC_WORDS && erraticSignals(text) >= Math.max(3, Math.ceil(words / 20))) return 'erratic'
  return undefined
}

const note = (reason: 'long' | 'erratic') =>
  [
    reason === 'long'
      ? 'This message looks like a long, spoken braindump.'
      : 'This message reads like rambling, unsorted thoughts (a braindump).',
    'Before doing anything else, use the Skill tool to run the "braindump:braindump" skill,',
    'and treat the user message above as the braindump (not $ARGUMENTS).',
    'Start your reply with one short line saying you switched to braindump mode',
    'and that they can say "skip" to have you just do it as it is.',
    'If the Skill tool refuses because the mod is turned off, ignore this note and answer normally.',
  ].join(' ')

export const register: Register = on => {
  on('prompt.submit', ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const eligible =
      isPerson && !e.command && !e.isMeta && !e.text.trimStart().startsWith('/') && !e.text.includes('```')
    const reason = eligible ? braindumpReason(e.text) : undefined

    return reason ? next({ ...e, context: [...(e.context ?? []), note(reason)] }) : next(e)
  })
}

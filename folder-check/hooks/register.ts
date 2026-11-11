import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const PICK = 'Ordner auswählen'
const SKIP = 'Ohne Ordner weiter'
const QUESTION =
  'Diese Session läuft ohne Projektordner. Möchtest du einen Ordner auswählen? (Unter "Other" kannst du auch direkt einen Pfad eintippen.)'

const REQUEST = 'mcp__ccd_directory__request_directory'
const CHANGE = 'mcp__ccd_directory__change_directory'

// Asked once per session: true after a folder was picked or the person skipped.
const settled = atom({ plugin: 'folder-check', key: 'settled' } as const, false)

/** What the question led to. `context` is a note the model reads beside the prompt. */
type Outcome = { message: string; context?: string }

const norm = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** True when the session sits in a catch-all folder rather than a project's. */
async function hasNoProject($: EngineInterface): Promise<boolean> {
  const root = norm(await $.session.root())
  if (root.includes('/scratch-workspaces/')) return true

  const home = norm((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '')
  if (!home) return false

  return ['', '/documents', '/desktop', '/downloads', '/documents/claude']
    .map(tail => home + tail)
    .includes(root)
}

/** The first absolute path in a tool's answer, if it names one. */
function pathIn(text: string): string | undefined {
  const found = text.match(/[A-Za-z]:[\\/][^\r\n"'`<>|*?]*|(?<![\w.])\/(?:Users|home)\/[^\r\n"'`]*/)
  return found?.[0].replace(/[\s.,;:)\]]+$/, '') || undefined
}

async function moveTo($: EngineInterface, path: string): Promise<Outcome> {
  const moved = await $.tool.call({
    tool: CHANGE,
    path,
    consent: `The user chose the folder ${path} in the folder-check question.`,
  })

  if (moved.deny !== undefined || moved.isError) {
    $.ui.log(`folder-check: change_directory answered: ${moved.deny ?? moved.text}`, { to: 'debug' })
    return {
      message: `Konnte nicht nach ${path} wechseln.`,
      context: `The user wants this session to work in the project folder ${path}, but the folder-check mod could not move it there. Before working on the prompt, call ${CHANGE} with that path.`,
    }
  }

  await update($, settled, () => true)
  return {
    message: `Projektordner: ${path}`,
    context: `The user just picked ${path} as this session's project folder. The working directory moves there when this turn ends, so use absolute paths under it until then.`,
  }
}

/** Asks the question and acts on the answer. */
async function ask($: EngineInterface): Promise<Outcome> {
  let answer: string
  try {
    answer = (await $.ui.ask(QUESTION, { options: [PICK, SKIP], header: 'Ordner' })).trim()
  } catch {
    answer = SKIP // dismissed
  }

  if (answer === SKIP || answer === '') {
    await update($, settled, () => true)
    return { message: 'Weiter ohne Projektordner. Mit /folder kannst du später einen wählen.' }
  }

  if (answer !== PICK) return moveTo($, answer) // a path typed under "Other"

  const picked = await $.tool.call({
    tool: REQUEST,
    consent: `The user pressed "${PICK}" on the folder-check question.`,
  })

  if (picked.deny !== undefined) {
    $.ui.log(`folder-check: request_directory denied: ${picked.deny}`, { to: 'debug' })
    await update($, settled, () => true)
    return {
      message: 'Claude öffnet gleich den Ordnerdialog.',
      context: `The user asked to pick a project folder for this session. Before working on the prompt, call ${REQUEST} without a path so they can pick one, then ${CHANGE} with the folder they picked. If the folder cannot be used, tell them why and that /folder asks again.`,
    }
  }

  const path = pathIn(picked.text ?? '')
  if (path === undefined) {
    $.ui.log(`folder-check: no folder in the picker's answer: ${picked.text}`, { to: 'debug' })
    return { message: 'Kein Ordner gewählt. Beim nächsten Prompt frage ich noch einmal.' }
  }

  return moveTo($, path)
}

export const register: Register = on => {
  let isAsking = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'folder',
      description: 'Projektordner für diese Session wählen',
    })
    return next(e)
  })

  on('command.run', { command: 'folder' }, async $ => {
    if (isAsking) return { text: 'Die Ordnerfrage ist schon offen.' }
    isAsking = true
    try {
      const { message, context } = await ask($)
      // Outside a prompt there is no turn to carry the note: send it as one.
      if (context !== undefined) void $.prompt.submit({ text: context })
      return { text: message }
    } finally {
      isAsking = false
    }
  })

  on('prompt.submit', async ($, e, next) => {
    // Only the person's own prompts: not a notification, a peer or another mod.
    const from = e.origin?.kind
    const isTyped = from === undefined || from === 'composer' || from === 'bridge' || from === 'sdk'
    if (!isTyped || e.command !== undefined || e.isMeta || isAsking) return next(e)
    if ((await read($, settled)) || !(await hasNoProject($))) return next(e)

    isAsking = true
    try {
      const { message, context } = await ask($)
      $.ui.toast(message)
      return next(context === undefined ? e : { ...e, context: [...(e.context ?? []), context] })
    } finally {
      isAsking = false
    }
  })
}

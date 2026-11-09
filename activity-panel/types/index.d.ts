export type Phase = 'idle' | 'waiting' | 'thinking' | 'writing' | 'tool'

export type Running = {
  id: string
  tool: string
  label: string
  startedAt: number
  timeoutMs?: number
  agentId?: string
  /** Project-relative path of the file this call works on, if any. */
  path?: string
  verb?: 'reading' | 'editing' | 'writing' | 'searching'
}

export type FileMark = {
  read: number
  edited: number
  isCreated: boolean
  isCommitted: boolean
  lastAt: number
}

export type LogLine = { at: number; text: string; kind: 'ok' | 'err' | 'info' }

export type Activity = {
  phase: Phase
  phaseSince: number
  turnStartedAt: number
  running: Running[]
  current?: { path: string; verb: 'reading' | 'editing' | 'writing' | 'searching' }
  log: LogLine[]
  /** Paths touched in the latest turn, for the end-of-turn summary. */
  turnTouched: string[]
  turnCommitted: number
  lastCommit?: { branch: string; hash: string }
  endReason?: 'answer' | 'aborted' | 'refusal' | 'error'
  turnEndedAt?: number
}

export type DirEntry = { name: string; isDir: boolean }

declare module 'claude-code' {
  interface PluginState {
    'activity-panel': {
      activity: Shaped<Activity>
      files: Shaped<Record<string, FileMark>>
      dirs: Shaped<Record<string, DirEntry[]>>
      expanded: Shaped<Record<string, boolean>>
      now: number
    }
  }
}

export type HatKind =
  | 'research'
  | 'design'
  | 'coding'
  | 'translate'
  | 'writing'
  | 'plan'
  | 'review'
  | 'ops'
  | 'other'

/** What the mascot holds in its hand: a finer hint at the task than the hat. */
export type Accessory =
  | 'magnifier'
  | 'globe'
  | 'book'
  | 'pencil'
  | 'palette'
  | 'wrench'
  | 'laptop'
  | 'bugnet'
  | 'clipboard'
  | 'testtube'
  | 'map'
  | 'bubbles'
  | 'quill'
  | 'rocket'
  | 'branch'
  | 'box'
  | 'database'
  | 'wheel'
  | 'coffee'

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRow = {
  /** Our own key: `<tool_use_id>#<n>`. */
  key: string
  toolUseId: string
  agentId?: string
  hat: HatKind
  /** Missing on rows an earlier version stored: the hat's default is drawn then. */
  accessory?: Accessory
  type: string
  description: string
  prompt: string
  background: boolean
  startedAt: number
  endedAt?: number
  status: AgentStatus
  steps: number
  current?: string
  recent: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'hut-parade': {
      agents: Shaped<AgentRow[]>
      tick: number
    }
  }
}

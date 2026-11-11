export type HatKind =
  | 'research'
  | 'design'
  | 'coding'
  | 'plan'
  | 'review'
  | 'other'

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRow = {
  /** Our own key: `<tool_use_id>#<n>`. */
  key: string
  toolUseId: string
  agentId?: string
  hat: HatKind
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

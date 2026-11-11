/** The person picked a folder or chose to go on without one this session. */
export type Settled = boolean

declare module 'claude-code' {
  interface PluginState {
    'folder-check': {
      settled: Settled
    }
  }
}

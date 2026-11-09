export type ModView = 'all' | 'on' | 'off' | 'mine'

declare module 'claude-code' {
  interface PluginState {
    'mod-switch': { off: string[]; query: string; view: ModView; expanded: string[] }
  }
}

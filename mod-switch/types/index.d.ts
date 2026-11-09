export type ModView = 'all' | 'on' | 'off' | 'mine'

declare module 'claude-code' {
  interface PluginState {
    'mod-switch': {
      off: string[]
      query: string
      view: ModView
      expanded: string[]
      /** The person closed the panel this session: don't bring it back unasked. */
      hidden: boolean
    }
  }
}

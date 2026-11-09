export type ModView = 'all' | 'on' | 'off' | 'mine'

/** An installed plugin whose marketplace lists a newer version. */
export type ModUpdate = {
  /** `name@marketplace`, what `claude plugin update` takes. */
  id: string
  name: string
  marketplace: string
  scope: string
  installed: string
  latest: string
}

declare module 'claude-code' {
  interface PluginState {
    'mod-switch': {
      off: string[]
      query: string
      view: ModView
      expanded: string[]
      /** The person closed the panel this session: don't bring it back unasked. */
      hidden: boolean
      /** Installed plugins with a newer version in their marketplace. */
      updates: ModUpdate[]
      /** Ids updated this session (they apply from the next session). */
      updated: string[]
      /** Ids being updated now, plus 'check' while the check runs. */
      busy: string[]
      /** When the last check finished (ms), 0 before the first. */
      checkedAt: number
      /** The last check's or update's error, '' when none. */
      updateError: string
    }
  }
}

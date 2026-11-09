# claude-mods

Mods for [Claude Code](https://claude.com/claude-code).

| Mod | What it does |
| --- | --- |
| [mod-switch](mod-switch) | A **Mods** side panel listing your installed mods and plugins, with a Pause/Resume switch for each, search, filters, and a layout that adapts to narrow panes. Open it with `/mods`. |
| [braindump](braindump) | Run `/braindump` and ramble. Claude asks a few clarifying questions and turns your thoughts into a clean, structured prompt for you to review. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install mod-switch --marketplace tianvay/claude-mods
/plugin install braindump --marketplace tianvay/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope is the default).

From a shell:

```bash
claude plugin install mod-switch --marketplace tianvay/claude-mods
```

```bash
claude plugin install braindump --marketplace tianvay/claude-mods
```

In the Claude desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins** → **Add marketplace** with `tianvay/claude-mods`, then **Add plugin**.

## Notes

- **mod-switch** pauses a mod's slash commands and skills for the current session only. Mods that only use hooks can't be paused from the panel.

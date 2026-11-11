# tianvay's Claude mods

Small add-ons for [Claude Code](https://claude.com/claude-code) that make it nicer to use.

| Mod | What it does | How to use it |
| --- | --- | --- |
| **[activity-panel](activity-panel)** <sub>v0.1.4</sub> | A side panel showing what Claude is doing right now (thinking, waiting on the model, or stuck on a command) and which files it opened, edited and committed. | Type `/activity` in Claude |
| **[braindump](braindump)** <sub>v0.1.3</sub> | Talk it out like you would to a friend; Claude asks a few questions and turns it into a clear prompt for you to review. | Type `/braindump` in Claude |
| **[folder-check](folder-check)** <sub>v0.1.2</sub> | Warns before the first prompt when the session runs without a project folder, and lets you pick one or carry on without. | Type `/folder` in Claude |
| **[mod-switch](mod-switch)** <sub>v0.1.6</sub> | A side panel listing your mods, with an on/off switch for each. | Type `/mods` in Claude |

You need Claude Code installed first. If you use the **Claude desktop app** and can see a **Code** tab, you already have it.

## Get the mods

### Option A: In the Claude desktop app (no typing)

1. Open the Claude desktop app and go to the **Code** tab.
2. Click the **+** button next to the box where you type your message.
3. Click **Plugins**, then **Add marketplace**.
4. Paste this and confirm:

   ```
   tianvay/claude-mods
   ```

5. Click **Add plugin** next to each mod you want.

### Option B: Copy and paste one line

1. Open a terminal:
   - **Windows:** press the Windows key, type `PowerShell`, press Enter.
   - **Mac:** press Cmd + Space, type `Terminal`, press Enter.
2. Copy this line, paste it into the window, and press Enter:

   ```bash
   claude plugin install activity-panel --marketplace tianvay/claude-mods; claude plugin install braindump --marketplace tianvay/claude-mods; claude plugin install folder-check --marketplace tianvay/claude-mods; claude plugin install mod-switch --marketplace tianvay/claude-mods
   ```

3. If it asks a question, type `y` and press Enter.
4. Close the window and start a new Claude session. Done.

## Get the newest version

I update these mods from time to time. To get the latest, do Option B again with this line instead:

```bash
claude plugin marketplace update claude-mods; claude plugin update activity-panel@claude-mods; claude plugin update braindump@claude-mods; claude plugin update folder-check@claude-mods; claude plugin update mod-switch@claude-mods
```

Then start a new Claude session.

## Remove the mods

```bash
claude plugin uninstall activity-panel@claude-mods; claude plugin uninstall braindump@claude-mods; claude plugin uninstall folder-check@claude-mods; claude plugin uninstall mod-switch@claude-mods; claude plugin marketplace remove claude-mods
```

## Something not working?

- **"claude is not recognized" / "command not found":** Claude Code isn't installed for the terminal. Use Option A instead, or install it from [claude.com/claude-code](https://claude.com/claude-code).
- **Nothing changed after installing:** close Claude and open it again.
- Still stuck? [Open an issue](https://github.com/tianvay/claude-mods/issues) and describe what you saw.

## Notes

- **activity-panel** opens on its own at the start of a session (or type `/activity`). The top card has an animated icon that tells you whether Claude is thinking, waiting on the model, or running a command, with a timer; each running command gets a bar that fills toward its timeout and turns red with "may be hung" when it gets close. In the file tree (with a "Find a file" search box in the desktop app), the file Claude is working on shimmers, files it opened turn purple, edited ones yellow, and committed ones green. When Claude finishes, the card becomes a short summary of what it did. Files count as committed once a `git commit` succeeds.
- **mod-switch** pauses a mod's commands for the current session only. Some mods work quietly in the background and can't be paused.

---

<sub>This page updates itself from the mods in this repository. To change the wording, edit `scripts/README.template.md`.</sub>

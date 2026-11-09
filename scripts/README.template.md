# tianvay's Claude mods

Small add-ons for [Claude Code](https://claude.com/claude-code) that make it nicer to use.

{{TABLE}}

You need Claude Code installed first. If you use the **Claude desktop app** and can see a **Code** tab, you already have it.

## Get the mods

### Option A: In the Claude desktop app (no typing)

1. Open the Claude desktop app and go to the **Code** tab.
2. Click the **+** button next to the box where you type your message.
3. Click **Plugins**, then **Add marketplace**.
4. Paste this and confirm:

   ```
   {{REPO}}
   ```

5. Click **Add plugin** next to each mod you want.

### Option B: Copy and paste one line

1. Open a terminal:
   - **Windows:** press the Windows key, type `PowerShell`, press Enter.
   - **Mac:** press Cmd + Space, type `Terminal`, press Enter.
2. Copy this line, paste it into the window, and press Enter:

   ```bash
   {{INSTALL_ALL}}
   ```

3. If it asks a question, type `y` and press Enter.
4. Close the window and start a new Claude session. Done.

## Get the newest version

I update these mods from time to time. To get the latest, do Option B again with this line instead:

```bash
{{UPDATE_ALL}}
```

Then start a new Claude session.

## Remove the mods

```bash
{{UNINSTALL_ALL}}
```

## Something not working?

- **"claude is not recognized" / "command not found":** Claude Code isn't installed for the terminal. Use Option A instead, or install it from [claude.com/claude-code](https://claude.com/claude-code).
- **Nothing changed after installing:** close Claude and open it again.
- Still stuck? [Open an issue](https://github.com/{{REPO}}/issues) and describe what you saw.

## Notes

- **mod-switch** pauses a mod's commands for the current session only. Some mods work quietly in the background and can't be paused.

---

<sub>This page updates itself from the mods in this repository. To change the wording, edit `scripts/README.template.md`.</sub>

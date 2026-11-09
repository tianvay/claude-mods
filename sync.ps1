# Brings this repository up to date with your mods and publishes it.
# mod-switch runs this automatically at the start of every Claude Code session
# (see ~/.claude/mod-publish.json); you can also run it by hand:
#
#   powershell -ExecutionPolicy Bypass -File sync.ps1           copy, bump versions, rebuild, commit, push,
#                                                               then check the marketplace on this computer lists every mod
#   powershell -ExecutionPolicy Bypass -File sync.ps1 -NoPush   same, but stop after the commit
#
# Mods are copied from %USERPROFILE%\.claude\mods. A mod deleted there is NOT
# deleted here; remove its folder by hand if you want it gone.
#
# The last line printed is a one-line summary starting with RESULT:, which mod-switch shows.
param([switch]$NoPush)

# Continue, not Stop: Windows PowerShell treats any line a native tool (git,
# node) writes to stderr as an error under Stop. Exit codes are checked instead.
$ErrorActionPreference = 'Continue'
$repo = $PSScriptRoot
$source = Join-Path $env:USERPROFILE '.claude\mods'
$lock = Join-Path $repo '.git\sync.lock'

function Done([string]$msg, [int]$code = 0) {
    Remove-Item $lock -ErrorAction SilentlyContinue
    Write-Output "RESULT: $msg"
    exit $code
}

# The claude command: on PATH, else the newest copy the desktop app installed.
function Find-Claude {
    $onPath = Get-Command claude -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $candidates = @(
        (Join-Path $env:USERPROFILE '.local\bin\claude.exe'),
        (Join-Path $env:APPDATA 'npm\claude.cmd')
    ) | Where-Object { Test-Path $_ }
    if ($candidates) { return $candidates[0] }
    $desktop = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Claude-Data\*\claude-code\*\*\claude.exe') -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($desktop) { return $desktop.FullName }
    return $null
}

# Checks that this computer's copy of the marketplace lists every mod in this
# repository at its current version, refreshing it from GitHub when it is
# behind. Returns $null when all is well, else a short description of the
# problem. A marketplace never added on this computer is not checked.
function Test-Marketplace {
    $mine = Get-Content -Raw (Join-Path $repo '.claude-plugin\marketplace.json') | ConvertFrom-Json
    $knownFile = Join-Path $env:USERPROFILE '.claude\plugins\known_marketplaces.json'
    if (-not (Test-Path $knownFile)) { return $null }
    $entry = (Get-Content -Raw $knownFile | ConvertFrom-Json).PSObject.Properties[$mine.name]
    if (-not $entry) { return $null }
    $clone = $entry.Value.installLocation
    $want = @($mine.plugins | ForEach-Object { "$($_.name)@$($_.version)" })

    $missing = {
        $file = Join-Path $clone '.claude-plugin\marketplace.json'
        $have = if (Test-Path $file) { @((Get-Content -Raw $file | ConvertFrom-Json).plugins | ForEach-Object { "$($_.name)@$($_.version)" }) } else { @() }
        @($want | Where-Object { $have -notcontains $_ })
    }

    $head = git -C $repo rev-parse HEAD
    $cloneHead = git -C $clone rev-parse HEAD 2>$null
    if ($cloneHead -eq $head -and (& $missing).Count -eq 0) { return $null }

    $claude = Find-Claude
    if (-not $claude) { return "the marketplace on this computer is behind and the claude command wasn't found to refresh it" }
    Write-Host "refreshing marketplace $($mine.name) (it was at $(if ($cloneHead) { $cloneHead.Substring(0, 7) } else { 'nothing' }))"
    & $claude plugin marketplace update $mine.name 2>&1 | ForEach-Object { Write-Host "  $_" }
    $global:LASTEXITCODE = 0

    $still = & $missing
    if ($still.Count -gt 0) { return "the marketplace on this computer doesn't list: $($still -join ', ')" }
    return $null
}

# One sync at a time (two sessions starting together would trip over git).
if ((Test-Path $lock) -and ((Get-Item $lock).LastWriteTime -gt (Get-Date).AddMinutes(-10))) {
    Write-Output 'RESULT: skipped, another sync is running'
    exit 0
}
New-Item -ItemType File -Force $lock | Out-Null

try {
    if (-not (Test-Path $source)) { Done "no mods folder at $source" 1 }

    # 1. Mirror each mod folder (skipping engine-written types, git data and dependencies).
    $names = @()
    Get-ChildItem $source -Directory | Where-Object { Test-Path (Join-Path $_.FullName '.claude-plugin\plugin.json') } | ForEach-Object {
        $dest = Join-Path $repo $_.Name
        $engineTypes = Join-Path $_.FullName '.claude-plugin\types'
        robocopy $_.FullName $dest /MIR /NFL /NDL /NJH /NJS /NP /XD $engineTypes .git node_modules /XF *.log .DS_Store | Out-Null
        if ($LASTEXITCODE -ge 8) { Done "copying $($_.Name) failed (robocopy exit $LASTEXITCODE)" 1 }
        $names += $_.Name
    }
    $global:LASTEXITCODE = 0
    Write-Output "copied: $($names -join ', ')"

    # 2. Bump the version of each changed mod, so people who installed it get the update.
    $bumps = @(node (Join-Path $repo 'scripts\bump.mjs') $source)
    if ($LASTEXITCODE -ne 0) { Done 'version bump failed' 1 }
    $bumps | ForEach-Object { Write-Output $_ }

    # 3. Rebuild README.md and marketplace.json, and refuse on anything that looks like a key.
    $build = node (Join-Path $repo 'scripts\build.mjs') --check 2>&1
    $build | ForEach-Object { Write-Output "$_" }
    if ($LASTEXITCODE -ne 0) { Done 'stopped: a file looks like it holds a key, nothing was published' 1 }

    # 4. Commit when something changed.
    git -C $repo add -A 2>$null
    git -C $repo diff --cached --quiet
    $changed = $LASTEXITCODE -ne 0
    if ($changed) {
        $what = (git -C $repo diff --cached --name-only | ForEach-Object { ($_ -split '/')[0] } |
            Where-Object { $names -contains $_ } | Sort-Object -Unique) -join ', '
        if (-not $what) { $what = 'repository files' }
        git -C $repo commit -q -m "Update $what" 2>$null
        if ($LASTEXITCODE -ne 0) { Done 'commit failed' 1 }
    }

    # 5. Push whatever GitHub doesn't have yet.
    if ($NoPush) { if ($changed) { Done "committed $what (not pushed)" } else { Done 'up to date' } }
    if (-not (git -C $repo remote)) { if ($changed) { Done "committed $what; no GitHub remote set yet" } else { Done 'up to date; no GitHub remote set yet' } }

    git -C $repo rev-parse --abbrev-ref '@{u}' 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        git -C $repo push -q -u origin main 2>&1 | ForEach-Object { Write-Output "$_" }
    } else {
        $ahead = git -C $repo rev-list --count '@{u}..HEAD'
        if ($ahead -eq '0') {
            # Nothing to push, but the marketplace on this computer may still be behind.
            $problem = Test-Marketplace
            if ($problem) { Done "up to date on GitHub, but $problem" 1 }
            Done 'up to date'
        }
        git -C $repo push -q 2>&1 | ForEach-Object { Write-Output "$_" }
    }
    if ($LASTEXITCODE -ne 0) { Done 'push to GitHub failed (signed out or offline?); it will retry next session' 1 }
    $published = if ($changed) { "published $what" } else { 'published earlier changes' }

    # 6. Check the marketplace the way someone installing would see it.
    $problem = Test-Marketplace
    if ($problem) { Done "$published, but $problem" 1 }
    Done "$published; the marketplace lists every mod"
}
catch {
    Done "failed: $($_.Exception.Message)" 1
}

# Brings this repository up to date with your mods and publishes it.
#
#   .\sync.ps1            copy mods from ~/.claude/mods, rebuild README + marketplace, commit, push
#   .\sync.ps1 -NoPush    same, but stop after the commit
#
# Mods are copied from %USERPROFILE%\.claude\mods (the folder mod-switch auto-loads from).
# A mod deleted there is NOT deleted here; remove its folder by hand if you want it gone.
param([switch]$NoPush)

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$source = Join-Path $env:USERPROFILE '.claude\mods'

if (-not (Test-Path $source)) { throw "No mods folder at $source" }

# 1. Mirror each mod folder (skipping engine-written types, git data and dependencies).
Get-ChildItem $source -Directory | Where-Object { Test-Path (Join-Path $_.FullName '.claude-plugin\plugin.json') } | ForEach-Object {
    $dest = Join-Path $repo $_.Name
    $engineTypes = Join-Path $_.FullName '.claude-plugin\types'
    robocopy $_.FullName $dest /MIR /NFL /NDL /NJH /NJS /NP /XD $engineTypes .git node_modules /XF *.log .DS_Store | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copying $($_.Name) failed (robocopy exit $LASTEXITCODE)" }
    Write-Host "copied $($_.Name)"
}
$global:LASTEXITCODE = 0

# 2. Regenerate README.md and marketplace.json, and refuse on anything that looks like a key.
node (Join-Path $repo 'scripts\build.mjs') --check
if ($LASTEXITCODE -ne 0) { throw 'Build or key check failed; nothing was committed.' }

# 3. Commit and push when something changed.
git -C $repo add -A
git -C $repo diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Write-Host 'Already up to date.'; exit 0 }

git -C $repo diff --cached --stat
git -C $repo commit -q -m "Update mods $(Get-Date -Format 'yyyy-MM-dd')"
if ($LASTEXITCODE -ne 0) { throw 'Commit failed.' }

if ($NoPush) { Write-Host 'Committed; not pushed (-NoPush).'; exit 0 }
git -C $repo push
if ($LASTEXITCODE -ne 0) { throw 'Push failed. Fix the problem above, then run: git push' }
Write-Host 'Pushed.'

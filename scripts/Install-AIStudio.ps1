# Run after Codex has checked active tasks, saved inputs and created a data recovery point.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Checksums
)
$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$checksumPath = (Resolve-Path -LiteralPath $Checksums).Path
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }
if ([Environment]::OSVersion.Version.Major -lt 10) { throw 'Windows 10 or later is required.' }
$expectedName = 'AIStudio-0.2.4-win-x64-setup.exe'
if ([IO.Path]::GetFileName($installerPath) -ne $expectedName) { throw "Expected $expectedName" }
$matched = @([IO.File]::ReadAllLines($checksumPath) | Where-Object {
  $_ -match ('^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape($expectedName) + '$')
})
if ($matched.Count -ne 1) { throw 'Checksum entry missing or duplicated.' }
$expectedHash = ($matched[0] -split '\s+')[0]
$actualHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) { throw 'Installer SHA256 mismatch. Do not install.' }
$running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*AIStudio*' }
if ($running) { throw 'AIStudio is running. Save inputs, finish jobs and exit normally before installing.' }
Write-Host 'SHA256 verified. Installing for the current Windows user; application data will be retained.'
$result = Start-Process -FilePath $installerPath -ArgumentList '/S' -Wait -PassThru
if ($result.ExitCode -notin @(0, 3010)) { throw "Installer failed: exit $($result.ExitCode)" }
if ($result.ExitCode -eq 3010) { Write-Host 'Installer requests Windows restart. Save other work before restarting.'; exit 3010 }
# Use the registered install location when available, including custom locations.
$registryRoots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
$entries = @(Get-ItemProperty -Path $registryRoots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*AIStudio*' })
$candidates = @()
foreach ($entry in $entries) {
  if ($entry.InstallLocation) { $candidates += (Join-Path $entry.InstallLocation ('环中AIStudio.exe')) }
}
$candidates += (Join-Path $env:LOCALAPPDATA 'Programs\环中AIStudio\环中AIStudio.exe')
$appPath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -Unique -First 1
if (-not $appPath) { throw 'Installation returned success, but executable location was not found. Inspect the shortcut and registry; do not reinstall with a different account.' }
Start-Process -FilePath $appPath
Write-Host "Launched: $appPath"
Write-Host ('Next: inspect the actual window and ' + (Join-Path $env:APPDATA '环中AIStudio\desktop.log') + '; verify v0.2.4, existing projects and API settings, then exit/reopen.')

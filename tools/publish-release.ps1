# Выпуск на GitHub: установщик, переносная версия и APK из dist\ + описание из docs\release-notes-<версия>.md
#   powershell -File tools\publish-release.ps1                 — версия из app\package.json
# Вход в GitHub выполняет сам пользователь: gh auth login.
param([string]$Version = '', [string]$Repo = '', [string]$Gh = '')
$ErrorActionPreference = 'Continue'
$R = Split-Path $PSScriptRoot -Parent
if (-not $Gh) { $Gh = if (Test-Path 'E:\Tools\gh\bin\gh.exe') { 'E:\Tools\gh\bin\gh.exe' } else { 'gh' } }
if (-not $Version) { $Version = (Get-Content "$R\app\package.json" -Raw | ConvertFrom-Json).version }
$apkVer = ([regex]::Match((Get-Content "$R\phone\app\build.gradle.kts" -Raw), 'versionName = "([^"]+)"')).Groups[1].Value
$assets = @("$R\dist\FelixSetup-$Version.exe", "$R\dist\Felix-$Version.exe", "$R\dist\FelixLink-$apkVer.apk")
foreach ($a in $assets) { if (-not (Test-Path $a)) { throw "нет файла $a — сначала build\Build-Phone.ps1 и build\Build-Felix.ps1" } }
$notes = "$R\docs\release-notes-$Version.md"
if (-not (Test-Path $notes)) { throw "нет описания выпуска $notes" }
$owner = & $Gh api user -q .login; if ($LASTEXITCODE -or -not $owner) { throw 'gh: не выполнен вход (gh auth login)' }
if (-not $Repo) { $Repo = "$owner/felix-assistant" }
$title = 'Феликс ' + ($Version -replace '\.0$', '')
& $Gh release create "v$Version" @assets --repo $Repo --title $title --notes-file $notes --latest
if ($LASTEXITCODE) { throw 'release create failed' }
& $Gh release view "v$Version" --repo $Repo --json url,assets -q '.url, (.assets[] | "\(.name)  \(.size)  \(.state)")'

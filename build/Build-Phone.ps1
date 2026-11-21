# Собирает «Феликс Link» для Android → dist\FelixLink-<версия>.apk и stage\phone\FelixLink.apk (его раздаёт компьютер по QR-коду)
#   powershell -ExecutionPolicy Bypass -File build\Build-Phone.ps1 [-Tools <папка с jdk, sdk, gradle-8.9>]
# Инструменты: JDK 17+, Android SDK 34, Gradle 8.9. Либо одной папкой (-Tools или FELIX_ANDROID_TOOLS: jdk\, sdk\, gradle-8.9\),
# либо как обычно: JAVA_HOME, ANDROID_HOME и gradle в PATH. Без phone\keystore\keystore.properties APK подписывается отладочным ключом.
param([string]$Tools = $env:FELIX_ANDROID_TOOLS)
$ErrorActionPreference = 'Stop'
$R = Split-Path $PSScriptRoot -Parent
if (-not $Tools -and (Test-Path 'E:\YatagarasuBuild\android\gradle-8.9')) { $Tools = 'E:\YatagarasuBuild\android' }
$gradle = 'gradle'
if ($Tools) {
  $env:JAVA_HOME = "$Tools\jdk"; $env:ANDROID_HOME = "$Tools\sdk"; $env:ANDROID_SDK_ROOT = "$Tools\sdk"
  $env:ANDROID_USER_HOME = "$Tools\user-home"; $env:GRADLE_USER_HOME = "$Tools\gradle-home"
  $gradle = "$Tools\gradle-8.9\bin\gradle.bat"
}
Push-Location "$R\phone"
try {
  cmd /c "`"$gradle`" --no-daemon -q assembleRelease > `"$R\phone\build-release.log`" 2>&1"
  if ($LASTEXITCODE -ne 0) { Get-Content "$R\phone\build-release.log" -Tail 40; throw "gradle failed ($LASTEXITCODE)" }
} finally { Pop-Location }
$ver = ([regex]::Match((Get-Content "$R\phone\app\build.gradle.kts" -Raw), 'versionName = "([^"]+)"')).Groups[1].Value
$apk = "$R\phone\build\app\outputs\apk\release\app-release.apk"
New-Item -ItemType Directory -Force "$R\dist", "$R\stage\phone" | Out-Null
Copy-Item $apk "$R\dist\FelixLink-$ver.apk" -Force
Copy-Item $apk "$R\stage\phone\FelixLink.apk" -Force
Write-Output ("FelixLink-{0}.apk: {1:N1} MB" -f $ver, ((Get-Item $apk).Length / 1MB))

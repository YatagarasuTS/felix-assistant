# Сборка «Феликса»: папка программы → установщик FelixSetup-<версия>.exe, переносной exe и ZIP в dist\
#   powershell -ExecutionPolicy Bypass -File build\Build-Felix.ps1 [-Electron <папка electron\dist>]
# Нужно (подробно — docs\BUILDING.md): Electron 33 (npm i electron@33 или своя папка), .NET SDK (FelixCore),
# tools\bin\rcedit-x64.exe (значок и сведения Felix.exe), данные в stage\ (голоса Piper, модель Vosk, нативные библиотеки).
param([string]$Electron = $env:FELIX_ELECTRON)
$ErrorActionPreference = 'Stop'
$R = Split-Path $PSScriptRoot -Parent
if (-not $Electron) {
  foreach ($c in @("$R\node_modules\electron\dist", "$R\app\node_modules\electron\dist", 'D:\YatagarasuOs\src\shell\node_modules\electron\dist')) { if (Test-Path "$c\electron.exe") { $Electron = $c; break } }
}
if (-not $Electron -or -not (Test-Path "$Electron\electron.exe")) { throw 'Не найден Electron: укажите -Electron <папка с electron.exe> или FELIX_ELECTRON (см. docs\BUILDING.md)' }
$Version = (Get-Content "$R\app\package.json" -Raw | ConvertFrom-Json).version
$Out = "$R\build\out\Felix"
$Dist = "$R\dist"
$fw = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319'
function Sync($a, $b) { New-Item -ItemType Directory -Force $b | Out-Null; robocopy $a $b /MIR /NJH /NJS /NFL /NDL /NP | Out-Null; if ($LASTEXITCODE -ge 8) { throw "robocopy $a -> $b ($LASTEXITCODE)" } }
function Step($t) { Write-Output ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $t) }

Step "Феликс $Version"
# версия установщика должна совпадать с программой (иначе переносная версия распакуется не в ту папку)
if ((Get-Content "$R\build\installer\FelixSetup.cs" -Raw) -notmatch "Version = `"$([regex]::Escape($Version))`"") { throw "Версия в build\installer\FelixSetup.cs не равна $Version (app\package.json)" }
# 1. нативные помощники
Step 'FelixCore (dotnet) и FelixInput (csc)'
Push-Location "$R\native\core"; dotnet build -c Release -o "$R\native\out" -v q | Out-Null; if ($LASTEXITCODE) { throw 'FelixCore build failed' }; Pop-Location
& "$fw\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ /out:"$R\native\out\FelixInput.exe" "/r:$fw\System.Runtime.dll" "/r:$fw\System.Threading.Tasks.dll" "/r:C:\Windows\System32\WinMetadata\Windows.Foundation.winmd" "/r:C:\Windows\System32\WinMetadata\Windows.Media.winmd" "$R\native\input\FelixInput.cs"
if ($LASTEXITCODE) { throw 'FelixInput build failed' }

# 2. Electron → Felix.exe
Step 'Electron → Felix.exe'
Sync $Electron $Out
Rename-Item "$Out\electron.exe" 'Felix.exe' -Force
Remove-Item "$Out\resources\default_app.asar" -Force -ErrorAction SilentlyContinue
Get-ChildItem "$Out\locales" -Filter *.pak | Where-Object { $_.BaseName -notin 'ru', 'en-US' } | Remove-Item -Force
& "$R\tools\bin\rcedit-x64.exe" "$Out\Felix.exe" --set-icon "$R\app\ui\assets\felix.ico" `
  --set-version-string FileDescription 'Felix — voice desktop assistant' --set-version-string ProductName 'Felix' `
  --set-version-string CompanyName 'Felix' --set-version-string LegalCopyright '© 2026 YatagarasuTS and Felix contributors · MIT' `
  --set-version-string OriginalFilename 'Felix.exe' --set-version-string InternalName 'Felix' `
  --set-file-version $Version --set-product-version $Version
if ($LASTEXITCODE) { throw 'rcedit failed' }

# 3. код приложения
Step 'resources\app'
$App = "$Out\resources\app"
New-Item -ItemType Directory -Force $App | Out-Null
Copy-Item "$R\app\main.js", "$R\app\preload.js", "$R\app\package.json" $App -Force
Sync "$R\app\lib" "$App\lib"
Sync "$R\app\ui" "$App\ui"
Sync "$R\app\node_modules" "$App\node_modules"
# из пакетов — только то, что нужно для работы: без исходников TypeScript, типов и карт
Get-ChildItem "$App\node_modules" -Recurse -File -Include *.d.ts, *.d.mts, *.d.cts, *.map, *.ts, *.mts, *.md -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^(LICENSE|README)' } | Remove-Item -Force
Get-ChildItem "$App\node_modules" -Recurse -Directory -Filter src | Where-Object { $_.FullName -match '@anthropic-ai\\sdk\\src$' } | Remove-Item -Recurse -Force

# 4. голос, распознавание, модель, звуки, помощники
Step 'данные программы'
Sync "$R\native\out" "$Out\native"
Get-ChildItem "$Out\native" -Filter *.pdb | Remove-Item -Force
Sync "$R\stage\voice" "$Out\voice"
Sync "$R\stage\stt" "$Out\stt"
Sync "$R\stage\models" "$Out\models"
Sync "$R\stage\sounds" "$Out\sounds"
Copy-Item "$R\model\felix.vrm" "$Out\models\felix.vrm" -Force
# «Феликс Link»: Феликс раздаёт APK телефону по QR-коду (сначала build\Build-Phone.ps1)
if (-not (Test-Path "$R\stage\phone\FelixLink.apk")) { throw 'нет stage\phone\FelixLink.apk — сначала build\Build-Phone.ps1' }
Sync "$R\stage\phone" "$Out\phone"

# 5. документы и лицензии
Step 'лицензии'
Copy-Item "$R\docs\LICENSE.txt" "$Out\LICENSE.txt" -Force
Copy-Item "$R\docs\README.txt" "$Out\README.txt" -Force
$mit = { param($what, $who) "MIT License`r`n`r`nCopyright (c) $who`r`n`r`nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the `"Software`"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:`r`n`r`nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.`r`n`r`nTHE SOFTWARE IS PROVIDED `"AS IS`", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE." }
$sb = New-Object Text.StringBuilder
[void]$sb.Append((Get-Content "$R\docs\THIRD-PARTY-NOTICES.head.txt" -Raw -Encoding UTF8))
$sec = { param($title, $text) [void]$sb.Append("`r`n`r`n==============================================================================`r`n$title`r`n==============================================================================`r`n$text") }
& $sec 'Electron' (Get-Content "$Electron\LICENSE" -Raw)
& $sec 'three.js' (Get-Content "$R\docs\licenses\three.js-LICENSE.txt" -Raw -Encoding UTF8)
& $sec '@pixiv/three-vrm' (Get-Content "$R\docs\licenses\three-vrm-LICENSE.txt" -Raw -Encoding UTF8)
& $sec 'Piper' (& $mit 'Piper' '2022 Michael Hansen')
& $sec 'NAudio' (& $mit 'NAudio' '2020 Mark Heath')
& $sec 'qrcode-generator (QR Code — зарегистрированный товарный знак DENSO WAVE INCORPORATED)' (& $mit 'qrcode-generator' '2009 Kazuhiko Arase')
& $sec 'Anthropic TypeScript SDK, Vosk API, vosk-model-small-ru, @opentelemetry/api — Apache License 2.0' (Get-Content "$R\docs\licenses\Apache-2.0.txt" -Raw)
& $sec 'Голоса Piper: наборы данных — CC0 1.0' (Get-Content "$R\docs\licenses\CC0-1.0.txt" -Raw)
& $sec 'eSpeak NG — GNU General Public License v3' (Get-Content "$R\docs\licenses\GPL-3.0.txt" -Raw)
[IO.File]::WriteAllText("$Out\THIRD-PARTY-NOTICES.txt", $sb.ToString(), (New-Object Text.UTF8Encoding($true)))

# 6. архив программы
Step 'архив'
New-Item -ItemType Directory -Force $Dist | Out-Null
$zip = "$R\build\payload.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($Out, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)

# 7. установщик: заглушка (C#) + архив + длина + метка
Step 'установщик'
$stub = "$R\build\installer\FelixSetup.stub.exe"
Copy-Item "$R\app\ui\assets\felix_portrait.png" "$R\build\installer\portrait.png" -Force
Copy-Item "$R\docs\LICENSE.txt" "$R\build\installer\license.txt" -Force
& "$fw\csc.exe" /nologo /target:winexe /platform:anycpu /optimize+ /out:$stub /win32icon:"$R\app\ui\assets\felix.ico" /win32manifest:"$R\build\installer\setup.manifest" `
  /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  /resource:"$R\build\installer\portrait.png",portrait.png /resource:"$R\build\installer\license.txt",license.txt "$R\build\installer\FelixSetup.cs"
if ($LASTEXITCODE) { throw 'installer build failed' }
function Pack($stubExe, $outExe, $magic) {
  $fs = [IO.File]::Open($outExe, 'Create')
  try {
    $b = [IO.File]::ReadAllBytes($stubExe); $fs.Write($b, 0, $b.Length)
    $z = [IO.File]::OpenRead($zip); try { $z.CopyTo($fs); $len = $z.Length } finally { $z.Close() }
    $t = [BitConverter]::GetBytes([long]$len); $fs.Write($t, 0, 8)
    $m = [Text.Encoding]::ASCII.GetBytes($magic); $fs.Write($m, 0, 8)
  } finally { $fs.Close() }
}
Pack $stub "$Dist\FelixSetup-$Version.exe" 'FELIXPK1'

# 8. переносная версия одним файлом: тот же исходник с PORTABLE, метка FELIXPT1
Step 'переносной exe'
$pstub = "$R\build\installer\Felix.portable.stub.exe"
& "$fw\csc.exe" /nologo /target:winexe /platform:anycpu /optimize+ /define:PORTABLE /out:$pstub /win32icon:"$R\app\ui\assets\felix.ico" /win32manifest:"$R\build\installer\setup.manifest" `
  /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  /resource:"$R\build\installer\portrait.png",portrait.png /resource:"$R\build\installer\license.txt",license.txt "$R\build\installer\FelixSetup.cs"
if ($LASTEXITCODE) { throw 'portable build failed' }
Pack $pstub "$Dist\Felix-$Version.exe" 'FELIXPT1'
Copy-Item $zip "$Dist\Felix-$Version-portable.zip" -Force
$apkVer = ([regex]::Match((Get-Content "$R\phone\app\build.gradle.kts" -Raw), 'versionName = "([^"]+)"')).Groups[1].Value
if (Test-Path "$R\stage\phone\FelixLink.apk") { Copy-Item "$R\stage\phone\FelixLink.apk" "$Dist\FelixLink-$apkVer.apk" -Force }
Get-ChildItem $Dist | ForEach-Object { Write-Output ("  {0}  {1:N0} МБ" -f $_.Name, ($_.Length / 1MB)) }
Step 'готово'

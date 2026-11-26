# Все проверки на живом Феликсе из исходников (данные — test\data_phone, код сопряжения TESTCODE):
# разбор команд, эмулятор телефона (дела, окно «Телефон»), трансляция экрана 60 к/с и касания,
# гардероб и развлечения, связь (сопряжение, неверный код, APK), поглаживание и перетаскивание.
# Запуск: powershell -File test\run_all.ps1 [-Electron путь\electron.exe]
param([string]$Electron = $env:FELIX_ELECTRON_EXE)
$ErrorActionPreference = 'Stop'
$R = Split-Path $PSScriptRoot -Parent
if (-not $Electron) {
  $d = if ($env:FELIX_ELECTRON) { $env:FELIX_ELECTRON } else { "$R\node_modules\electron\dist" }
  foreach ($c in @($d, 'D:\YatagarasuOs\src\shell\node_modules\electron\dist')) { if (Test-Path "$c\electron.exe") { $Electron = "$c\electron.exe"; break } }
}
if (-not $Electron) { throw 'Не найден Electron: -Electron <путь к electron.exe> или FELIX_ELECTRON (папка)' }
$data = "$R\test\data_phone"; $rep = "$R\test\reports"; New-Item -ItemType Directory -Force $rep | Out-Null
$key = 'hook-' + [guid]::NewGuid().ToString('N').Substring(0, 12)

function Node($script, [string[]]$a) {
  $env:ELECTRON_RUN_AS_NODE = '1'
  $p = Start-Process $Electron -ArgumentList (@($script) + $a) -Wait -PassThru -NoNewWindow -RedirectStandardOutput "$rep\stdout.txt"
  Remove-Item Env:ELECTRON_RUN_AS_NODE
  return $p.ExitCode
}
function Stop-Felix { if (Test-Path "$data\pid.txt") { $id = [int](Get-Content "$data\pid.txt"); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Start-Sleep 2 } }
function Start-Felix {
  $env:FELIX_DATA = $data; $env:FELIX_TEST = $key; $env:FELIX_PICTURES = "$R\test\wpics"; $env:FELIX_SHOTS = "$R\test\shots_w"
  $f = Start-Process $Electron -ArgumentList "`"$R\app`"", '--silent' -PassThru
  $f.Id | Out-File "$data\pid.txt"
  'FELIX_DATA', 'FELIX_TEST', 'FELIX_PICTURES', 'FELIX_SHOTS' | ForEach-Object { Remove-Item "Env:$_" }
  Start-Sleep 11
}
# чистое состояние: приложения для дел не выбраны, Феликс в углу
$cfgJs = "const f=process.argv[process.argv.length-1],fs=require('fs');const c=JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));c.phone.services={};c.phone.places={home:'',work:''};c.assistant.at={x:null,y:null};c.assistant.side='right';fs.writeFileSync(f,JSON.stringify(c,null,2));"
$res = [ordered]@{}
foreach ($t in 'brain-test.js', 'brain-phone-test.js', 'brain-wardrobe-test.js') { $res[$t] = Node "$R\tools\$t" @(); Copy-Item "$rep\stdout.txt" "$rep\$t.txt" }

Stop-Felix
$env:ELECTRON_RUN_AS_NODE = '1'; Start-Process $Electron -ArgumentList '-e', "`"$cfgJs`"", "$data\config.json" -Wait -NoNewWindow; Remove-Item Env:ELECTRON_RUN_AS_NODE
Start-Felix
$res['link_phone_test'] = Node "$R\test\link_phone_test.js" @('TESTCODE', "$rep\link_phone.txt")
Start-Sleep 2
$res['cast_test'] = Node "$R\test\cast_test.js" @('TESTCODE', $key, "$rep\cast.txt")
Start-Sleep 2
$res['wardrobe_test'] = Node "$R\test\wardrobe_test.js" @('TESTCODE', "$rep\wardrobe.txt")
Start-Sleep 2
& "$R\test\pet_drag_test.ps1" -Key $key -Data $data -Out "$rep\pet_drag.txt"
$res['pet_drag_test'] = if ((Get-Content "$rep\pet_drag.txt" -Encoding UTF8 | Select-Object -Last 1) -match ', 0 ошибок') { 0 } else { 1 }
$res['link_client'] = Node "$R\test\link_client.js" @('TESTCODE', "$rep\link_client.txt", "$R\stage\phone\FelixLink.apk")
Stop-Felix
$res.GetEnumerator() | ForEach-Object { '{0,-24} {1}' -f $_.Key, $(if ($_.Value -eq 0) { 'OK' } else { "ОШИБКИ ($($_.Value))" }) }

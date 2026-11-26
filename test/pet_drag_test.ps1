# Проверка «погладить» и «перетащить» на живом Феликсе (FELIX_TEST=<пароль>) НАСТОЯЩИМ курсором:
# курсор ходит туда-сюда над головой (без нажатий), потом Феликса «берут» за грудь (нажатие — синтетическое,
# прямо в окно Феликса, чтобы не кликнуть ничего на рабочем столе), ведут курсором и отпускают.
# Курсор в конце возвращается на место. Запуск: test\pet_drag_test.ps1 <пароль> <папка-данных> <отчёт>
param([string]$Key, [string]$Data, [string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class M { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p); }
'@
$lines = New-Object System.Collections.Generic.List[string]
function Log($s) { $lines.Add(('{0:HH:mm:ss.fff} {1}' -f (Get-Date), $s)); $lines | Set-Content -Encoding UTF8 $Out }
$pass = 0; $fail = 0
function Ok($c, $what) { if ($c) { $script:pass++; Log "PASS $what" } else { $script:fail++; Log "FAIL $what" } }

$tc = New-Object System.Net.Sockets.TcpClient('127.0.0.1', 47898)
$st = $tc.GetStream(); $wr = New-Object System.IO.StreamWriter($st); $wr.AutoFlush = $true
$rd = New-Object System.IO.StreamReader($st)
$script:id = 0
function Hook($o) { $script:id++; $o.key = $Key; $o.id = $script:id; $wr.WriteLine(($o | ConvertTo-Json -Compress -Depth 5)); ($rd.ReadLine() | ConvertFrom-Json).v }
function Js($e) { Hook @{ c = 'js'; win = 'assistant'; expr = $e } }

$orig = New-Object M+P; [void][M]::GetCursorPos([ref]$orig)
try {
  $side0 = (Get-Content (Join-Path $Data 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json).assistant.side
  $b = Hook @{ c = 'bounds'; win = 'assistant' }
  $p = Js 'window.__petState()'
  $k = [double]$p.dpr
  Log ("окно {0},{1} {2}x{3}; голова {4:0},{5:0}; px/м {6:0}; масштаб {7}" -f $b.x, $b.y, $b.width, $b.height, $p.head.x, $p.head.y, $p.pxPerM, $k)
  function Cur($cx, $cy) { [void][M]::SetCursorPos([int](($b.x + $cx) * $k), [int](($b.y + $cy) * $k)) }

  # 1. гладим: туда-сюда по 0,13 м в каждую сторону, 2,5 раза в секунду, 3 секунды
  $hx = [double]$p.head.x; $hy = [double]$p.head.y; $amp = 0.13 * [double]$p.pxPerM
  Cur $hx $hy; Start-Sleep -Milliseconds 400
  $cursor = (Js 'window.__petState()').cursor
  Ok ($cursor -eq 'grab') "курсор над головой — ладонь ($cursor)"
  $t0 = Get-Date; $seenOn = $false; $maxTurns = 0
  while (((Get-Date) - $t0).TotalMilliseconds -lt 3200) {
    $t = ((Get-Date) - $t0).TotalSeconds
    Cur ($hx + [Math]::Sin($t * 2 * [Math]::PI * 1.25) * $amp) ($hy + [Math]::Sin($t * 9) * 4)
    Start-Sleep -Milliseconds 15
    if ([int]($t * 10) % 4 -eq 0) { $s = Js 'window.__petState()'; if ($s.on) { $seenOn = $true }; if ($s.turns -gt $maxTurns) { $maxTurns = $s.turns } }
  }
  $s = Js 'window.__petState()'
  Ok ($seenOn -and $s.on) "гладят: Феликс жмурится и тянется к руке (развороты: $maxTurns)"
  Start-Sleep -Milliseconds 600
  $log = Get-Content (Join-Path $Data 'felix.log') -Encoding UTF8 -Tail 30
  Ok (($log | Select-String 'petted') -ne $null) 'больше 1,5 с — отвечает голосом (petted в журнале)'
  Cur ($hx + 3 * $amp) ($hy - 2 * $amp); Start-Sleep -Milliseconds 1200
  Ok (-not (Js 'window.__petState()').on) 'убрал руку — перестал'

  # 2. медленно провёл один раз — это не поглаживание
  Cur ($hx - $amp) $hy; Start-Sleep -Milliseconds 300
  for ($i = 0; $i -le 40; $i++) { Cur ($hx - $amp + $i * 2 * $amp / 40) $hy; Start-Sleep -Milliseconds 20 }
  Start-Sleep -Milliseconds 200
  Ok (-not (Js 'window.__petState()').on) 'один проход мышью — не считается'
  Start-Sleep -Milliseconds 1500

  # 3. перетащить: курсор на грудь, нажатие в окно, ведём вверх-влево, отпускаем
  $cx = [double]$p.foot.x; $cy = $hy + 0.45 * [double]$p.pxPerM
  Cur $cx $cy; Start-Sleep -Milliseconds 400
  $ign = (Js 'window.__petState()').ignoring
  Ok (-not $ign) 'над Феликсом окно ловит мышь'
  # дальше «мышь» — в окно Феликса через тестовый порт (экранные координаты, DIP); настоящий курсор стоит на месте
  $sx = $b.x + $cx; $sy = $b.y + $cy
  Hook @{ c = 'mouse'; win = 'assistant'; type = 'mouseDown'; sx = $sx; sy = $sy } | Out-Null
  $dirx = if ($side0 -eq 'left') { 7 } else { -7 }          # к середине экрана
  for ($i = 1; $i -le 40; $i++) {
    $mx = $sx + $i * $dirx; $my = $sy - $i * 8
    Hook @{ c = 'mouse'; win = 'assistant'; type = 'mouseMove'; sx = $mx; sy = $my } | Out-Null
    Start-Sleep -Milliseconds 16
    if ($i -eq 30) { $d = Js 'window.__dragState()'; Ok ($d.drag -and [Math]::Abs($d.swing) -gt 0.01) "схватили: висит и раскачивается (качание $($d.swing))" }
  }
  Start-Sleep -Milliseconds 60
  $b2 = Hook @{ c = 'bounds'; win = 'assistant' }
  Ok ([Math]::Abs(($b2.x - $b.x) - 40 * $dirx) -lt 30 -and [Math]::Abs(($b.y - $b2.y) - 320) -lt 30) ("окно едет за курсором: сдвиг {0},{1}" -f ($b2.x - $b.x), ($b2.y - $b.y))
  Hook @{ c = 'mouse'; win = 'assistant'; type = 'mouseUp'; sx = $mx; sy = $my } | Out-Null
  Start-Sleep -Milliseconds 120
  $d = Js 'window.__dragState()'
  Ok ($d.fall -and -not $d.drag) 'отпустили — падает'
  Start-Sleep -Milliseconds 1800
  $b3 = Hook @{ c = 'bounds'; win = 'assistant' }
  $d = Js 'window.__dragState()'
  Hook @{ c = 'mouse'; win = 'assistant'; type = 'release' } | Out-Null
  Ok ($b3.y -eq $b.y -and [Math]::Abs($b3.x - $b.x) -gt 100) ("упал на пол: y {0} (было {1}), x {2} (было {3})" -f $b3.y, $b.y, $b3.x, $b.x)
  Ok ($d.state -eq 'dizzy' -or $d.state -eq 'happy' -or $d.state -eq 'idle') "приземлился ($($d.state))"
  Start-Sleep -Milliseconds 400
  $cfg = Get-Content (Join-Path $Data 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Ok ($cfg.assistant.at.x -ne $null) ("место запомнено: {0},{1}, сторона {2}" -f $cfg.assistant.at.x, $cfg.assistant.at.y, $cfg.assistant.side)
  Hook @{ c = 'shot'; win = 'assistant'; file = (Join-Path (Split-Path $Out) 'after_drop.png') } | Out-Null

  # 4. сторона из настроек возвращает в угол (та же, что была до проверки)
  Js "window.felix.invoke('config:set', { assistant: { side: '$side0' } }), 1" | Out-Null
  Start-Sleep -Milliseconds 600
  $b4 = Hook @{ c = 'bounds'; win = 'assistant' }
  $cfg = Get-Content (Join-Path $Data 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $wa = Js 'screen.availWidth'
  $corner = if ($side0 -eq 'left') { $b4.x -le 10 } else { [Math]::Abs($b4.x + $b4.width + 6 - $wa) -le 10 }
  Ok ($corner -and $b4.y -eq $b.y -and $cfg.assistant.at.x -eq $null) "«$side0» в настройках — снова в углу ($($b4.x),$($b4.y))"
} finally {
  [void][M]::SetCursorPos($orig.X, $orig.Y)
  $tc.Close()
}
Log "ИТОГ: $pass ок, $fail ошибок"

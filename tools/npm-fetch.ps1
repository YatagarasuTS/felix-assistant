# Мини-установщик npm-пакетов без npm: скачивает пакет и все его зависимости (рекурсивно)
# из registry.npmjs.org в <dir>\node_modules. Диапазоны «^x.y.z» / «~x.y.z» / «x.y.z» → самая новая подходящая версия.
param([string]$Dir, [string[]]$Packages)
$ErrorActionPreference = 'Stop'
$nm = Join-Path $Dir 'node_modules'
New-Item -ItemType Directory -Force $nm | Out-Null
$tmp = Join-Path $env:TEMP ('npmfetch_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tmp | Out-Null
$done = @{}

function Parse([string]$v) { if ($v -match '^(\d+)\.(\d+)\.(\d+)$') { return @([int]$matches[1], [int]$matches[2], [int]$matches[3]) } return $null }
function Cmp($a, $b) { for ($i = 0; $i -lt 3; $i++) { if ($a[$i] -ne $b[$i]) { return $a[$i] - $b[$i] } } return 0 }

function Pick($meta, [string]$range) {
  $range = ($range -split '\|\|')[0].Trim()
  if ($range -in @('', '*', 'latest')) { return $meta.'dist-tags'.latest }
  $op = ''; if ($range -match '^([\^~]|>=)?\s*(\d+(\.\d+){0,2})') { $op = $matches[1]; $base = $matches[2] } else { return $meta.'dist-tags'.latest }
  $bp = ($base.Split('.') + @('0', '0'))[0..2] | ForEach-Object { [int]$_ }
  $best = $null
  foreach ($v in $meta.versions.PSObject.Properties.Name) {
    $p = Parse $v; if (-not $p) { continue }
    if ((Cmp $p $bp) -lt 0) { continue }
    $ok = switch ($op) {
      '^' { if ($bp[0] -gt 0) { $p[0] -eq $bp[0] } elseif ($bp[1] -gt 0) { $p[0] -eq 0 -and $p[1] -eq $bp[1] } else { (Cmp $p $bp) -eq 0 } }
      '~' { $p[0] -eq $bp[0] -and $p[1] -eq $bp[1] }
      '>=' { $true }
      default { (Cmp $p $bp) -eq 0 }
    }
    if ($ok -and (-not $best -or (Cmp $p (Parse $best)) -gt 0)) { $best = $v }
  }
  if (-not $best) { throw "нет версии для $range" }
  return $best
}

function Install([string]$name, [string]$range) {
  if ($done.ContainsKey($name)) { return }
  $done[$name] = $true
  $meta = Invoke-RestMethod ('https://registry.npmjs.org/' + $name.Replace('/', '%2F')) -TimeoutSec 120
  $ver = Pick $meta $range
  $info = $meta.versions.$ver
  $tgz = Join-Path $tmp (($name -replace '[@/]', '_') + '.tgz')
  Invoke-WebRequest $info.dist.tarball -OutFile $tgz -UseBasicParsing -TimeoutSec 300
  $x = Join-Path $tmp (($name -replace '[@/]', '_') + '_x')
  New-Item -ItemType Directory -Force $x | Out-Null
  tar -xzf $tgz -C $x
  $dst = Join-Path $nm $name
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
  New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
  Move-Item (Join-Path $x 'package') $dst
  Write-Output "$name@$ver"
  if ($info.dependencies) { foreach ($d in $info.dependencies.PSObject.Properties) { Install $d.Name $d.Value } }
}

foreach ($p in $Packages) { if ($p -match '^(@?[^@]+)(?:@(.+))?$') { Install $matches[1] ($(if ($matches[2]) { $matches[2] } else { 'latest' })) } }
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

# Публикация исходников «Феликса» в репозиторий GitHub одним коммитом — через gh api (git не нужен).
#   powershell -File tools\publish-source.ps1 -List                   — что уйдёт в репозиторий + проверка на секреты
#   powershell -File tools\publish-source.ps1 -Message "Феликс 1.1"   — залить: дерево репозитория станет ровно этим списком
# Вход в GitHub выполняет сам пользователь: gh auth login.
param([switch]$List, [string]$Message = '', [string]$Repo = '', [string]$Gh = '')
$ErrorActionPreference = 'Continue'   # ошибки gh проверяем по $LASTEXITCODE
$R = Split-Path $PSScriptRoot -Parent
if (-not $Gh) { $Gh = if (Test-Path 'E:\Tools\gh\bin\gh.exe') { 'E:\Tools\gh\bin\gh.exe' } else { 'gh' } }
$utf8 = New-Object Text.UTF8Encoding($false)

# что публикуется (всё остальное — сборка, данные, ключи, проверки — остаётся только на компьютере)
$INCLUDE = @(
  'README.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md', '.gitignore', 'THIRD-PARTY-NOTICES.txt',
  'app/main.js', 'app/preload.js', 'app/package.json', 'app/lib/*.js', 'app/ui/**',
  'native/core/*.cs', 'native/core/FelixCore.csproj', 'native/core/app.manifest', 'native/input/*.cs',
  'phone/build.gradle.kts', 'phone/settings.gradle.kts', 'phone/gradle.properties', 'phone/app/build.gradle.kts', 'phone/app/src/**',
  'build/Build-Felix.ps1', 'build/Build-Phone.ps1', 'build/installer/FelixSetup.cs', 'build/installer/setup.manifest',
  'docs/**', 'model/felix.vrm', 'model/felix.vroid', 'stage/sounds/*.wav',
  'promo/main.js', 'promo/package.json', 'promo/promo.html', 'promo/promo.js', 'promo/vert.html', 'promo/vert.js', 'promo/phone_screen.html', 'promo/make_audio.py', 'promo/make_audio_phone.py', 'promo/wardrobe.html', 'promo/wardrobe.js', 'promo/make_audio_wardrobe.py',
  'test/link_client.js', 'test/link_phone_test.js', 'test/wardrobe_test.js', 'test/run_dev.cmd', 'test/cmd_dev.cmd',
  'tools/brain-test.js', 'tools/brain-phone-test.js', 'tools/brain-wardrobe-test.js', 'tools/wardrobe-gallery.html', 'tools/shot.js', 'tools/felix_recolor.py', 'tools/make_icons.py', 'tools/vrm_dump.py', 'tools/npm-fetch.ps1', 'tools/publish-source.ps1', 'tools/publish-release.ps1'
)
# страховка: такого в репозитории быть не должно никогда
$NEVER = '(^|/)(node_modules|\.gradle|keystore)/|^phone/(app/)?build/|(^|/)local\.properties$|\.(log|jks|keystore|p12|pfx|pem|key)$'
$SECRETS = @('sk-ant-[A-Za-z0-9_\-]{12,}', 'gh[pousr]_[A-Za-z0-9]{20,}', 'AKIA[0-9A-Z]{16}', '-----BEGIN [A-Z ]*PRIVATE KEY', '(storePassword|keyPassword)\s*=\s*"[^"]+"|(storePassword|keyPassword)=\S', '[A-Za-z0-9._%+-]+@(gmail|yandex|mail|outlook|hotmail)\.(com|ru)', 'C:\\Users\\[^\\]+\\')

function Expand($pat) {
  $p = $pat -replace '/', '\'
  if ($p.Contains('**')) { $base = Join-Path $R $p.Substring(0, $p.IndexOf('\**')); if (Test-Path $base) { Get-ChildItem $base -Recurse -File -Force } }
  elseif ($p.Contains('*')) { $dir = Join-Path $R (Split-Path $p -Parent); if (Test-Path $dir) { Get-ChildItem $dir -File -Filter (Split-Path $p -Leaf) -Force } }
  else { $f = Join-Path $R $p; if (Test-Path $f) { Get-Item $f -Force } else { Write-Warning "нет файла: $pat" } }
}
$files = @{}
foreach ($pat in $INCLUDE) { foreach ($f in (Expand $pat)) { $rel = $f.FullName.Substring($R.Length + 1) -replace '\\', '/'; if ($rel -notmatch $NEVER) { $files[$rel] = $f.FullName } } }
$names = $files.Keys | Sort-Object

# проверка на секреты и личные данные — в текстовых файлах
$bad = 0
foreach ($rel in $names) {
  if ($rel -match '\.(png|gif|jpg|ico|wav|vrm|vroid|ttf|woff2?)$') { continue }
  $text = [IO.File]::ReadAllText($files[$rel], [Text.Encoding]::UTF8)
  foreach ($re in $SECRETS) { foreach ($m in [regex]::Matches($text, $re)) { Write-Output "  ! $rel : $($m.Value)"; $bad++ } }
}
$size = ($names | ForEach-Object { (Get-Item $files[$_]).Length } | Measure-Object -Sum).Sum
Write-Output ("{0} файлов, {1:N1} МБ; подозрительных строк: {2}" -f $names.Count, ($size / 1MB), $bad)
if ($List) { $names | ForEach-Object { Write-Output "  $_" }; return }
if ($bad) { throw 'Найдены похожие на секреты строки — проверьте и уберите их перед публикацией' }
if (-not $Message) { throw 'Укажите -Message' }

$tmp = Join-Path $env:TEMP 'felix-gh'; New-Item -ItemType Directory -Force $tmp | Out-Null
function Api($method, $path, $body) {
  $f = Join-Path $tmp 'body.json'
  [IO.File]::WriteAllText($f, ($body | ConvertTo-Json -Depth 10 -Compress), $utf8)
  $out = & $Gh api -X $method $path --input $f
  if ($LASTEXITCODE) { throw "gh api $method $path failed" }
  return ($out | ConvertFrom-Json)
}
$owner = & $Gh api user -q .login; if ($LASTEXITCODE -or -not $owner) { throw 'gh: не выполнен вход (gh auth login)' }
if (-not $Repo) { $Repo = "$owner/felix-assistant" }
$head = (& $Gh api "repos/$Repo/git/ref/heads/main" | ConvertFrom-Json).object.sha
if (-not $head) { throw "нет ветки main в $Repo" }
Write-Output "репозиторий $Repo, main $($head.Substring(0, 7))"
$tree = @()
foreach ($rel in $names) {
  $blob = Api POST "repos/$Repo/git/blobs" @{ content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($files[$rel])); encoding = 'base64' }
  $mode = if ($rel -match '\.(cmd|ps1|sh)$') { '100644' } else { '100644' }
  $tree += @{ path = $rel; mode = $mode; type = 'blob'; sha = $blob.sha }
  Write-Output "  + $rel"
}
$t = Api POST "repos/$Repo/git/trees" @{ tree = $tree }          # без base_tree: лишние старые файлы уходят
$c = Api POST "repos/$Repo/git/commits" @{ message = $Message; tree = $t.sha; parents = @($head) }
Api PATCH "repos/$Repo/git/refs/heads/main" @{ sha = $c.sha; force = $false } | Out-Null
Write-Output "коммит $($c.sha.Substring(0, 7)): https://github.com/$Repo/commit/$($c.sha)"

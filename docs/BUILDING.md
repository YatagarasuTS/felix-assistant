# Сборка «Феликса» из исходников

Всё собирается на Windows 10/11 x64. Готовые установщики — в [Releases](https://github.com/YatagarasuTS/felix-assistant/releases); эта страница — для тех, кто хочет запустить Феликса из кода, поправить его или собрать свою версию.

## Устройство

```
app\                 программа на Electron 33
  main.js            главный процесс: окно Феликса, трей, команды, таймеры, погода, нейросеть, телефон
  preload.js         мост окон
  lib\brain.js       разбор голосовых команд (русский, офлайн)
  lib\phoneapps.js   дела на телефоне: доставка, такси, карты, покупки, музыка — каталог приложений и их ссылки
  lib\llm.js         нейросеть: аккаунт Anthropic пользователя (@anthropic-ai/sdk), Ollama
  lib\link.js        связь с «Феликс Link»: UDP-поиск 47891, TCP 47890 (AES-256-GCM), APK по HTTP 47892
  lib\tts.js         голос Piper; свой HTTP-голос; голос Windows
  lib\core.js        мост к FelixCore.exe;  lib\input.js — к FelixInput.exe
  ui\                окна: assistant (3D), settings, welcome, call, phone (экран телефона на компьютере)
native\core          FelixCore (C#, net48): окна, громкость, распознавание речи Vosk, Win+Y, голос Windows
native\input         FelixInput (C#, csc из .NET Framework): клавиши, музыка, устройство вывода звука
phone\               «Феликс Link» для Android 9+ (Kotlin, без сторонних библиотек)
build\               Build-Felix.ps1 (установщик, переносной exe, ZIP), Build-Phone.ps1 (APK), installer\FelixSetup.cs
stage\               данные программы для запуска из исходников: native, voice, stt, models, sounds, phone
model\               3D-модель: felix.vroid (проект VRoid Studio) и felix.vrm
promo\               рекламные ролики: make_audio*.py (реплики Piper, музыка) → сцена HTML → main.js (кадры → ffmpeg)
tools\               shot.js (снимки окон), brain-*-test.js (разбор фраз), felix_recolor.py, make_icons.py, npm-fetch.ps1
test\                эмуляторы телефона (link_client.js, link_phone_test.js), запуск из исходников
docs\                LICENSE.txt и README.txt для установщика, тексты сторонних лицензий, эта страница
```

## Что понадобится

| Что | Зачем | Где взять |
|---|---|---|
| Node.js + npm (или `tools\npm-fetch.ps1`) | Electron и Anthropic SDK | nodejs.org |
| Electron **33.2.1** | сама программа | `npm i electron@33.2.1` в корне проекта → `node_modules\electron\dist` |
| `@anthropic-ai/sdk` 1.12.0 | нейросеть | `cd app && npm i` |
| .NET SDK 8+ | FelixCore (net48, пакеты Vosk и NAudio из NuGet) | dot.net |
| .NET Framework 4.8 (есть в Windows) | `csc.exe` для FelixInput и установщика | `C:\Windows\Microsoft.NET\Framework64\v4.0.30319` |
| rcedit-x64.exe | значок и сведения Felix.exe | github.com/electron/rcedit/releases → `tools\bin\` |
| Piper 1.2.0 (Windows amd64) | голос | github.com/rhasspy/piper/releases → `stage\voice\piper\` |
| Голоса `ru_RU-dmitri-medium`, `ru_RU-denis-medium` | голос Феликса | huggingface.co/rhasspy/piper-voices (ru/ru_RU) → `stage\voice\` |
| `vosk-model-small-ru-0.22` | распознавание речи | alphacephei.com/vosk/models → `stage\stt\vosk-model-small-ru-0.22\` |
| JDK 17+, Android SDK 34, Gradle 8.9 | «Феликс Link» | developer.android.com, gradle.org |
| Python 3 + numpy (по желанию) | звук роликов | python.org |

> Голосам Piper 1.2 мешают многосимвольные фонемы в `.onnx.json`: если голос молчит, уберите из `phoneme_id_map` ключи длиннее одного символа (сами модели не меняются).

## Запуск из исходников

```powershell
npm i electron@33.2.1                     # в корне проекта
cd app; npm i; cd ..
dotnet build native\core -c Release -o native\out
# FelixInput: строка csc из build\Build-Felix.ps1, шаг 1
robocopy native\out stage\native /E
mkdir stage\models; copy model\felix.vrm stage\models\
test\run_dev.cmd                          # данные — в test\data, настоящие настройки не трогаются
```

Команду можно дать текстом: `test\cmd_dev.cmd "--cmd=какая погода"`.

## Сборка установщика

```powershell
powershell -ExecutionPolicy Bypass -File build\Build-Phone.ps1     # APK → dist\ и stage\phone\
powershell -ExecutionPolicy Bypass -File build\Build-Felix.ps1     # FelixSetup-<версия>.exe, Felix-<версия>.exe, ZIP → dist\
```

`Build-Felix.ps1` ищет Electron в `node_modules\electron\dist` (или укажите `-Electron <папка>` / `FELIX_ELECTRON`).
`Build-Phone.ps1` берёт JDK, SDK и Gradle из `JAVA_HOME`, `ANDROID_HOME` и `PATH` — или из одной папки (`-Tools`, `FELIX_ANDROID_TOOLS`: `jdk\`, `sdk\`, `gradle-8.9\`).

**Подпись APK.** Релизы «Феликс Link» подписаны ключом автора; он не входит в репозиторий. Для своей сборки создайте свой ключ и `phone\keystore\keystore.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`) — или соберите без него (подпишется отладочным ключом). Приложение с другой подписью не встанет поверх официального — сначала удалите его с телефона.

## Проверки

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
node_modules\electron\dist\electron.exe tools\brain-phone-test.js                 # разбор фраз для телефона
# Феликс с данными, где включён телефон (phone.enabled, code TESTCODE, голос off), затем:
node_modules\electron\dist\electron.exe test\link_phone_test.js TESTCODE report.txt  # эмулятор «Феликс Link» 1.1
node_modules\electron\dist\electron.exe test\link_client.js TESTCODE report.txt stage\phone\FelixLink.apk
```

Снимки окон без запуска ассистента: `electron tools\shot.js <папка> phone.html 1020 860 2500 settings.html#phone 980 1700 3000` (`SHOT_PHONE_ON=1` — «подключённый» телефон).

## Связь с телефоном

Телефон находит компьютер широковещательным UDP `FELIX?` → `FELIX! 47890 <имя ПК>`, подключается по TCP 47890. Ключ — PBKDF2-SHA256(код сопряжения, «FelixLink1», 100 000) → AES-256-GCM; каждая строка — `base64(iv + шифротекст + тег)` с JSON и счётчиком `n` (повтор отвергается).

Команды компьютера телефону (`{ t: 'cmd', id, cmd, … }` → `{ t: 'res', id, ok, text, data }`):

| cmd | Что делает |
|---|---|
| `answer`, `decline`, `hangup`, `speaker` | звонки |
| `alarm`, `timer`, `volume`, `ringer`, `dnd`, `find`, `battery`, `media`, `notifs`, `contact`, `dial`, `open` | телефон (1.0) |
| `apps {icons}` | приложения с ярлыком: `[{ pkg, label, icon? }]` (1.1) |
| `launch {pkg}`, `url {url, pkg?}`, `clip {text}`, `wake` | открыть приложение / ссылку, буфер обмена, включить экран |
| `service {pkg, links[], query, dest, near}` | дело: ссылки с `{q}`, `{addr}`, `{lat}`, `{lon}`; не вышло — запуск и запрос в поиск |
| `nav {action}` | `back`, `home`, `recents`, `notifications`, `quick`, `lock`, `screenshot`, `power` |
| `tap {x, y, long}`, `swipe {x1, y1, x2, y2, ms}`, `text {text, enter, replace, erase}` | касания (доли экрана 0…1) и ввод текста |
| `screen`, `shot {w, q}` | размер экрана и снимок JPEG (Android 11+) |

Всё из 1.1 работает через службу специальных возможностей «Феликс Link — управление с компьютера» и только по команде с компьютера.

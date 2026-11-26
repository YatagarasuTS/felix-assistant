# Сборка «Феликса» из исходников

Всё собирается на Windows 10/11 x64. Готовые установщики — в [Releases](https://github.com/YatagarasuTS/felix-assistant/releases); эта страница — для тех, кто хочет запустить Феликса из кода, поправить его или собрать свою версию.

## Устройство

```
app\                 программа на Electron 33
  main.js            главный процесс: окно Феликса, трей, команды, таймеры, погода, нейросеть, телефон
  preload.js         мост окон
  lib\brain.js       разбор голосовых команд (русский, офлайн)
  lib\phoneapps.js   дела на телефоне: доставка, такси, карты, покупки, музыка — каталог приложений и их ссылки
  ui\wardrobe3d.js   гардероб в 3D: аксессуары из простых фигур, ширма, перекраска нарядов, анимации надевания
  ui\wardrobe-catalog.json  каталог нарядов и вещей (имена, слова для голоса, цвета) — один для программы, настроек и роликов
  lib\llm.js         нейросеть: аккаунт Anthropic пользователя (@anthropic-ai/sdk), Ollama
  lib\link.js        связь с «Феликс Link»: UDP-поиск 47891, TCP 47890 (AES-256-GCM), APK по HTTP 47892, видео экрана TCP 47893
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
tools\               shot.js (снимки окон), wardrobe-gallery.html (все вещи, наряды, позы и ширма — сеткой), brain-*-test.js (разбор фраз), felix_recolor.py, make_icons.py, npm-fetch.ps1
test\                эмуляторы телефона (link_client.js, link_phone_test.js, wardrobe_test.js, cast_test.js), pet_drag_test.ps1, run_all.ps1, запуск из исходников
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
node_modules\electron\dist\electron.exe tools\brain-wardrobe-test.js              # гардероб, игры, забота
# Феликс с данными, где включён телефон (phone.enabled, code TESTCODE, голос off), затем:
node_modules\electron\dist\electron.exe test\link_phone_test.js TESTCODE report.txt  # эмулятор «Феликс Link» 1.1
node_modules\electron\dist\electron.exe test\link_client.js TESTCODE report.txt stage\phone\FelixLink.apk
```

Гардероб и игры голосом — `test\wardrobe_test.js TESTCODE report.txt` (Феликс запущен с FELIX_PICTURES и FELIX_SHOTS — тестовые папки для селфи и покадровых снимков анимаций). Посадка вещей: `electron tools\shot.js <папка> "/tools/wardrobe-gallery.html?mode=acc&part=0" 1600 1000 7000` (mode: acc, showcase, outfits, poses, screen, item&id=…).

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
| `screen`, `shot {w, q}` | размер экрана и снимок JPEG (Android 11+); в `screen` с 1.2 — `cast`, `liveTouch` |
| `cast {on, port, token, maxSize, fps, bitrate}` | видеопоток экрана (1.2): `streaming` или `consent` (ждёт «Начать» на телефоне); `on: false` — стоп |
| `castkey` | попросить ключевой кадр (декодер потерял кадры) |

Касание «вживую» (1.2) — без ответа и мимо очереди команд: `{ t: 'touch', a: 'down'|'move'|'up', x, y }` (доли 0…1). Телефон ведёт палец непрерывным жестом (`dispatchGesture` + `continueStroke`), пока не придёт `up`.

**Видеопоток (1.2).** Компьютер выдаёт разовый пропуск (`token`) и слушает TCP 47893; телефон подключается сам. MediaProjection → виртуальный дисплей → аппаратный кодер H.264 Baseline (до 60 к/с, без B-кадров, низкая задержка). Кадр в сети: `[длина u32][iv 12][AES-GCM(тип u8, номер u32, время u64, данные)][тег 16]` тем же ключом сопряжения; типы: 0 — привет `{token, w, h, sw, sh, fps}` (и новый размер при повороте), 1 — SPS/PPS, 2 — ключевой кадр, 3 — обычный. Номера только растут, первый кадр без верного пропуска — разрыв. На компьютере — WebCodecs `VideoDecoder` (Annex B, `optimizeForLatency`) → `<canvas>`. Окно свернули или закрыли — поток останавливается, разрешение Android держится ещё 10 минут.

Всё из 1.1 работает через службу специальных возможностей «Феликс Link — управление с компьютера» и только по команде с компьютера.

## Проверки 1.3

`powershell -File test\run_all.ps1` — всё подряд на Феликсе из исходников: разбор фраз, эмулятор телефона, трансляция экрана (`test\cast_test.js`: настоящий H.264 из `test\cast\stream.h264` по 47893, частота кадров и касания), гардероб, связь и APK, поглаживание и перетаскивание (`test\pet_drag_test.ps1`: курсор водит над головой). Феликс запускается с `FELIX_TEST=<пароль>` — тогда открыт локальный порт 47898 для проверок (окна, снимки, «мышь»); без этой переменной порта нет. Тестовый поток: `ffmpeg -f lavfi -i testsrc2=size=576x1248:rate=60 -t 6 -c:v libx264 -profile:v baseline -tune zerolatency -threads 1 -g 120 -x264-params aud=1 -f h264 test\cast\stream.h264`.

Эффекты в окне Феликса без запуска ассистента: `electron tools\shot.js <папка> "assistant.html?portrait=1&pose=idle&wx=rain&temp=5" 460 634 4500` (`wx`: sun, moon, partly, cloud, fog, rain, snow, storm; `toss=coin|dice&res=…&tt=<с>` — застывший момент броска; `dance=1`).

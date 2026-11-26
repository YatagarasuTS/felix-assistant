package app.felixassistant.link

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.AlarmClock
import android.provider.ContactsContract
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager
import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.roundToInt

data class Res(val ok: Boolean, val text: String = "", val data: Any? = null)

/** Всё, что Феликс умеет делать с телефоном. События (звонки, батарея) уходят через emit. */
@Suppress("DEPRECATION")
class PhoneCtl(private val ctx: Context, private val emit: (JSONObject) -> Unit) {
    private val tm = ctx.getSystemService(TelephonyManager::class.java)
    private val telecom = ctx.getSystemService(TelecomManager::class.java)
    private val am = ctx.getSystemService(AudioManager::class.java)
    private val nm = ctx.getSystemService(NotificationManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private var listening = false
    private var lastNumber = ""
    private var callState = TelephonyManager.CALL_STATE_IDLE
    private var incoming = false
    private var player: MediaPlayer? = null
    private var lastLevel = -100
    private var lastCharging = false

    private fun has(p: String) = ctx.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    // ---------------------------------------------------------------- события
    private val callListener = object : PhoneStateListener() {
        override fun onCallStateChanged(state: Int, number: String?) {
            if (!number.isNullOrBlank()) lastNumber = number
            val st = when (state) {
                TelephonyManager.CALL_STATE_RINGING -> "ringing"
                TelephonyManager.CALL_STATE_OFFHOOK -> "active"
                else -> "idle"
            }
            if (state == TelephonyManager.CALL_STATE_RINGING) incoming = true
            if (state == TelephonyManager.CALL_STATE_OFFHOOK && callState == TelephonyManager.CALL_STATE_IDLE) incoming = false
            callState = state
            val num = lastNumber
            emit(JSONObject().put("t", "call").put("state", st).put("number", num).put("name", contactName(num) ?: "").put("incoming", incoming))
            if (st == "idle") { lastNumber = ""; incoming = false }
        }
    }

    private val battery = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            val lvl = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) * 100 / maxOf(1, i.getIntExtra(BatteryManager.EXTRA_SCALE, 100))
            val ch = i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
            if (abs(lvl - lastLevel) >= 5 || ch != lastCharging) {
                lastLevel = lvl; lastCharging = ch
                emit(batteryEvent())
            }
        }
    }

    fun start() {
        // слушатель звонков создаётся на главном потоке — его колбэки приходят туда же
        main.post {
            if (!listening && has(Manifest.permission.READ_PHONE_STATE)) {
                tm.listen(callListener, PhoneStateListener.LISTEN_CALL_STATE)
                listening = true
            }
        }
        try { ctx.registerReceiver(battery, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) } catch (_: Exception) {}
    }

    fun stop() {
        main.post { if (listening) { tm.listen(callListener, PhoneStateListener.LISTEN_NONE); listening = false } }
        try { ctx.unregisterReceiver(battery) } catch (_: Exception) {}
        ring(false)
    }

    fun batteryEvent(): JSONObject {
        val bm = ctx.getSystemService(BatteryManager::class.java)
        return JSONObject().put("t", "battery").put("level", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)).put("charging", bm.isCharging)
    }

    fun callEvent(): JSONObject? {
        if (callState == TelephonyManager.CALL_STATE_IDLE) return null
        val st = if (callState == TelephonyManager.CALL_STATE_RINGING) "ringing" else "active"
        return JSONObject().put("t", "call").put("state", st).put("number", lastNumber).put("name", contactName(lastNumber) ?: "").put("incoming", incoming)
    }

    // ---------------------------------------------------------------- команды с компьютера
    @SuppressLint("MissingPermission")
    fun run(m: JSONObject): Res = when (m.optString("cmd")) {
        "answer" -> {
            if (!has(Manifest.permission.ANSWER_PHONE_CALLS)) Res(false, "нет разрешения на звонки")
            else { telecom.acceptRingingCall(); Res(true) }
        }
        "decline", "hangup" -> {
            if (!has(Manifest.permission.ANSWER_PHONE_CALLS)) Res(false, "нет разрешения на звонки")
            else Res(telecom.endCall())
        }
        "speaker" -> speaker(m.optBoolean("on", true))
        "alarm" -> startClock(Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, m.optInt("hour"))
            .putExtra(AlarmClock.EXTRA_MINUTES, m.optInt("minute"))
            .putExtra(AlarmClock.EXTRA_MESSAGE, m.optString("label", "Феликс"))
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true))
        "timer" -> startClock(Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, m.optInt("seconds"))
            .putExtra(AlarmClock.EXTRA_MESSAGE, m.optString("label", "Феликс"))
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true))
        "volume" -> volume(m)
        "ringer" -> ringer(m.optString("mode"))
        "dnd" -> dnd(m.optBoolean("on", true))
        "find" -> { ring(m.optBoolean("on", true)); Res(true) }
        "battery" -> Res(true, data = batteryEvent())
        "open" -> openApp(m.optJSONArray("names"))
        "media" -> media(m.optString("action"))
        "contact" -> findContact(m.optJSONArray("names"))
        "dial" -> dial(m.optString("number"))
        "notifs" -> Res(true, data = JSONArray(synchronized(NotifListener.recent) { NotifListener.recent.take(m.optInt("count", 5)).map { JSONObject(it.toString()) } }))
        "state" -> Res(true, data = callEvent() ?: JSONObject().put("state", "idle"))
        // ---- управление телефоном с компьютера (Феликс Link 1.1)
        "apps" -> Res(true, data = Services.apps(ctx, m.optBoolean("icons", false)))
        "launch" -> m.optString("pkg").let { pkg -> if (Services.launch(ctx, pkg)) Res(true, Services.label(ctx, pkg) ?: pkg) else Res(false, "не запускается") }
        "service" -> Services.service(ctx, m)
        "url" -> if (Services.openUrl(ctx, m.optString("url"), m.optString("pkg").ifBlank { null })) Res(true) else Res(false, "нечем открыть ссылку")
        "clip" -> Res(Services.setClip(ctx, m.optString("text")))
        "wake" -> Res(Services.wake(ctx))
        "nav" -> acc { it.global(m.optString("action")) }
        "tap" -> acc { it.tap(m.optDouble("x"), m.optDouble("y"), m.optBoolean("long")) }
        "swipe" -> acc { it.swipe(m.optDouble("x1"), m.optDouble("y1"), m.optDouble("x2"), m.optDouble("y2"), m.optLong("ms", 300)) }
        "text" -> acc { it.typeText(m.optString("text"), m.optBoolean("enter"), m.optBoolean("replace"), m.optInt("erase")) }
        "shot" -> shot(m)
        "screen" -> Res(true, data = screenInfo())
        // видеотрансляция экрана (1.2): включить/выключить, попросить ключевой кадр
        "cast" -> LinkService.instance?.cast(m) ?: Res(false, "нет связи")
        "castkey" -> { ScreenCast.requestKeyFrame(); Res(true) }
        else -> Res(false, "неизвестная команда")
    }

    // ---------------------------------------------------------------- экран телефона на компьютере
    private val ACC_OFF = "включите «Феликс Link — управление с компьютера» в специальных возможностях телефона"

    private fun acc(f: (FelixAccessibility) -> Boolean): Res {
        val a = FelixAccessibility.instance ?: return Res(false, ACC_OFF)
        return if (f(a)) Res(true) else Res(false, "телефон не выполнил")
    }

    private fun screenInfo(): JSONObject {
        val a = FelixAccessibility.instance
        val o = JSONObject().put("acc", a != null).put("canShot", a != null && android.os.Build.VERSION.SDK_INT >= 30).put("android", android.os.Build.VERSION.SDK_INT)
            .put("cast", true).put("liveTouch", a != null)
        a?.screenSize()?.let { (w, h) -> o.put("w", w).put("h", h) }
        return o
    }

    private fun shot(m: JSONObject): Res {
        val a = FelixAccessibility.instance ?: return Res(false, ACC_OFF)
        if (android.os.Build.VERSION.SDK_INT < 30) return Res(false, "экран телефона виден на компьютере начиная с Android 11")
        val r = a.shot(m.optInt("w", 480), m.optInt("q", 60)) ?: return Res(false, "экран не снимается (заблокирован или защищён)")
        LinkService.instance?.screenShared()
        return Res(true, data = r)
    }

    private fun speaker(on: Boolean): Res {
        // сначала — кнопка «Динамик» на экране звонка (надёжно на MIUI), потом — системный способ
        if (FelixAccessibility.instance?.clickSpeaker(on) == true) return Res(true)
        return try { am.isSpeakerphoneOn = on; Res(am.isSpeakerphoneOn == on, if (FelixAccessibility.instance == null) ACC_OFF else "") } catch (e: Exception) { Res(false, e.message ?: "") }
    }

    private fun startClock(i: Intent): Res = try {
        ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); Res(true)
    } catch (e: Exception) { Res(false, "не открылись «Часы»: ${e.message}") }

    private fun stream(name: String) = when (name) {
        "ring" -> AudioManager.STREAM_RING
        "alarm" -> AudioManager.STREAM_ALARM
        "call" -> AudioManager.STREAM_VOICE_CALL
        "notification" -> AudioManager.STREAM_NOTIFICATION
        else -> AudioManager.STREAM_MUSIC
    }

    private fun volume(m: JSONObject): Res {
        val s = stream(m.optString("stream", "music"))
        val max = am.getStreamMaxVolume(s)
        val cur = am.getStreamVolume(s)
        val target = when {
            m.has("level") -> (m.optInt("level").coerceIn(0, 100) * max / 100.0).roundToInt()
            m.has("delta") -> (cur + (m.optInt("delta") * max / 100.0).roundToInt().let { if (it == 0) (if (m.optInt("delta") > 0) 1 else -1) else it }).coerceIn(0, max)
            else -> cur
        }
        return try {
            am.setStreamVolume(s, target, AudioManager.FLAG_SHOW_UI)
            Res(true, data = JSONObject().put("level", target * 100 / maxOf(1, max)))
        } catch (e: SecurityException) { Res(false, "нужен доступ к режиму «Не беспокоить»") }
    }

    private fun ringer(mode: String): Res = try {
        am.ringerMode = when (mode) { "silent" -> AudioManager.RINGER_MODE_SILENT; "vibrate" -> AudioManager.RINGER_MODE_VIBRATE; else -> AudioManager.RINGER_MODE_NORMAL }
        Res(true)
    } catch (e: SecurityException) { Res(false, "нужен доступ к режиму «Не беспокоить»") }

    private fun dnd(on: Boolean): Res {
        if (!nm.isNotificationPolicyAccessGranted) return Res(false, "нужен доступ к режиму «Не беспокоить»")
        nm.setInterruptionFilter(if (on) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL)
        return Res(true)
    }

    /** «Где мой телефон»: громкая мелодия будильника 30 секунд даже в беззвучном режиме */
    fun ring(on: Boolean) {
        main.post {
            player?.let { try { it.stop() } catch (_: Exception) {}; it.release() }
            player = null
            if (!on) return@post
            try {
                val uri = RingtoneManager.getActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_RINGTONE) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
                player = MediaPlayer().apply {
                    setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                    setDataSource(ctx, uri); isLooping = true; prepare(); start()
                }
                ctx.getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 400), 0))
                val p = player
                main.postDelayed({ if (player === p) ring(false) }, 30_000)
            } catch (_: Exception) {}
            if (player == null) ctx.getSystemService(Vibrator::class.java)?.cancel()
        }
        if (!on) main.post { ctx.getSystemService(Vibrator::class.java)?.cancel() }
    }

    private fun media(action: String): Res {
        val code = when (action) {
            "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
            "prev" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            "pause" -> KeyEvent.KEYCODE_MEDIA_PAUSE
            "play" -> KeyEvent.KEYCODE_MEDIA_PLAY
            else -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
        }
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
        return Res(true)
    }

    // ---------------------------------------------------------------- поиск по названию (Феликс присылает несколько вариантов)
    private fun score(label: String, cands: List<String>): Int {
        val l = label.lowercase().replace('ё', 'е')
        var best = 0
        for (c in cands) {
            if (c.isBlank()) continue
            val s = when {
                l == c -> 100
                l.startsWith(c) -> 85
                l.split(' ', '-', '.').any { it.startsWith(c) } -> 75
                l.contains(c) -> 60
                c.contains(l) && l.length >= 4 -> 50
                else -> 0
            }
            if (s > best) best = s
        }
        return best
    }

    private fun names(a: JSONArray?): List<String> = (0 until (a?.length() ?: 0)).map { a!!.optString(it).lowercase().replace('ё', 'е').trim() }.filter { it.isNotEmpty() }

    private fun openApp(arr: JSONArray?): Res {
        val cands = names(arr)
        val pm = ctx.packageManager
        val acts = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
        var best: Pair<Int, android.content.pm.ResolveInfo>? = null
        for (a in acts) {
            val s = maxOf(score(a.loadLabel(pm).toString(), cands), score(a.activityInfo.packageName.substringAfterLast('.'), cands))
            if (s > (best?.first ?: 0)) best = s to a
        }
        val hit = best?.takeIf { it.first >= 50 }?.second ?: return Res(false, "нет такого приложения")
        val i = pm.getLaunchIntentForPackage(hit.activityInfo.packageName) ?: return Res(false, "не запускается")
        return try { ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); Res(true, hit.loadLabel(pm).toString()) } catch (e: Exception) { Res(false, e.message ?: "") }
    }

    fun contactName(number: String?): String? {
        if (number.isNullOrBlank() || !has(Manifest.permission.READ_CONTACTS)) return null
        return try {
            ctx.contentResolver.query(Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number)), arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        } catch (_: Exception) { null }
    }

    private fun findContact(arr: JSONArray?): Res {
        if (!has(Manifest.permission.READ_CONTACTS)) return Res(false, "нет разрешения на контакты")
        val cands = names(arr)
        var best: Triple<Int, String, String>? = null
        ctx.contentResolver.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER), null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val name = c.getString(0) ?: continue
                val s = score(name, cands)
                if (s > (best?.first ?: 0)) best = Triple(s, name, c.getString(1) ?: "")
            }
        }
        val b = best?.takeIf { it.first >= 60 } ?: return Res(false, "нет такого контакта")
        return Res(true, b.second, JSONObject().put("name", b.second).put("number", b.third))
    }

    @SuppressLint("MissingPermission")
    private fun dial(number: String): Res {
        if (number.isBlank()) return Res(false, "нет номера")
        if (!has(Manifest.permission.CALL_PHONE)) return Res(false, "нет разрешения на звонки")
        return try { ctx.startActivity(Intent(Intent.ACTION_CALL, Uri.parse("tel:" + Uri.encode(number))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); Res(true) } catch (e: Exception) { Res(false, e.message ?: "") }
    }
}

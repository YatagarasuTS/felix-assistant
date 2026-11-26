package app.felixassistant.link

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.widget.Toast
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.IOException
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingDeque
import javax.crypto.spec.SecretKeySpec

/**
 * Постоянная связь с компьютером (Феликс) по Wi-Fi.
 * Поиск: широковещательный UDP «FELIX?» на порт 47891 → компьютер отвечает «FELIX! 47890 <имя>».
 * Связь: TCP 47890; компьютер шлёт «FELIXLINK1 <nonce>», телефон отвечает зашифрованным hello с этим nonce,
 * дальше в обе стороны — зашифрованные JSON-строки со счётчиком n (повтор старых сообщений отвергается).
 */
class LinkService : Service() {
    companion object {
        const val PORT = 47890
        const val DISC_PORT = 47891
        @Volatile var instance: LinkService? = null
        @Volatile var status: String = "Не запущено"
        @Volatile var connected = false
        @Volatile var lastReply = ""
        val listeners = CopyOnWriteArrayList<() -> Unit>()

        fun start(c: Context) {
            c.startForegroundService(Intent(c, LinkService::class.java))
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val cmds = Executors.newSingleThreadExecutor()
    private val sendLock = Any()
    private val pending = LinkedBlockingDeque<JSONObject>()
    @Volatile private var running = true
    @Volatile private var sock: Socket? = null
    @Volatile private var out: BufferedWriter? = null
    private var key: SecretKeySpec? = null
    private var keyCode = ""
    private var sendN = 0L
    private var recvN = 0L
    lateinit var phone: PhoneCtl
    private var tts: TextToSpeech? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var multicastLock: WifiManager.MulticastLock? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        startForeground(1, notification("Ищу компьютер…"))
        phone = PhoneCtl(this) { ev -> post(ev) }
        phone.start()
        tts = TextToSpeech(this) { st -> if (st == TextToSpeech.SUCCESS) tts?.language = Locale("ru", "RU") }
        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        @Suppress("DEPRECATION")
        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "felix:link").apply { setReferenceCounted(false); acquire() }
        multicastLock = wm.createMulticastLock("felix:discover").apply { setReferenceCounted(false) }
        Thread({ loop() }, "felix-link").start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        running = false
        closeSock()
        phone.stop()
        tts?.shutdown()
        wifiLock?.release()
        instance = null
        connected = false
        setStatus("Остановлено")
        super.onDestroy()
    }

    /** После смены кода или адреса — переподключиться */
    fun reconnect() { closeSock() }

    /** После выдачи разрешений — начать слушать звонки */
    fun refreshPermissions() { phone.start() }

    // ---------------------------------------------------------------- уведомление и статус
    private fun notification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("link", "Связь с компьютером", NotificationManager.IMPORTANCE_LOW))
        val pi = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, "link")
            .setContentTitle("Феликс на связи")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }

    private fun setStatus(text: String) {
        if (text == status) return
        status = text
        refreshNotification()
        main.post { listeners.forEach { it() } }
    }

    // пока экран телефона показан в окне «Телефон» на компьютере — это видно в уведомлении
    @Volatile private var sharedUntil = 0L
    private val unshare = Runnable { refreshNotification() }

    private fun refreshNotification() {
        val text = if (System.currentTimeMillis() < sharedUntil) "Экран телефона показан на компьютере" else status
        try { getSystemService(NotificationManager::class.java).notify(1, notification(text)) } catch (_: Exception) {}
    }

    // ---------------------------------------------------------------- трансляция экрана (ScreenCast)
    fun currentKey(): SecretKeySpec? = key

    fun cast(m: JSONObject): Res {
        if (!m.optBoolean("on", true)) { ScreenCast.stop(); return Res(true) }
        val host = sock?.inetAddress?.hostAddress ?: return Res(false, "нет связи")
        return ScreenCast.start(this, m, host, key)
    }

    /** Android 10+: запись экрана разрешена только службе переднего плана с типом mediaProjection */
    fun castForeground(on: Boolean) {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                val type = android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or (if (on) android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0)
                startForeground(1, notification(status), type)
            }
        } catch (_: Exception) {}
    }

    /** Вызывается при каждом снимке экрана для компьютера */
    fun screenShared() {
        val was = System.currentTimeMillis() < sharedUntil
        sharedUntil = System.currentTimeMillis() + 4000
        if (!was) refreshNotification()
        main.removeCallbacks(unshare)
        main.postDelayed(unshare, 4200)
    }

    // ---------------------------------------------------------------- цикл подключения
    private fun loop() {
        var fails = 0
        while (running) {
            try {
                val code = Prefs.code(this)
                if (code.isBlank()) { setStatus("Введите код из настроек Феликса на компьютере"); Thread.sleep(3000); continue }
                if (code != keyCode) { key = Crypto.deriveKey(code); keyCode = code }
                var host: String? = Prefs.manualHost(this).ifBlank { null }
                if (host == null && fails == 0) host = Prefs.lastHost(this).ifBlank { null }
                if (host == null) { setStatus("Ищу компьютер в сети Wi-Fi…"); host = discover() }
                if (host == null) {
                    fails++
                    setStatus("Компьютер не найден. Он включён и в той же сети Wi-Fi?")
                    Thread.sleep(minOf(20_000L, 3_000L * fails))
                    continue
                }
                session(host)
                fails = 0
            } catch (e: BadCode) {
                setStatus("Неверный код. Проверьте код в Настройках Феликса → Телефон")
                Thread.sleep(15_000)
            } catch (e: Exception) {
                fails++
            }
            connected = false
            main.post { listeners.forEach { it() } }
            if (running) {
                if (status.startsWith("Подключено")) setStatus("Связь потеряна, переподключаюсь…")
                Thread.sleep(minOf(10_000L, 1_500L * (fails + 1)))
            }
        }
    }

    private class BadCode : Exception()

    private fun discover(): String? {
        multicastLock?.acquire()
        try {
            DatagramSocket().use { ds ->
                ds.broadcast = true
                ds.soTimeout = 1500
                val msg = "FELIX?".toByteArray()
                val targets = mutableListOf(InetAddress.getByName("255.255.255.255"))
                subnetBroadcast()?.let { targets.add(it) }
                repeat(3) {
                    for (t in targets) try { ds.send(DatagramPacket(msg, msg.size, t, DISC_PORT)) } catch (_: Exception) {}
                    val buf = ByteArray(512)
                    val pk = DatagramPacket(buf, buf.size)
                    try {
                        ds.receive(pk)
                        val s = String(pk.data, 0, pk.length, Charsets.UTF_8)
                        if (s.startsWith("FELIX! ")) {
                            Prefs.setPcName(this, s.split(" ").drop(2).joinToString(" ").ifBlank { "компьютер" })
                            return pk.address.hostAddress
                        }
                    } catch (_: SocketTimeoutException) {}
                }
            }
        } catch (_: Exception) {
        } finally {
            multicastLock?.release()
        }
        return null
    }

    @Suppress("DEPRECATION")
    private fun subnetBroadcast(): InetAddress? = try {
        val dhcp = (applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager).dhcpInfo
        if (dhcp == null || dhcp.ipAddress == 0 || dhcp.netmask == 0) null else {
            val bc = (dhcp.ipAddress and dhcp.netmask) or dhcp.netmask.inv()
            InetAddress.getByAddress(ByteArray(4) { i -> (bc shr (i * 8) and 0xFF).toByte() })
        }
    } catch (_: Exception) { null }

    private fun session(host: String) {
        val s = Socket()
        s.connect(InetSocketAddress(host, PORT), 4000)
        s.tcpNoDelay = true
        s.keepAlive = true
        s.soTimeout = 90_000
        sock = s
        try {
            val rd = BufferedReader(InputStreamReader(s.getInputStream(), Charsets.UTF_8))
            val wr = BufferedWriter(OutputStreamWriter(s.getOutputStream(), Charsets.UTF_8))
            val greet = rd.readLine() ?: throw IOException("closed")
            if (!greet.startsWith("FELIXLINK1 ")) throw IOException("not felix")
            val nonce = greet.substring(11).trim()
            synchronized(sendLock) { sendN = 0; out = wr }
            recvN = 0
            sendNow(JSONObject().put("t", "hello").put("nonce", nonce).put("device", deviceName()).put("model", Build.MODEL).put("android", Build.VERSION.RELEASE).put("app", BuildConfig.VERSION_NAME))
            val first = rd.readLine() ?: throw IOException("closed")
            if (first.startsWith("BADCODE")) throw BadCode()
            val w = decrypt(first) ?: throw BadCode()
            if (w.optString("t") != "welcome") throw IOException("no welcome")
            Prefs.setLastHost(this, host)
            if (w.optString("pc").isNotBlank()) Prefs.setPcName(this, w.optString("pc"))
            w.optJSONObject("wol")?.let { if (it.optString("mac").isNotBlank()) Prefs.setWol(this, it.optString("mac"), it.optString("broadcast")) }
            connected = true
            setStatus("Подключено к «${Prefs.pcName(this)}»")
            sendNow(phone.batteryEvent())
            phone.callEvent()?.let { sendNow(it) }
            flushPending()
            Thread {
                try { while (sock === s) { Thread.sleep(25_000); if (sock === s) post(JSONObject().put("t", "ping")) } } catch (_: Exception) {}
            }.apply { isDaemon = true }.start()
            while (running) {
                val line = rd.readLine() ?: break
                val msg = decrypt(line) ?: break
                handle(msg)
            }
        } finally {
            closeSock()
        }
    }

    private fun deviceName(): String = try {
        Settings.Global.getString(contentResolver, Settings.Global.DEVICE_NAME) ?: Build.MODEL
    } catch (_: Exception) { Build.MODEL }

    // ---------------------------------------------------------------- отправка и приём
    private fun decrypt(line: String): JSONObject? {
        val k = key ?: return null
        val plain = Crypto.decrypt(k, line) ?: return null
        return try {
            val o = JSONObject(plain)
            val n = o.optLong("n", -1)
            if (n <= recvN) null else { recvN = n; o }
        } catch (_: Exception) { null }
    }

    private fun sendNow(o: JSONObject): Boolean = synchronized(sendLock) {
        val wr = out ?: return false
        val k = key ?: return false
        try {
            sendN++
            o.put("n", sendN)
            wr.write(Crypto.encrypt(k, o.toString()))
            wr.write("\n")
            wr.flush()
            true
        } catch (_: Exception) {
            out = null
            false
        }
    }

    /** Отправить событие; если связи нет — придержать до переподключения (звонок важно не потерять) */
    fun post(o: JSONObject) {
        io.execute {
            if (sendNow(o)) return@execute
            val t = o.optString("t")
            if (t == "ping") return@execute
            o.remove("n")
            o.put("queuedAt", System.currentTimeMillis())
            pending.offer(o)
            while (pending.size > 30) pending.pollFirst()
            sock?.let { reconnect() }
        }
    }

    private fun flushPending() {
        val now = System.currentTimeMillis()
        while (true) {
            val o = pending.pollFirst() ?: break
            if (now - o.optLong("queuedAt", now) > 60_000) continue   // устаревшее (звонок давно закончился)
            o.remove("queuedAt")
            sendNow(o)
        }
    }

    private fun closeSock() {
        ScreenCast.stop()                       // компьютер пропал — трансляцию тоже останавливаем
        synchronized(sendLock) { out = null }
        try { sock?.close() } catch (_: Exception) {}
        sock = null
    }

    private fun handle(m: JSONObject) {
        when (m.optString("t")) {
            // касания из окна «Телефон» — сразу, мимо очереди команд (там может ждать снимок или геокодер)
            "touch" -> FelixAccessibility.instance?.touch(m.optString("a"), m.optDouble("x"), m.optDouble("y"))
            "cmd" -> cmds.execute {
                val id = m.optString("id")
                val r = try { phone.run(m) } catch (e: Exception) { Res(false, e.message ?: "ошибка") }
                post(JSONObject().put("t", "res").put("id", id).put("ok", r.ok).put("text", r.text).put("data", r.data ?: JSONObject.NULL))
            }
            "say" -> {
                // ответ Феликса на команду, отправленную с телефона — его же голосом (WAV с компьютера)
                val text = m.optString("text")
                lastReply = text
                main.post { listeners.forEach { it() } }
                val wav = m.optString("wav", "")
                val played = wav.isNotEmpty() && wav != "null" && try {
                    Voice.play(android.util.Base64.decode(wav, android.util.Base64.NO_WRAP), m.optDouble("rate", 1.0).toFloat(), m.optDouble("volume", 1.0).toFloat())
                } catch (_: Exception) { false }
                if (!played) main.post {
                    if (m.optBoolean("speak", true)) {
                        // запасной вариант: голос телефона, но с тем же тоном
                        tts?.setPitch(m.optDouble("rate", 1.0).toFloat())
                        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "felix")
                    } else Toast.makeText(this, text, Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    /** Команда для Феликса на компьютере (с экрана приложения или голосом в телефон) */
    fun sendToFelix(text: String) {
        post(JSONObject().put("t", "felix").put("text", text))
    }
}

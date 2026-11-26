package app.felixassistant.link

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.view.Display
import org.json.JSONObject
import java.io.DataOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Экран телефона на компьютере — видеопотоком, как у программ для трансляции экрана:
 * MediaProjection → виртуальный дисплей → аппаратный кодер H.264 → отдельное TCP-соединение с компьютером.
 * Каждый кадр зашифрован тем же ключом сопряжения (AES-256-GCM), первым идёт разовый пропуск от компьютера.
 * Кадр в сети: [длина u32][iv 12][шифр(тип u8, номер u32, время u64, данные)][тег 16].
 * Типы: 0 — привет (JSON: пропуск, размер), 1 — SPS/PPS, 2 — ключевой кадр, 3 — обычный кадр.
 * Разрешение Android на запись экрана спрашивается один раз за сеанс; после закрытия окна на компьютере
 * трансляция останавливается, а разрешение держится ещё 10 минут (чтобы не спрашивать снова), потом снимается.
 */
object ScreenCast {
    @Volatile var projection: MediaProjection? = null
    @Volatile private var want: JSONObject? = null          // запрос с компьютера, ждущий разрешения
    @Volatile private var streamer: Streamer? = null
    // виртуальный дисплей живёт столько же, сколько разрешение: Android 14+ даёт создать его только один раз на проекцию,
    // поэтому между трансляциями и при повороте экрана ему лишь меняют размер и поверхность кодера
    @Volatile private var vd: VirtualDisplay? = null
    private val main = Handler(Looper.getMainLooper())
    private val releaseLater = Runnable { stopProjection() }
    const val KEEP_MS = 10 * 60_000L

    val streaming get() = streamer?.alive == true

    /** Команда с компьютера: включить трансляцию. Возвращает состояние: streaming | consent | error */
    fun start(ctx: Context, m: JSONObject, host: String, key: SecretKeySpec?): Res {
        if (key == null) return Res(false, "нет связи")
        main.removeCallbacks(releaseLater)
        val req = JSONObject(m.toString()).put("host", host)
        streamer?.stop()
        val p = projection
        if (p != null) { begin(ctx, p, req, key); return Res(true, "streaming", JSONObject().put("state", "streaming")) }
        want = req
        // окно разрешения Android: прозрачная активность (из фона её пускает служба спец. возможностей или «поверх окон»);
        // если система не пустит — остаётся уведомление «Показать экран на компьютере?», нажатие открывает то же окно
        askByNotification(ctx)
        try { ctx.startActivity(Intent(ctx, CastPermissionActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)) } catch (_: Exception) {}
        return Res(true, "consent", JSONObject().put("state", "consent"))
    }

    private const val ASK_ID = 7
    private fun askByNotification(ctx: Context) {
        try {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel("cast", "Показ экрана на компьютере", NotificationManager.IMPORTANCE_HIGH))
            val pi = PendingIntent.getActivity(ctx, ASK_ID, Intent(ctx, CastPermissionActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            nm.notify(ASK_ID, Notification.Builder(ctx, "cast")
                .setContentTitle("Показать экран на компьютере?")
                .setContentText("Нажми — Android спросит разрешение на трансляцию")
                .setSmallIcon(R.drawable.ic_stat)
                .setContentIntent(pi).setAutoCancel(true).setTimeoutAfter(60_000)
                .build())
        } catch (_: Exception) {}
    }
    private fun cancelAsk(ctx: Context) { try { ctx.getSystemService(NotificationManager::class.java).cancel(ASK_ID) } catch (_: Exception) {} }

    /** Разрешение получено (или нет) — из CastPermissionActivity */
    fun onPermission(ctx: Context, resultCode: Int, data: Intent?) {
        val svc = LinkService.instance
        cancelAsk(ctx)
        val req = want; want = null
        if (resultCode != Activity.RESULT_OK || data == null || svc == null || req == null) {
            svc?.post(JSONObject().put("t", "cast").put("state", "denied"))
            return
        }
        try {
            svc.castForeground(true)       // Android 10+: запись экрана — только из службы с типом mediaProjection
            val mpm = ctx.getSystemService(MediaProjectionManager::class.java)
            val p = mpm.getMediaProjection(resultCode, data) ?: throw IllegalStateException("нет проекции")
            p.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() { if (projection === p) { projection = null; streamer?.stop(); releaseDisplay(); svc.castForeground(false) } }
            }, main)
            projection = p
            val key = svc.currentKey() ?: throw IllegalStateException("нет ключа")
            begin(ctx, p, req, key)
        } catch (e: Exception) {
            svc.post(JSONObject().put("t", "cast").put("state", "error").put("text", e.message ?: "ошибка"))
            svc.castForeground(false)
        }
    }

    private fun begin(ctx: Context, p: MediaProjection, req: JSONObject, key: SecretKeySpec) {
        val s = Streamer(ctx, p, req, key)
        streamer = s
        Thread({ s.run() }, "felix-cast").start()
    }

    /** Компьютер закрыл окно: остановить поток, разрешение — снять через 10 минут */
    fun stop() {
        streamer?.stop(); streamer = null
        main.removeCallbacks(releaseLater)
        if (projection != null) main.postDelayed(releaseLater, KEEP_MS)
    }

    fun stopProjection() {
        streamer?.stop(); streamer = null
        val p = projection; projection = null
        releaseDisplay()
        try { p?.stop() } catch (_: Exception) {}
        LinkService.instance?.castForeground(false)
    }

    private fun releaseDisplay() { try { vd?.release() } catch (_: Exception) {}; vd = null }

    fun requestKeyFrame() { streamer?.keyFrame() }

    /** Кодер и сеть одной трансляции */
    private class Streamer(val ctx: Context, val p: MediaProjection, val req: JSONObject, val key: SecretKeySpec) : DisplayManager.DisplayListener {
        @Volatile var alive = true
        private var codec: MediaCodec? = null
        private var sock: Socket? = null
        private var out: DataOutputStream? = null
        private val rnd = SecureRandom()
        private var seq = 0L
        private var w = 0; private var h = 0
        @Volatile private var restart = false
        private val dm = ctx.getSystemService(DisplayManager::class.java)

        fun stop() { alive = false; try { sock?.close() } catch (_: Exception) {} }
        fun keyFrame() { try { codec?.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) }) } catch (_: Exception) {} }

        @Suppress("DEPRECATION")
        private fun displaySize(): Triple<Int, Int, Int> {
            val m = DisplayMetrics(); dm.getDisplay(Display.DEFAULT_DISPLAY).getRealMetrics(m)
            return Triple(m.widthPixels, m.heightPixels, m.densityDpi)
        }

        fun run() {
            try {
                val s = Socket(); s.tcpNoDelay = true; s.sendBufferSize = 1 shl 20
                s.connect(InetSocketAddress(req.getString("host"), req.optInt("port", 47893)), 4000)
                sock = s; out = DataOutputStream(s.getOutputStream().buffered(1 shl 16))
                main.post { dm.registerDisplayListener(this, main) }
                LinkService.instance?.screenShared()
                while (alive) {
                    restart = false
                    encodeLoop()
                    if (!restart) break
                }
            } catch (_: Exception) {
            } finally {
                alive = false
                main.post { try { dm.unregisterDisplayListener(this) } catch (_: Exception) {} }
                release()
                try { sock?.close() } catch (_: Exception) {}
                LinkService.instance?.post(JSONObject().put("t", "cast").put("state", "stopped").put("token", req.optString("token")))
            }
        }

        private fun release() {
            try { vd?.surface = null } catch (_: Exception) {}        // дисплей остаётся, только без поверхности
            try { codec?.stop() } catch (_: Exception) {}
            try { codec?.release() } catch (_: Exception) {}
            codec = null
        }

        private fun encodeLoop() {
            val (dw, dh, dpi) = displaySize()
            // длинная сторона не больше maxSize, обе — кратны 16 (так любят кодеры)
            val max = req.optInt("maxSize", 1280).coerceIn(480, 1920)
            val k = minOf(1.0, max.toDouble() / maxOf(dw, dh))
            w = ((dw * k).toInt() / 16) * 16; h = ((dh * k).toInt() / 16) * 16
            val fps = req.optInt("fps", 60)
            val fmt = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                setInteger(MediaFormat.KEY_BIT_RATE, req.optInt("bitrate", 6_000_000))
                setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 10)
                setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 100_000)     // экран стоит — всё равно шлём кадр раз в 0,1 с
                setInteger(MediaFormat.KEY_PRIORITY, 0)                             // реальное время
                if (Build.VERSION.SDK_INT >= 30) setInteger(MediaFormat.KEY_LATENCY, 1)
                setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline)   // без B-кадров — без задержки
                setInteger(MediaFormat.KEY_LEVEL, MediaCodecInfo.CodecProfileLevel.AVCLevel41)
            }
            val c = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            try { c.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE) }
            catch (_: Exception) { fmt.removeKey(MediaFormat.KEY_PROFILE); fmt.removeKey(MediaFormat.KEY_LEVEL); c.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE) }
            val surface = c.createInputSurface()
            c.start(); codec = c
            val v = vd
            if (v == null) vd = p.createVirtualDisplay("felix-cast", w, h, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, surface, null, null)
            else { v.resize(w, h, dpi); v.surface = surface }
            send(0, 0, JSONObject().put("token", req.optString("token")).put("w", w).put("h", h).put("sw", dw).put("sh", dh).put("fps", fps).toString().toByteArray())
            val info = MediaCodec.BufferInfo()
            var buf = ByteArray(1 shl 16)
            try {
                while (alive && !restart) {
                    val i = c.dequeueOutputBuffer(info, 100_000)
                    if (i < 0) continue
                    val ob: ByteBuffer? = c.getOutputBuffer(i)
                    if (ob != null && info.size > 0) {
                        if (buf.size < info.size) buf = ByteArray(info.size * 2)
                        ob.position(info.offset); ob.get(buf, 0, info.size)
                        val type = when {
                            info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0 -> 1
                            info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0 -> 2
                            else -> 3
                        }
                        send(type, info.presentationTimeUs, buf, info.size)
                        LinkService.instance?.screenShared()
                    }
                    c.releaseOutputBuffer(i, false)
                }
            } finally { release() }
        }

        /** Зашифровать и отправить кадр */
        private fun send(type: Int, pts: Long, data: ByteArray, len: Int = data.size) {
            val plain = ByteBuffer.allocate(13 + len)
            plain.put(type.toByte()); plain.putInt((++seq).toInt()); plain.putLong(pts); plain.put(data, 0, len)
            val iv = ByteArray(12).also { rnd.nextBytes(it) }
            val cph = Cipher.getInstance("AES/GCM/NoPadding")
            cph.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
            val ct = cph.doFinal(plain.array())
            val o = out ?: throw IllegalStateException("closed")
            o.writeInt(12 + ct.size); o.write(iv); o.write(ct); o.flush()
        }

        // поворот экрана — перезапускаем кодер с новым размером
        override fun onDisplayChanged(id: Int) {
            if (id != Display.DEFAULT_DISPLAY) return
            val (dw, dh) = displaySize()
            if ((dw > dh) != (w > h)) { restart = true }
        }
        override fun onDisplayAdded(id: Int) {}
        override fun onDisplayRemoved(id: Int) {}
    }
}

/** Прозрачное окно: спросить у Android разрешение на трансляцию экрана и сразу закрыться */
class CastPermissionActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent(), 7)
        } catch (_: Exception) { ScreenCast.onPermission(this, RESULT_CANCELED, null); finish() }
    }

    @Deprecated("startActivityForResult")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        ScreenCast.onPermission(applicationContext, resultCode, data)
        finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
    }
}

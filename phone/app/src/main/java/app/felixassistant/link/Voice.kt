package app.felixassistant.link

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

/**
 * Голос Феликса на телефоне — тот же, что на компьютере. Компьютер присылает готовый WAV (Piper «Дмитрий»)
 * и коэффициент rate. На ПК голос проигрывается быстрее в rate раз (WebAudio playbackRate) — от этого он выше.
 * Здесь то же самое: те же отсчёты, но частота дискретизации умножена на rate — звук совпадает один в один.
 */
object Voice {
    private class Wav(val sampleRate: Int, val channels: Int, val bits: Int, val data: ByteArray)

    private val main = Handler(Looper.getMainLooper())
    private var track: AudioTrack? = null

    @Synchronized
    fun stop() {
        track?.let { try { it.stop() } catch (_: Exception) {}; it.release() }
        track = null
    }

    @Synchronized
    fun play(wavBytes: ByteArray, rate: Float, volume: Float): Boolean {
        stop()
        val w = parse(wavBytes) ?: return false
        if (w.data.isEmpty()) return false
        val sr = (w.sampleRate * rate.coerceIn(0.5f, 2f)).roundToInt().coerceIn(4000, 192000)
        val t = try {
            AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(AudioFormat.Builder()
                    .setSampleRate(sr)
                    .setChannelMask(if (w.channels == 2) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO)
                    .setEncoding(if (w.bits == 8) AudioFormat.ENCODING_PCM_8BIT else AudioFormat.ENCODING_PCM_16BIT)
                    .build())
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setBufferSizeInBytes(w.data.size)
                .build()
        } catch (e: Exception) { return false }
        t.write(w.data, 0, w.data.size)
        t.setVolume(volume.coerceIn(0f, 1f))
        t.play()
        track = t
        // освобождаем, когда фраза доиграла
        val frames = w.data.size / maxOf(1, w.channels * w.bits / 8)
        main.postDelayed({ synchronized(this) { if (track === t) { t.release(); track = null } } }, frames * 1000L / sr + 400)
        return true
    }

    /** RIFF/WAVE: ищем куски «fmt » и «data» (PCM 8/16 бит) */
    private fun parse(b: ByteArray): Wav? {
        if (b.size < 44 || String(b, 0, 4) != "RIFF" || String(b, 8, 4) != "WAVE") return null
        val bb = ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN)
        var pos = 12
        var sr = 0; var ch = 1; var bits = 16; var fmt = 0
        while (pos + 8 <= b.size) {
            val id = String(b, pos, 4)
            val size = bb.getInt(pos + 4)
            val body = pos + 8
            if (size < 0 || body + size > b.size + 1) return null
            when (id) {
                "fmt " -> { fmt = bb.getShort(body).toInt(); ch = bb.getShort(body + 2).toInt(); sr = bb.getInt(body + 4); bits = bb.getShort(body + 14).toInt() }
                "data" -> {
                    if (fmt != 1 || sr <= 0) return null
                    val len = minOf(size, b.size - body)
                    return Wav(sr, ch, bits, b.copyOfRange(body, body + len))
                }
            }
            pos = body + size + (size and 1)
        }
        return null
    }
}

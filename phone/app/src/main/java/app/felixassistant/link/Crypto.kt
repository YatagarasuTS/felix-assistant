package app.felixassistant.link

import android.util.Base64
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Шифрование связи с компьютером. Ключ выводится из кода сопряжения (PBKDF2-SHA256, 100 000 итераций),
 * каждое сообщение — AES-256-GCM со случайным IV. Строка в сети: base64(iv[12] + шифртекст + тег[16]).
 * То же самое делает оболочка на ПК (src/shell/lib/link.js).
 */
object Crypto {
    fun normalizeCode(code: String): String = code.uppercase().filter { it.isLetterOrDigit() }

    fun deriveKey(code: String): SecretKeySpec {
        val spec = PBEKeySpec(normalizeCode(code).toCharArray(), "FelixLink1".toByteArray(), 100_000, 256)
        val bytes = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        return SecretKeySpec(bytes, "AES")
    }

    private val rnd = SecureRandom()

    fun encrypt(key: SecretKeySpec, plain: String): String {
        val iv = ByteArray(12).also { rnd.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        val ct = c.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(iv + ct, Base64.NO_WRAP)
    }

    fun decrypt(key: SecretKeySpec, line: String): String? = try {
        val all = Base64.decode(line, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, all, 0, 12))
        String(c.doFinal(all, 12, all.size - 12), Charsets.UTF_8)
    } catch (e: Exception) {
        null
    }
}

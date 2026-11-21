package app.felixassistant.link

import android.content.Context

/** Настройки приложения */
object Prefs {
    private fun p(c: Context) = c.getSharedPreferences("link", Context.MODE_PRIVATE)

    fun code(c: Context): String = p(c).getString("code", "") ?: ""
    fun setCode(c: Context, v: String) = p(c).edit().putString("code", Crypto.normalizeCode(v)).apply()

    /** IP компьютера, если поиск по сети не работает (например, в гостевой сети) */
    fun manualHost(c: Context): String = p(c).getString("manualHost", "") ?: ""
    fun setManualHost(c: Context, v: String) = p(c).edit().putString("manualHost", v.trim()).apply()

    fun lastHost(c: Context): String = p(c).getString("lastHost", "") ?: ""
    fun setLastHost(c: Context, v: String) = p(c).edit().putString("lastHost", v).apply()

    fun pcName(c: Context): String = p(c).getString("pcName", "компьютер") ?: "компьютер"
    fun setPcName(c: Context, v: String) = p(c).edit().putString("pcName", v).apply()

    /** Для включения компьютера по сети — приходит от компьютера при подключении */
    fun wolMac(c: Context): String = p(c).getString("wolMac", "") ?: ""
    fun wolBroadcast(c: Context): String = p(c).getString("wolBroadcast", "") ?: ""
    fun setWol(c: Context, mac: String, broadcast: String) = p(c).edit().putString("wolMac", mac).putString("wolBroadcast", broadcast).apply()

    fun forwardNotifs(c: Context): Boolean = p(c).getBoolean("forwardNotifs", true)
    fun setForwardNotifs(c: Context, v: Boolean) = p(c).edit().putBoolean("forwardNotifs", v).apply()
}

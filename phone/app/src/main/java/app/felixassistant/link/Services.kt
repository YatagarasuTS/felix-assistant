package app.felixassistant.link

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.location.Geocoder
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Приложения на телефоне для команд с компьютера: «закажи пиццу», «вызови такси до работы», «маршрут до вокзала».
 * Какое приложение открывать, выбирает пользователь в настройках Феликса на компьютере; компьютер присылает
 * пакет приложения и ссылки-шаблоны ({q} — запрос, {addr} — адрес, {lat}/{lon} — координаты адреса).
 * Ничего не заказывается само: Феликс открывает приложение и вписывает запрос, подтверждает человек.
 */
object Services {
    private val main = Handler(Looper.getMainLooper())

    /** Все приложения с ярлыком: [{ pkg, label, icon? }] — для выбора в настройках и окна «Телефон» на компьютере */
    fun apps(ctx: Context, icons: Boolean): JSONArray {
        val pm = ctx.packageManager
        val acts = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
        val seen = HashSet<String>()
        val list = mutableListOf<JSONObject>()
        for (a in acts) {
            val pkg = a.activityInfo.packageName
            if (pkg == ctx.packageName || !seen.add(pkg)) continue
            val o = JSONObject().put("pkg", pkg).put("label", a.loadLabel(pm).toString())
            if (icons) try { iconPng(a.loadIcon(pm))?.let { o.put("icon", it) } } catch (_: Exception) {}
            list.add(o)
        }
        list.sortBy { it.optString("label").lowercase(Locale.ROOT) }
        return JSONArray(list)
    }

    private fun iconPng(d: Drawable, size: Int = 72): String? {
        val b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        d.setBounds(0, 0, size, size)
        d.draw(Canvas(b))
        val bos = ByteArrayOutputStream()
        b.compress(Bitmap.CompressFormat.PNG, 100, bos)
        b.recycle()
        return Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
    }

    fun label(ctx: Context, pkg: String): String? = try {
        val pm = ctx.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) { null }

    fun launch(ctx: Context, pkg: String): Boolean {
        val i = ctx.packageManager.getLaunchIntentForPackage(pkg) ?: return false
        return try { ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)); true } catch (_: Exception) { false }
    }

    /** Открыть ссылку (https://, geo:, схему приложения). pkg — открыть именно в этом приложении. */
    fun openUrl(ctx: Context, url: String, pkg: String?): Boolean {
        if (url.isBlank()) return false
        val i = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (!pkg.isNullOrBlank()) i.setPackage(pkg)
        return try { ctx.startActivity(i); true } catch (_: ActivityNotFoundException) { false } catch (_: Exception) { false }
    }

    /** Буфер обмена телефона (запись из фоновой службы Android разрешает, чтение — нет) */
    fun setClip(ctx: Context, text: String): Boolean {
        val latch = CountDownLatch(1)
        var ok = false
        main.post {
            try {
                ctx.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Феликс", text))
                ok = true
            } catch (_: Exception) {}
            latch.countDown()
        }
        latch.await(2, TimeUnit.SECONDS)
        return ok
    }

    /** Координаты адреса — встроенным геокодером телефона; near — город пользователя (из погоды Феликса) */
    @Suppress("DEPRECATION")
    fun geocode(ctx: Context, address: String, near: JSONObject?): Pair<Double, Double>? {
        if (address.isBlank() || !Geocoder.isPresent()) return null
        return try {
            val g = Geocoder(ctx, Locale("ru", "RU"))
            val lat = near?.optDouble("lat", Double.NaN) ?: Double.NaN
            val lon = near?.optDouble("lon", Double.NaN) ?: Double.NaN
            val list = if (!lat.isNaN() && !lon.isNaN())
                g.getFromLocationName(address, 1, lat - 0.7, lon - 1.2, lat + 0.7, lon + 1.2)?.takeIf { it.isNotEmpty() } ?: g.getFromLocationName(address, 1)
            else g.getFromLocationName(address, 1)
            list?.firstOrNull()?.let { it.latitude to it.longitude }
        } catch (_: Exception) { null }
    }

    /**
     * Открыть выбранное приложение для дела: { pkg, links[], query, dest, near, search }.
     * 1) ссылки по очереди (с подстановкой запроса/адреса/координат) — в этом приложении;
     * 2) не вышло — просто запустить приложение, скопировать запрос в буфер и вписать его в поиск (служба спец. возможностей).
     */
    fun service(ctx: Context, m: JSONObject): Res {
        val pkg = m.optString("pkg")
        if (pkg.isBlank()) return Res(false, "не выбрано приложение")
        val label = label(ctx, pkg) ?: return Res(false, "приложение не установлено на телефоне")
        val query = m.optString("query").trim()
        val dest = m.optString("dest").trim()
        var coords: Pair<Double, Double>? = null
        var geoTried = false
        var how = ""
        val links = m.optJSONArray("links") ?: JSONArray()
        for (i in 0 until links.length()) {
            var u = links.optString(i)
            if (u.isBlank()) continue
            if (u.contains("{lat}") || u.contains("{lon}")) {
                if (dest.isBlank()) continue
                if (!geoTried) { coords = geocode(ctx, dest, m.optJSONObject("near")); geoTried = true }
                val c = coords ?: continue
                u = u.replace("{lat}", String.format(Locale.ROOT, "%.6f", c.first)).replace("{lon}", String.format(Locale.ROOT, "%.6f", c.second))
            }
            if (u.contains("{q}") && query.isBlank()) continue
            if (u.contains("{addr}") && dest.isBlank()) continue
            u = u.replace("{q}", Uri.encode(query)).replace("{addr}", Uri.encode(dest))
            if (openUrl(ctx, u, pkg)) { how = "link"; break }
        }
        if (how.isEmpty()) {
            if (!launch(ctx, pkg)) return Res(false, "$label не запускается")
            how = "app"
        }
        // ссылка не сработала — вписываем запрос (или адрес) сами; в буфер — на случай, если поле не нашлось
        val text = if (how == "app") query.ifBlank { dest } else ""
        var typed = false
        var clip = false
        if (text.isNotEmpty()) {
            clip = setClip(ctx, text)
            if (m.optBoolean("search", true)) typed = FelixAccessibility.instance?.autoSearch(pkg, text) == true
        }
        return Res(true, label, JSONObject().put("how", how).put("typed", typed).put("clip", clip).put("label", label).put("geo", coords != null))
    }

    /** Включить экран, чтобы на компьютере было что показать (на некоторых телефонах не срабатывает) */
    @Suppress("DEPRECATION")
    fun wake(ctx: Context): Boolean = try {
        val pm = ctx.getSystemService(PowerManager::class.java)
        if (!pm.isInteractive) {
            pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "felix:wake").acquire(3000)
        }
        true
    } catch (_: Exception) { false }
}

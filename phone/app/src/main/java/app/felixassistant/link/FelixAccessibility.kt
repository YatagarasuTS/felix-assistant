package app.felixassistant.link

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Path
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.DisplayMetrics
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Специальная возможность «Феликс Link — управление с компьютера». Всё — только по команде с компьютера:
 *  • кнопка «Динамик» на экране звонка (MIUI не даёт включать громкую связь напрямую);
 *  • «Назад», «Домой», «Обзор», шторка, блокировка — из окна «Телефон» на компьютере или голосом;
 *  • нажатия, прокрутка и ввод текста — когда пользователь кликает по экрану телефона в окне на компьютере;
 *  • поле поиска в приложении доставки, такси, магазина — Феликс вписывает туда то, что попросили;
 *  • снимок экрана (Android 11+) — только пока на компьютере открыто окно «Телефон».
 * Служба сама ничего не читает в фоне, не хранит и не отправляет в интернет.
 * Плюс: пока служба включена, Android разрешает приложению открывать будильник и другие приложения из фона.
 */
class FelixAccessibility : AccessibilityService() {
    companion object {
        @Volatile var instance: FelixAccessibility? = null
        private val SPEAKER = listOf("динамик", "громкая", "громкоговор", "speaker")
        // подсказки поля поиска на русском и английском: «Поиск», «Найти блюдо», «Куда едем?», «Search»
        private val SEARCH = listOf("поиск", "найти", "искать", "search", "куда", "where to", "найдите", "блюд", "ресторан", "товар", "магазин")
        const val SHOT_INTERVAL_MS = 340L   // Android не даёт снимать экран чаще ~3 раз в секунду
    }

    private val main = Handler(Looper.getMainLooper())
    private val shotExec = Executors.newSingleThreadExecutor()
    @Volatile private var lastShotAt = 0L

    override fun onServiceConnected() { instance = this }
    override fun onUnbind(intent: Intent?): Boolean { instance = null; return super.onUnbind(intent) }
    override fun onDestroy() { instance = null; super.onDestroy() }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    // ---------------------------------------------------------------- громкая связь
    /** Нажать «Динамик». on — нужное состояние; если кнопка уже в нём, ничего не нажимаем. */
    fun clickSpeaker(on: Boolean): Boolean {
        for (r in roots()) {
            val n = find(r) { x -> val t = label(x); SPEAKER.any { t.contains(it) } && !t.contains("громкость") } ?: continue
            if ((n.isCheckable && n.isChecked == on) || (n.isSelected && on)) return true
            if (clickNode(n)) return true
        }
        return false
    }

    // ---------------------------------------------------------------- кнопки системы
    fun global(action: String): Boolean {
        val a = when (action) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents" -> GLOBAL_ACTION_RECENTS
            "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
            "quick" -> GLOBAL_ACTION_QUICK_SETTINGS
            "power" -> GLOBAL_ACTION_POWER_DIALOG
            "lock" -> GLOBAL_ACTION_LOCK_SCREEN
            "screenshot" -> GLOBAL_ACTION_TAKE_SCREENSHOT
            else -> return false
        }
        return performGlobalAction(a)
    }

    // ---------------------------------------------------------------- нажатия и прокрутка (координаты — доли экрана 0…1)
    @Suppress("DEPRECATION")
    fun screenSize(): Pair<Int, Int> {
        val dm = DisplayMetrics()
        getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY).getRealMetrics(dm)
        return dm.widthPixels to dm.heightPixels
    }

    fun tap(x: Double, y: Double, long: Boolean = false): Boolean = gesture(listOf(x to y), if (long) 650 else 60)

    fun swipe(x1: Double, y1: Double, x2: Double, y2: Double, ms: Long): Boolean = gesture(listOf(x1 to y1, x2 to y2), ms)

    private fun gesture(points: List<Pair<Double, Double>>, ms: Long): Boolean {
        val (w, h) = screenSize()
        val path = Path()
        points.forEachIndexed { i, (x, y) ->
            val px = (x.coerceIn(0.0, 1.0) * (w - 1)).toFloat()
            val py = (y.coerceIn(0.0, 1.0) * (h - 1)).toFloat()
            if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
        }
        val dur = ms.coerceIn(1, 5000)
        val g = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, dur)).build()
        val latch = CountDownLatch(1)
        var ok = false
        main.post {
            val sent = dispatchGesture(g, object : GestureResultCallback() {
                override fun onCompleted(d: GestureDescription?) { ok = true; latch.countDown() }
                override fun onCancelled(d: GestureDescription?) { latch.countDown() }
            }, null)
            if (!sent) latch.countDown()
        }
        latch.await(dur + 2500, TimeUnit.MILLISECONDS)
        return ok
    }

    // ---------------------------------------------------------------- касание «вживую»: палец идёт за мышью
    // Жест режется на короткие куски, каждый продолжает предыдущий (willContinue) — палец не отрывается от экрана,
    // поэтому перетаскивание, прокрутка и долгое нажатие работают как на самом телефоне. Всё — на главном потоке.
    private var stroke: GestureDescription.StrokeDescription? = null
    private var lastPt: Pair<Float, Float>? = null
    private var lastAt = 0L
    private var busy = false
    private val queue = ArrayList<Pair<Float, Float>>()
    private var upPending = false
    private val keepAlive = Runnable { if (stroke != null && !busy) flush(true) }

    fun touch(a: String, x: Double, y: Double) { main.post { touchMain(a, x, y) } }

    private fun toPx(x: Double, y: Double): Pair<Float, Float> {
        val (w, h) = screenSize()
        return (x.coerceIn(0.0, 1.0) * (w - 1)).toFloat() to (y.coerceIn(0.0, 1.0) * (h - 1)).toFloat()
    }

    private fun touchMain(a: String, x: Double, y: Double) {
        val p = toPx(x, y)
        when (a) {
            "down" -> {
                main.removeCallbacks(keepAlive)
                queue.clear(); upPending = false
                lastPt = p; lastAt = android.os.SystemClock.uptimeMillis()
                val path = Path().apply { moveTo(p.first, p.second) }
                dispatchSeg(GestureDescription.StrokeDescription(path, 0, 1, true), false)
            }
            "move" -> { if (stroke == null && !busy) return; queue.add(p); if (!busy) flush(false) }
            "up" -> { if (stroke == null && !busy) return; queue.add(p); upPending = true; if (!busy) flush(false) }
        }
    }

    private fun flush(force: Boolean) {
        val s0 = stroke ?: return
        if (queue.isEmpty() && !upPending && !force) return
        main.removeCallbacks(keepAlive)
        val from = lastPt ?: return
        val pts = ArrayList(queue); queue.clear()
        val path = Path().apply { moveTo(from.first, from.second); for (q in pts) lineTo(q.first, q.second) }
        val now = android.os.SystemClock.uptimeMillis()
        val dur = (now - lastAt).coerceIn(8, 120)
        lastAt = now
        if (pts.isNotEmpty()) lastPt = pts.last()
        val end = upPending
        upPending = false
        val s = try { s0.continueStroke(path, 0, dur, !end) } catch (_: Exception) { stroke = null; return }
        dispatchSeg(s, end)
    }

    private fun dispatchSeg(s: GestureDescription.StrokeDescription, last: Boolean) {
        stroke = if (last) null else s
        busy = true
        val ok = dispatchGesture(GestureDescription.Builder().addStroke(s).build(), object : GestureResultCallback() {
            override fun onCompleted(d: GestureDescription?) {
                busy = false
                if (stroke == null) return
                if (queue.isNotEmpty() || upPending) flush(false) else main.postDelayed(keepAlive, 60)   // мышь стоит — палец держим
            }
            override fun onCancelled(d: GestureDescription?) { busy = false; stroke = null; queue.clear(); upPending = false }
        }, main)
        if (!ok) { busy = false; stroke = null }
    }

    // ---------------------------------------------------------------- ввод текста в поле, где стоит курсор
    fun typeText(text: String, enter: Boolean, replace: Boolean, erase: Int = 0): Boolean {
        val n = findInput() ?: return false
        val showingHint = Build.VERSION.SDK_INT >= 26 && n.isShowingHintText
        val old = if (replace || showingHint) "" else (n.text?.toString() ?: "")
        val ok = setText(n, old.dropLast(erase.coerceAtLeast(0)) + text)
        if (enter) pressEnter(n)
        return ok
    }

    private fun setText(n: AccessibilityNodeInfo, s: String): Boolean {
        val b = Bundle()
        b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, s)
        return n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b)
    }

    private fun pressEnter(n: AccessibilityNodeInfo): Boolean =
        Build.VERSION.SDK_INT >= 30 && n.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)

    private fun findInput(): AccessibilityNodeInfo? {
        findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.let { if (it.isEditable) return it }
        return rootInActiveWindow?.let { r -> find(r) { it.isEditable && it.isFocused } ?: find(r) { it.isEditable } }
    }

    /**
     * Вписать запрос в поиск только что открытого приложения (доставка, такси, магазин).
     * Ждём, пока приложение pkg выйдет на экран; ищем поле поиска, а если его нет — кнопку «Поиск» и жмём её один раз.
     * Ничего не заказывает и не подтверждает: дальше выбирает человек.
     */
    fun autoSearch(pkg: String, query: String, timeoutMs: Long = 7000): Boolean {
        val t0 = System.currentTimeMillis()
        var clicked = false
        while (System.currentTimeMillis() - t0 < timeoutMs) {
            val root = rootInActiveWindow
            if (root != null && root.packageName?.toString() == pkg) {
                var edit = find(root) { it.isEditable && it.isVisibleToUser && looksLikeSearch(it) }
                // после нажатия «Поиск» поле обычно уже с курсором, но без подсказки
                if (edit == null && clicked) edit = find(root) { it.isEditable && it.isVisibleToUser && it.isFocused } ?: find(root) { it.isEditable && it.isVisibleToUser }
                if (edit != null) {
                    edit.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                    edit.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                    Thread.sleep(250)
                    val target = findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.takeIf { it.isEditable } ?: edit
                    if (setText(target, query)) { Thread.sleep(300); pressEnter(target); return true }
                }
                if (!clicked) {
                    val btn = find(root) { !it.isEditable && it.isVisibleToUser && looksLikeSearch(it) }
                    if (btn != null && clickNode(btn)) { clicked = true; Thread.sleep(900); continue }
                }
            }
            Thread.sleep(400)
        }
        return false
    }

    private fun looksLikeSearch(n: AccessibilityNodeInfo): Boolean {
        val id = (n.viewIdResourceName ?: "").lowercase()
        val hint = if (Build.VERSION.SDK_INT >= 26) (n.hintText ?: "").toString().lowercase() else ""
        val t = label(n) + " " + hint
        return id.contains("search") || SEARCH.any { t.contains(it) }
    }

    // ---------------------------------------------------------------- снимок экрана для окна «Телефон» на компьютере
    /** JPEG шириной не больше maxW: { jpeg, w, h }. Только Android 11+, иначе null. */
    fun shot(maxW: Int, quality: Int): JSONObject? {
        if (Build.VERSION.SDK_INT < 30) return null
        for (attempt in 0..1) {
            val wait = SHOT_INTERVAL_MS - (System.currentTimeMillis() - lastShotAt)
            if (wait > 0) Thread.sleep(wait)
            val latch = CountDownLatch(1)
            var out: JSONObject? = null
            var err = 0
            takeScreenshot(Display.DEFAULT_DISPLAY, shotExec, object : TakeScreenshotCallback {
                override fun onSuccess(r: ScreenshotResult) {
                    try {
                        val hb = r.hardwareBuffer
                        val hw = Bitmap.wrapHardwareBuffer(hb, r.colorSpace)
                        val sw = hw?.copy(Bitmap.Config.ARGB_8888, false)
                        hw?.recycle(); hb.close()
                        if (sw != null) {
                            val k = minOf(1f, maxW.coerceIn(160, 1440).toFloat() / sw.width)
                            val bmp = if (k < 1f) Bitmap.createScaledBitmap(sw, (sw.width * k).toInt(), (sw.height * k).toInt(), true).also { sw.recycle() } else sw
                            val bos = ByteArrayOutputStream()
                            bmp.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(30, 90), bos)
                            out = JSONObject().put("jpeg", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)).put("w", bmp.width).put("h", bmp.height)
                            bmp.recycle()
                        }
                    } catch (_: Exception) {}
                    latch.countDown()
                }
                override fun onFailure(code: Int) { err = code; latch.countDown() }
            })
            latch.await(4, TimeUnit.SECONDS)
            lastShotAt = System.currentTimeMillis()
            if (out != null) return out
            if (err != ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT) return null
        }
        return null
    }

    // ---------------------------------------------------------------- помощники
    private fun roots(): List<AccessibilityNodeInfo> {
        val list = mutableListOf<AccessibilityNodeInfo>()
        try { windows?.forEach { w -> w.root?.let { list.add(it) } } } catch (_: Exception) {}
        rootInActiveWindow?.let { list.add(it) }
        return list
    }

    private fun label(n: AccessibilityNodeInfo) = ((n.text ?: "").toString() + " " + (n.contentDescription ?: "").toString()).lowercase()

    private fun clickNode(n: AccessibilityNodeInfo): Boolean {
        var x: AccessibilityNodeInfo? = n
        while (x != null && !x.isClickable) x = x.parent
        return x?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
    }

    private fun find(n: AccessibilityNodeInfo?, depth: Int = 0, pred: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
        if (n == null || depth > 40) return null
        if (pred(n)) return n
        for (i in 0 until n.childCount) {
            val r = find(n.getChild(i), depth + 1, pred)
            if (r != null) return r
        }
        return null
    }
}

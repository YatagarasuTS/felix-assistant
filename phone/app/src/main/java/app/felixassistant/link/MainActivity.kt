package app.felixassistant.link

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.speech.RecognizerIntent
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast

/** Экран «Феликс Link»: код сопряжения, состояние связи, команда для Феликса и все разрешения в одном месте */
class MainActivity : Activity() {
    private val accent = Color.parseColor("#1FB5A3")
    private val bg = Color.parseColor("#071113")
    private val panel = Color.parseColor("#0E1E21")
    private val textC = Color.parseColor("#E8FBF8")
    private val dim = Color.parseColor("#86AFAA")

    private lateinit var status: TextView
    private lateinit var reply: TextView
    private lateinit var code: EditText
    private lateinit var host: EditText
    private lateinit var cmd: EditText
    private val permRows = mutableListOf<Pair<TextView, () -> Boolean>>()
    private val onChange: () -> Unit = { runOnUiThread { refresh() } }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = bg
        window.navigationBarColor = bg
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(22), dp(18), dp(28)) }
        setContentView(ScrollView(this).apply { setBackgroundColor(bg); addView(root) })

        // шапка: портрет Феликса и название
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(android.widget.ImageView(this).apply {
            setImageResource(R.drawable.felix_head)
            scaleType = android.widget.ImageView.ScaleType.CENTER_CROP
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(panel); setStroke(dp(2), accent) }
            clipToOutline = true
            setPadding(dp(2), dp(2), dp(2), dp(2))
        }, LinearLayout.LayoutParams(dp(76), dp(76)))
        val titles = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        titles.addView(TextView(this).apply { text = "Феликс Link"; textSize = 28f; setTextColor(textC); typeface = Typeface.DEFAULT_BOLD })
        titles.addView(label("Пульт для Феликса на компьютере и управление телефоном с компьютера: команды, звонки, доставка, такси — по Wi-Fi"))
        head.addView(titles, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(14) })
        root.addView(head)

        // --- состояние и код
        val card1 = card(root)
        status = TextView(this).apply { textSize = 16f; setTextColor(accent); typeface = Typeface.DEFAULT_BOLD; setPadding(0, 0, 0, dp(10)) }
        card1.addView(status)
        card1.addView(label("Код сопряжения — на компьютере: Настройки Феликса → Телефон"))
        code = input("ABCD-EFGH", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS).apply { setText(formatCode(Prefs.code(this@MainActivity))) }
        card1.addView(code)
        card1.addView(label("IP компьютера — только если он не находится сам (необязательно)"))
        host = input("например 192.168.1.10", InputType.TYPE_CLASS_TEXT).apply { setText(Prefs.manualHost(this@MainActivity)) }
        card1.addView(host)
        card1.addView(button("Подключить", primary = true) {
            Prefs.setCode(this, code.text.toString())
            Prefs.setManualHost(this, host.text.toString())
            askRuntimePermissions()
            LinkService.start(this)
            LinkService.instance?.reconnect()
            Toast.makeText(this, "Подключаюсь…", Toast.LENGTH_SHORT).show()
        })
        card1.addView(View(this), LinearLayout.LayoutParams(1, dp(8)))
        card1.addView(button("⏻  Включить компьютер") { wakePc() })

        // --- команда для Феликса
        val card2 = card(root)
        card2.addView(header("Феликс"))
        card2.addView(label("Команда для Феликса на компьютере, например: «какая погода», «что сейчас играет», «следующий трек»"))
        cmd = input("Феликс, …", InputType.TYPE_CLASS_TEXT)
        card2.addView(cmd)
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(button("Отправить") { sendCmd(cmd.text.toString()) }, LinearLayout.LayoutParams(0, -2, 1f))
        row.addView(View(this), LinearLayout.LayoutParams(dp(8), 1))
        row.addView(button("🎤 Сказать") { listen() }, LinearLayout.LayoutParams(0, -2, 1f))
        card2.addView(row)
        reply = TextView(this).apply { textSize = 15f; setTextColor(textC); setPadding(0, dp(10), 0, 0) }
        card2.addView(reply)

        // --- разрешения
        val card3 = card(root)
        card3.addView(header("Разрешения"))
        card3.addView(label("Каждое нужно один раз. Для MIUI обязательны «Автозапуск» и «Без ограничений», иначе телефон будет закрывать связь в фоне. «Специальные возможности» нужны, чтобы с компьютера нажимать «Назад», «Домой», кликать по экрану телефона и вписывать запрос в поиск доставки или такси."))
        perm(card3, "Звонки, контакты, журнал вызовов", { hasAll(runtimePerms()) }) { askRuntimePermissions() }
        perm(card3, "Управление с компьютера и громкая связь (специальные возможности)", { accessibilityOn() }) { open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        perm(card3, "Уведомления телефона на компьютере", { notifListenerOn() }) { open(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        perm(card3, "Беззвучный режим и «Не беспокоить»", { getSystemService(NotificationManager::class.java).isNotificationPolicyAccessGranted }) { open(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)) }
        perm(card3, "Поверх других окон (будильник из фона)", { Settings.canDrawOverlays(this) }) { open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) }
        perm(card3, "Без ограничений расхода батареи", { getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName) }) {
            open(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        }
        perm(card3, "Автозапуск (MIUI)", null) {
            open(Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")), appDetails())
        }
        perm(card3, "Всплывающие окна в фоне (MIUI)", null) {
            open(Intent("miui.intent.action.APP_PERM_EDITOR").setClassName("com.miui.securitycenter", "com.miui.permcenter.permissions.PermissionsEditorActivity").putExtra("extra_pkgname", packageName), appDetails())
        }
        val sw = Switch(this).apply {
            text = "Показывать уведомления телефона на компьютере"
            setTextColor(textC)
            isChecked = Prefs.forwardNotifs(this@MainActivity)
            setPadding(0, dp(12), 0, 0)
            setOnCheckedChangeListener { _, v -> Prefs.setForwardNotifs(this@MainActivity, v) }
        }
        card3.addView(sw)

        if (Prefs.code(this).isNotEmpty()) LinkService.start(this)
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** Ярлык «Включить компьютер» (долгое нажатие на значок приложения) */
    private fun handleIntent(i: Intent?) {
        if (i?.action == "app.felixassistant.link.WAKE") { wakePc(); i.action = null }
    }

    private fun wakePc() {
        val mac = Prefs.wolMac(this)
        if (mac.isBlank()) { Toast.makeText(this, "Сначала один раз подключитесь к компьютеру — он сообщит телефону свой адрес", Toast.LENGTH_LONG).show(); return }
        if (LinkService.connected) { Toast.makeText(this, "Компьютер уже включён и на связи", Toast.LENGTH_SHORT).show(); return }
        Thread {
            val ok = Wol.send(mac, Prefs.wolBroadcast(this))
            runOnUiThread {
                Toast.makeText(this, if (ok) "Сигнал включения отправлен — компьютер запустится через несколько секунд" else "Не удалось отправить сигнал. Телефон в домашней сети Wi-Fi?", Toast.LENGTH_LONG).show()
            }
        }.start()
    }

    override fun onResume() {
        super.onResume()
        LinkService.listeners.add(onChange)
        LinkService.instance?.refreshPermissions()
        refresh()
    }

    override fun onPause() {
        LinkService.listeners.remove(onChange)
        super.onPause()
    }

    private fun refresh() {
        status.text = if (LinkService.instance == null && Prefs.code(this).isEmpty()) "Введите код и нажмите «Подключить»" else LinkService.status
        status.setTextColor(if (LinkService.connected) Color.parseColor("#4ADE80") else accent)
        reply.text = LinkService.lastReply.let { if (it.isBlank()) "" else "Феликс: $it" }
        for ((tv, check) in permRows) {
            val ok = check()
            tv.text = if (ok) "✓" else "✗"
            tv.setTextColor(if (ok) Color.parseColor("#4ADE80") else accent)
        }
    }

    // ---------------------------------------------------------------- команды
    private fun sendCmd(text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        // «включи компьютер» выполняет сам телефон: выключенный компьютер команду не услышит
        if (Regex("(включи|запусти|разбуди|вруби)\\s+(мой\\s+)?(компьютер|комп|пк)", RegexOption.IGNORE_CASE).containsMatchIn(t)) { cmd.setText(""); wakePc(); return }
        val s = LinkService.instance
        if (s == null || !LinkService.connected) { Toast.makeText(this, "Нет связи с компьютером", Toast.LENGTH_SHORT).show(); return }
        s.sendToFelix(t)
        cmd.setText("")
        reply.text = "Вы: $t"
    }

    @Suppress("DEPRECATION")
    private fun listen() {
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU")
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Команда для Феликса")
        try { startActivityForResult(i, 7) } catch (e: Exception) { Toast.makeText(this, "На телефоне нет распознавания речи", Toast.LENGTH_LONG).show() }
    }

    @Deprecated("startActivityForResult")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 7 && resultCode == RESULT_OK) {
            val text = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: return
            sendCmd(text)
        }
    }

    // ---------------------------------------------------------------- разрешения
    private fun runtimePerms(): Array<String> {
        val list = mutableListOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG, Manifest.permission.ANSWER_PHONE_CALLS, Manifest.permission.CALL_PHONE, Manifest.permission.READ_CONTACTS)
        if (Build.VERSION.SDK_INT >= 33) list.add(Manifest.permission.POST_NOTIFICATIONS)
        return list.toTypedArray()
    }

    private fun hasAll(p: Array<String>) = p.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    private fun askRuntimePermissions() {
        val missing = runtimePerms().filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 1)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        LinkService.instance?.refreshPermissions()
        refresh()
    }

    private fun accessibilityOn(): Boolean {
        val s = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        return s.contains("$packageName/") && s.contains("FelixAccessibility")
    }

    private fun notifListenerOn(): Boolean {
        val s = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        return s.contains(packageName)
    }

    private fun appDetails() = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))

    private fun open(vararg intents: Intent) {
        for (i in intents) {
            try { startActivity(i); return } catch (_: Exception) {}
        }
        Toast.makeText(this, "Не открылось — найдите это в настройках телефона", Toast.LENGTH_LONG).show()
    }

    // ---------------------------------------------------------------- оформление
    private fun card(parent: LinearLayout): LinearLayout {
        val c = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(16))
            background = GradientDrawable().apply { setColor(panel); cornerRadius = dp(14).toFloat(); setStroke(dp(1), Color.parseColor("#1D3A3D")) }
        }
        parent.addView(c, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(14) })
        return c
    }

    private fun header(t: String) = TextView(this).apply { text = t; textSize = 18f; setTextColor(textC); typeface = Typeface.DEFAULT_BOLD; setPadding(0, 0, 0, dp(4)) }
    private fun label(t: String) = TextView(this).apply { text = t; textSize = 13f; setTextColor(dim); setPadding(0, dp(4), 0, dp(4)) }

    private fun input(hint: String, type: Int) = EditText(this).apply {
        this.hint = hint
        inputType = type
        setTextColor(textC)
        setHintTextColor(Color.parseColor("#4F6E6B"))
        textSize = 17f
        setSingleLine()
    }

    private fun button(t: String, primary: Boolean = false, onClick: () -> Unit) = Button(this).apply {
        text = t
        isAllCaps = false
        setTextColor(if (primary) Color.parseColor("#04201D") else Color.WHITE)
        if (primary) typeface = Typeface.DEFAULT_BOLD
        background = GradientDrawable().apply { setColor(if (primary) accent else Color.parseColor("#163033")); cornerRadius = dp(10).toFloat() }
        setOnClickListener { onClick() }
    }

    private fun perm(parent: LinearLayout, title: String, check: (() -> Boolean)?, onClick: () -> Unit) {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(6), 0, dp(6)) }
        val mark = TextView(this).apply { textSize = 18f; setPadding(0, 0, dp(10), 0); text = if (check == null) "•" else "" ; setTextColor(dim) }
        row.addView(mark)
        row.addView(TextView(this).apply { text = title; textSize = 15f; setTextColor(textC) }, LinearLayout.LayoutParams(0, -2, 1f))
        row.addView(button("Открыть") { onClick() }, LinearLayout.LayoutParams(-2, dp(40)))
        parent.addView(row)
        if (check != null) permRows.add(mark to check)
    }

    private fun formatCode(c: String) = if (c.length == 8) c.substring(0, 4) + "-" + c.substring(4) else c
}

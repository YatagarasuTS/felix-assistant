package app.felixassistant.link

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject

/** Уведомления телефона: последние 20 — для «Феликс, прочитай уведомления», новые — на компьютер (если включено) */
class NotifListener : NotificationListenerService() {
    companion object {
        val recent = ArrayDeque<JSONObject>()
        private val SKIP = setOf("android", "com.android.systemui", "com.android.incallui", "com.android.phone", "com.miui.securitycenter", "com.android.providers.downloads")
    }

    private var lastKey = ""
    private var lastAt = 0L

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName == packageName || sbn.packageName in SKIP || sbn.isOngoing) return
        val n = sbn.notification
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        if (n.category == Notification.CATEGORY_CALL || n.category == Notification.CATEGORY_PROGRESS) return
        val title = n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: return
        val text = (n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: n.extras.getCharSequence(Notification.EXTRA_TEXT))?.toString() ?: ""
        // одно и то же уведомление часто приходит несколько раз подряд
        val key = sbn.packageName + "|" + title + "|" + text
        val now = System.currentTimeMillis()
        if (key == lastKey && now - lastAt < 5000) return
        lastKey = key; lastAt = now
        val app = try { packageManager.getApplicationLabel(packageManager.getApplicationInfo(sbn.packageName, 0)).toString() } catch (e: Exception) { sbn.packageName }
        val o = JSONObject().put("t", "notif").put("app", app).put("title", title.take(100)).put("text", text.take(300)).put("at", now)
        synchronized(recent) {
            recent.addFirst(o)
            while (recent.size > 20) recent.removeLast()
        }
        if (Prefs.forwardNotifs(this)) LinkService.instance?.post(JSONObject(o.toString()))
    }
}

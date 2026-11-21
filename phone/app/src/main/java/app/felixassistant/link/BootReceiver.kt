package app.felixassistant.link

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** После включения телефона (и после обновления приложения) снова выходим на связь */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (Prefs.code(context).isNotEmpty()) LinkService.start(context)
    }
}

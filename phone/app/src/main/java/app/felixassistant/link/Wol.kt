package app.felixassistant.link

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

/**
 * Включение компьютера по сети (Wake-on-LAN): «волшебный пакет» — 6 байт 0xFF и 16 раз MAC сетевой карты.
 * MAC и широковещательный адрес присылает сам компьютер при подключении (Феликс Link запоминает их).
 * Работает, когда телефон в той же сети, а в BIOS компьютера включено пробуждение по сети.
 */
object Wol {
    fun send(mac: String, broadcast: String): Boolean {
        val m = mac.split(':', '-').mapNotNull { it.toIntOrNull(16)?.toByte() }
        if (m.size != 6) return false
        val pkt = ByteArray(6 + 16 * 6)
        for (i in 0 until 6) pkt[i] = 0xFF.toByte()
        for (i in 0 until 16) for (j in 0 until 6) pkt[6 + i * 6 + j] = m[j]
        var ok = false
        try {
            DatagramSocket().use { s ->
                s.broadcast = true
                for (addr in listOf(broadcast, "255.255.255.255").filter { it.isNotBlank() }.distinct()) {
                    for (port in listOf(9, 7)) {
                        repeat(3) {
                            try { s.send(DatagramPacket(pkt, pkt.size, InetAddress.getByName(addr), port)); ok = true } catch (_: Exception) {}
                        }
                    }
                }
            }
        } catch (_: Exception) {}
        return ok
    }
}

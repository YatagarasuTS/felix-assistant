using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net.NetworkInformation;
using System.Speech.Synthesis;

namespace Felix
{
    /// <summary>Клавиши, состояние сети и запасной голос Windows. Системные настройки Windows Феликс не меняет.</summary>
    static class Desk
    {
        public static void Cleanup() { }

        // ---------- Клавиши ----------
        static readonly Dictionary<string, byte> Vk = new Dictionary<string, byte>(StringComparer.OrdinalIgnoreCase)
        {
            { "LWIN", 0x5B }, { "WIN", 0x5B }, { "CTRL", 0x11 }, { "ALT", 0x12 }, { "SHIFT", 0x10 }, { "TAB", 0x09 }, { "ESC", 0x1B },
            { "ENTER", 0x0D }, { "SPACE", 0x20 }, { "SNAPSHOT", 0x2C }, { "PRINTSCREEN", 0x2C }, { "DELETE", 0x2E }, { "F4", 0x73 }, { "F11", 0x7A },
            { "PLAYPAUSE", 0xB3 }, { "NEXT", 0xB0 }, { "PREV", 0xB1 }, { "STOP", 0xB2 }, { "MUTE", 0xAD }, { "VOLUP", 0xAF }, { "VOLDOWN", 0xAE },
            { "UP", 0x26 }, { "DOWN", 0x28 }, { "LEFT", 0x25 }, { "RIGHT", 0x27 }
        };

        public static void Keys(List<string> seq)
        {
            var codes = seq.Select(s => Vk.TryGetValue(s, out var v) ? v : (s.Length == 1 ? (byte)char.ToUpperInvariant(s[0]) : (byte)0)).Where(b => b != 0).ToList();
            foreach (var c in codes) N.keybd_event(c, 0, IsExt(c) ? 1u : 0u, UIntPtr.Zero);
            for (int i = codes.Count - 1; i >= 0; i--) N.keybd_event(codes[i], 0, (IsExt(codes[i]) ? 1u : 0u) | 2u, UIntPtr.Zero);
        }

        static bool IsExt(byte vk) => vk == 0x5B || vk == 0x2E || (vk >= 0x25 && vk <= 0x28) || (vk >= 0xAD && vk <= 0xB3);

        // ---------- Сеть (есть ли интернет) ----------
        public static Dictionary<string, object> Net()
        {
            var up = NetworkInterface.GetAllNetworkInterfaces()
                .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback && n.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
                .Where(n => n.GetIPProperties().GatewayAddresses.Any(g => !g.Address.ToString().StartsWith("0.")))
                .ToList();
            var wifi = up.FirstOrDefault(n => n.NetworkInterfaceType == NetworkInterfaceType.Wireless80211);
            string type = wifi != null ? "wifi" : up.Count > 0 ? "ethernet" : "none";
            return new Dictionary<string, object> { { "type", type }, { "online", up.Count > 0 } };
        }

        // ---------- Запасной голос Windows (SAPI): мужской русский, если есть ----------
        public static string Sapi(string text, string path, int rate)
        {
            using (var s = new SpeechSynthesizer())
            {
                var voices = s.GetInstalledVoices();
                var v = voices.FirstOrDefault(x => x.VoiceInfo.Culture.Name == "ru-RU" && x.VoiceInfo.Gender == VoiceGender.Male)
                        ?? voices.FirstOrDefault(x => x.VoiceInfo.Culture.Name == "ru-RU")
                        ?? voices.FirstOrDefault(x => x.VoiceInfo.Gender == VoiceGender.Male);
                if (v != null) s.SelectVoice(v.VoiceInfo.Name);
                s.Rate = rate;
                s.SetOutputToWaveFile(path);
                s.Speak(text);
            }
            return path;
        }
    }
}

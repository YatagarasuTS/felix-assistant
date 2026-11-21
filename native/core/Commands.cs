using System;
using System.Collections.Generic;

namespace Felix
{
    static class Commands
    {
        public static object Run(string cmd, Args a)
        {
            switch (cmd)
            {
                case "ping": return "pong";

                // окна
                case "windows": return WinMgr.List();
                case "foreground": return WinMgr.Describe(N.GetForegroundWindow());
                case "activate": WinMgr.Activate(a.H("hwnd")); return true;
                case "toggle": return WinMgr.Toggle(a.H("hwnd"));
                case "minimize": WinMgr.Minimize(a.H("hwnd")); return true;
                case "maximize": WinMgr.Maximize(a.H("hwnd")); return true;
                case "close": WinMgr.Close(a.H("hwnd")); return true;
                case "minimizeAll": WinMgr.MinimizeAll(); return true;
                case "exclude":
                    foreach (var p in a.List("pids")) WinMgr.ExcludePids.Add(uint.Parse(p));
                    return true;

                // оболочка Windows: программы из «Пуска», значки рабочего стола, корзина
                case "apps": return ShellApi.Apps();
                case "icon": return ShellApi.Icon(a.S("target"), a.I("size", 64));
                case "desktopIcons": return ShellApi.DesktopIcons();
                case "recycle": return ShellApi.RecycleInfo();
                case "emptyRecycle": ShellApi.EmptyRecycle(); return true;
                case "keys": Desk.Keys(a.List("keys")); return true;
                case "net": return Desk.Net();
                case "lang": return Hooks.CurrentLang;
                case "hotkeys":
                    Hooks.InterceptWinY = a.B("winY", true);
                    return true;

                // звук
                case "volume":
                    if (!a.Has("level") && !a.Has("mute") && !a.Has("delta")) return Audio.Get();
                    return Audio.Set(a.Has("level") ? a.D("level") : (double?)null, a.Has("mute") ? a.B("mute") : (bool?)null, a.Has("delta") ? a.D("delta") : (double?)null);

                // речь
                case "sttStart": return Stt.Start(a.S("model"), a.I("device", 0));
                case "sttStop": Stt.Stop(); return true;
                case "sttPause": Stt.Pause(a.B("paused", true)); return true;
                case "sttStatus": return Stt.Status();
                case "sttFile": return Stt.FromFile(a.S("model"), a.S("path"));
                case "sapi": return Desk.Sapi(a.S("text"), a.S("path"), a.I("rate", 0));

                default: throw new Exception("неизвестная команда: " + cmd);
            }
        }
    }
}

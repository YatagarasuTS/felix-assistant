using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Felix
{
    /// <summary>STA-поток с циклом сообщений: хуки, AppBar-окна, таймеры.</summary>
    class UiThread
    {
        Thread _t;
        public Form Host;
        readonly ManualResetEvent _ready = new ManualResetEvent(false);

        public void Start()
        {
            _t = new Thread(() =>
            {
                Host = new Form { ShowInTaskbar = false, FormBorderStyle = FormBorderStyle.None, StartPosition = FormStartPosition.Manual, Location = new Point(-32000, -32000), Size = new Size(1, 1) };
                var _ = Host.Handle;
                try { Hooks.Install(); } catch (Exception e) { Program.Log("hooks: " + e); }
                _ready.Set();
                Application.Run();
            });
            _t.SetApartmentState(ApartmentState.STA);
            _t.IsBackground = true;
            _t.Start();
            _ready.WaitOne();
        }

        public T Invoke<T>(Func<T> f) => (T)Host.Invoke(f);
        public void Invoke(Action a) => Host.Invoke(a);

        public void Shutdown()
        {
            try { Host.Invoke(new Action(() => { Desk.Cleanup(); Hooks.Uninstall(); Application.ExitThread(); })); } catch { }
        }
    }

    /// <summary>Глобальные хуки: смена активного окна, окна появились/исчезли, Win+S / Win+Y, раскладка.</summary>
    static class Hooks
    {
        const uint EVENT_SYSTEM_FOREGROUND = 0x0003, EVENT_SYSTEM_MINIMIZESTART = 0x0016, EVENT_SYSTEM_MINIMIZEEND = 0x0017;
        const uint EVENT_OBJECT_DESTROY = 0x8001, EVENT_OBJECT_SHOW = 0x8002, EVENT_OBJECT_HIDE = 0x8003, EVENT_OBJECT_NAMECHANGE = 0x800C;
        const uint WINEVENT_OUTOFCONTEXT = 0, WINEVENT_SKIPOWNPROCESS = 2;
        static N.WinEventDelegate _fgProc, _objProc;
        static N.LowLevelKeyboardProc _kbProc;
        static IntPtr _fgHook, _minHook, _objHook, _kbHook;
        static System.Windows.Forms.Timer _debounce, _langTimer;
        static string _lastLang = "";
        public static bool InterceptWinS = false, InterceptWinY = true;
        static bool _winComboUsed;

        public static void Install()
        {
            _fgProc = OnForeground;
            _objProc = OnObject;
            _fgHook = N.SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, _fgProc, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
            _minHook = N.SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND, IntPtr.Zero, _objProc, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
            _objHook = N.SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_NAMECHANGE, IntPtr.Zero, _objProc, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);

            _debounce = new System.Windows.Forms.Timer { Interval = 250 };
            _debounce.Tick += (s, e) => { _debounce.Stop(); Program.Event("winchange"); };

            _langTimer = new System.Windows.Forms.Timer { Interval = 500 };
            _langTimer.Tick += (s, e) => CheckLang();
            _langTimer.Start();

            InstallKeyboard();
        }

        /// <summary>
        /// Перехват Win+S / Win+Y — в СВОЁМ потоке. Пока низкоуровневый хук не ответил, Windows задерживает
        /// все нажатия клавиш в системе, а UI-поток FelixCore бывает занят секундами (список приложений, значки).
        /// </summary>
        static void InstallKeyboard()
        {
            var t = new Thread(() =>
            {
                _kbProc = OnKey;
                _kbHook = N.SetWindowsHookEx(13 /*WH_KEYBOARD_LL*/, _kbProc, N.GetModuleHandle(null), 0);
                if (_kbHook == IntPtr.Zero) Program.Log("keyboard hook failed: " + Marshal.GetLastWin32Error());
                Application.Run();   // свой цикл сообщений: хук отвечает сразу, что бы ни делал UI-поток
            }) { IsBackground = true, Name = "FelixKeys" };
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
        }

        public static void Uninstall()
        {
            if (_fgHook != IntPtr.Zero) N.UnhookWinEvent(_fgHook);
            if (_minHook != IntPtr.Zero) N.UnhookWinEvent(_minHook);
            if (_objHook != IntPtr.Zero) N.UnhookWinEvent(_objHook);
            if (_kbHook != IntPtr.Zero) N.UnhookWindowsHookEx(_kbHook);
        }

        static void OnForeground(IntPtr hook, uint ev, IntPtr h, int idObj, int idChild, uint thread, uint time)
        {
            try { Program.Event("fg", WinMgr.Describe(h)); } catch { }
            _debounce.Stop(); _debounce.Start();
        }

        static void OnObject(IntPtr hook, uint ev, IntPtr h, int idObj, int idChild, uint thread, uint time)
        {
            if (idObj != 0 || idChild != 0 || h == IntPtr.Zero) return;
            if (N.GetAncestor(h, 2 /*GA_ROOT*/) != h) return;
            if (ev == EVENT_OBJECT_NAMECHANGE && h != N.GetForegroundWindow()) return;
            if (ev == EVENT_OBJECT_NAMECHANGE) { try { Program.Event("fg", WinMgr.Describe(h)); } catch { } }
            _debounce.Stop(); _debounce.Start();
        }

        static void CheckLang()
        {
            try
            {
                IntPtr fg = N.GetForegroundWindow();
                uint tid = N.GetWindowThreadProcessId(fg, out _);
                int lcid = N.GetKeyboardLayout(tid).ToInt32() & 0xFFFF;
                if (lcid == 0) return;
                string code = new CultureInfo(lcid).TwoLetterISOLanguageName.ToUpperInvariant();
                if (code != _lastLang)
                {
                    _lastLang = code;
                    Program.Event("lang", new Dictionary<string, object> { { "code", code } });
                }
            }
            catch { }
        }

        public static string CurrentLang => _lastLang;

        static IntPtr OnKey(int code, IntPtr w, IntPtr l)
        {
            if (code >= 0)
            {
                var k = (N.KBDLLHOOKSTRUCT)Marshal.PtrToStructure(l, typeof(N.KBDLLHOOKSTRUCT));
                bool injected = (k.flags & 0x10) != 0;
                int msg = w.ToInt32();
                bool down = msg == 0x100 || msg == 0x104;
                bool winHeld = (N.GetAsyncKeyState(0x5B) & 0x8000) != 0 || (N.GetAsyncKeyState(0x5C) & 0x8000) != 0;
                if (!injected && down && winHeld)
                {
                    string name = null;
                    if (k.vkCode == 0x53 && InterceptWinS) name = "search";
                    else if (k.vkCode == 0x59 && InterceptWinY) name = "felix";   // Win+Y → Феликс слушает
                    if (name != null)
                    {
                        _winComboUsed = true;
                        // «пустая» клавиша, чтобы отпускание Win не открыло меню Пуск
                        N.keybd_event(0xE8, 0, 0, UIntPtr.Zero);
                        N.keybd_event(0xE8, 0, 2, UIntPtr.Zero);
                        string n = name;
                        ThreadPool.QueueUserWorkItem(_ => Program.Event("hotkey", new Dictionary<string, object> { { "name", n } }));
                        return new IntPtr(1);
                    }
                }
                if (!down && (k.vkCode == 0x5B || k.vkCode == 0x5C)) _winComboUsed = false;
            }
            return N.CallNextHookEx(_kbHook, code, w, l);
        }
    }
}

// FelixInput — помощник ассистента «Феликс»: нажатия клавиш в программах, управление музыкой (системные
// медиа-сессии Windows) и выбор устройства вывода звука. Код взят из YataBars (YatagarasuOS), без резерва
// полос экрана, перехвата клавиши Win и трея. Собирается встроенным компилятором .NET Framework (C# 5).
// Протокол (строки через stdin/stdout):
//   do <activate <hwnd>|keys CTRL T|type <base64>|sleep <мс>>       — действия по очереди
//   media <id> <play|pause|toggle|next|prev|info> → media <id> <ok 0|1> <статус> <b64 исполнитель> <b64 название> <b64 AUMID>
//   audio <id> list | audio <id> set <devId>      → audio <id> <ok 0|1> [<b64 строки «id\tимя\tпо_умолчанию»>]
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace FelixInput
{
    static class Input
    {
        [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
        [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool alt);
        [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);

        static readonly Queue<string> _q = new Queue<string>();
        static readonly AutoResetEvent _ev = new AutoResetEvent(false);

        static readonly Dictionary<string, ushort> Vk = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase)
        {
            { "CTRL", 0x11 }, { "SHIFT", 0x10 }, { "ALT", 0x12 }, { "WIN", 0x5B }, { "TAB", 0x09 }, { "ENTER", 0x0D }, { "ESC", 0x1B },
            { "SPACE", 0x20 }, { "BACK", 0x08 }, { "DELETE", 0x2E }, { "INSERT", 0x2D }, { "HOME", 0x24 }, { "END", 0x23 },
            { "PGUP", 0x21 }, { "PGDN", 0x22 }, { "LEFT", 0x25 }, { "UP", 0x26 }, { "RIGHT", 0x27 }, { "DOWN", 0x28 },
            { "PLUS", 0xBB }, { "MINUS", 0xBD }, { "F1", 0x70 }, { "F2", 0x71 }, { "F3", 0x72 }, { "F4", 0x73 }, { "F5", 0x74 },
            { "F6", 0x75 }, { "F7", 0x76 }, { "F8", 0x77 }, { "F9", 0x78 }, { "F10", 0x79 }, { "F11", 0x7A }, { "F12", 0x7B }
        };

        static bool Ext(ushort vk) { return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B; }

        public static void Enqueue(string cmd) { lock (_q) _q.Enqueue(cmd); _ev.Set(); }

        public static void Start()
        {
            Thread t = new Thread(delegate ()
            {
                while (true)
                {
                    _ev.WaitOne();
                    while (true)
                    {
                        string cmd;
                        lock (_q) { if (_q.Count == 0) break; cmd = _q.Dequeue(); }
                        try { Run(cmd); } catch (Exception e) { Program.Log("do " + cmd.Split(' ')[0] + ": " + e.Message); }
                    }
                }
            });
            t.IsBackground = true;
            t.Start();
        }

        static void Run(string cmd)
        {
            string[] p = cmd.Split(' ');
            switch (p[0])
            {
                case "sleep": Thread.Sleep(Math.Min(10000, int.Parse(p[1]))); break;
                case "activate": Activate(new IntPtr(long.Parse(p[1]))); break;
                case "keys":
                    {
                        WaitModifiersUp();
                        List<ushort> codes = new List<ushort>();
                        for (int i = 1; i < p.Length; i++)
                        {
                            ushort v;
                            if (Vk.TryGetValue(p[i], out v)) codes.Add(v);
                            else if (p[i].Length == 1) codes.Add((ushort)char.ToUpperInvariant(p[i][0]));
                        }
                        List<INPUT> list = new List<INPUT>();
                        foreach (ushort c in codes) list.Add(Key(c, false));
                        for (int i = codes.Count - 1; i >= 0; i--) list.Add(Key(codes[i], true));
                        Send(list);
                        break;
                    }
                case "type":
                    {
                        WaitModifiersUp();
                        string text = Encoding.UTF8.GetString(Convert.FromBase64String(p[1]));
                        List<INPUT> list = new List<INPUT>();
                        foreach (char ch in text)
                        {
                            list.Add(Uni(ch, false)); list.Add(Uni(ch, true));
                        }
                        Send(list);
                        break;
                    }
            }
        }

        // пока пользователь держит Ctrl/Alt/Shift/Win, наши нажатия смешались бы с его — ждём до секунды
        static void WaitModifiersUp()
        {
            for (int i = 0; i < 20; i++)
            {
                bool held = false;
                foreach (int vk in new int[] { 0x10, 0x11, 0x12, 0x5B, 0x5C }) if ((GetAsyncKeyState(vk) & 0x8000) != 0) held = true;
                if (!held) return;
                Thread.Sleep(50);
            }
        }

        static INPUT Key(ushort vk, bool up)
        {
            INPUT i = new INPUT(); i.type = 1;
            i.u.ki.wVk = vk; i.u.ki.dwFlags = (up ? 2u : 0u) | (Ext(vk) ? 1u : 0u);
            return i;
        }

        static INPUT Uni(char ch, bool up)
        {
            INPUT i = new INPUT(); i.type = 1;
            i.u.ki.wScan = ch; i.u.ki.dwFlags = 4u /*UNICODE*/ | (up ? 2u : 0u);
            return i;
        }

        static void Send(List<INPUT> list)
        {
            if (list.Count == 0) return;
            if (SendInput((uint)list.Count, list.ToArray(), Marshal.SizeOf(typeof(INPUT))) == 0) Program.Log("SendInput failed " + Marshal.GetLastWin32Error());
        }

        static void Activate(IntPtr h)
        {
            if (!IsWindow(h)) return;
            IntPtr fg = GetForegroundWindow();
            uint pid;
            uint fgThread = GetWindowThreadProcessId(fg, out pid), me = GetCurrentThreadId();
            bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
            try
            {
                ShowWindow(h, IsIconic(h) ? 9 /*RESTORE*/ : 5 /*SHOW*/);
                BringWindowToTop(h);
                SetForegroundWindow(h);
            }
            finally { if (attached) AttachThreadInput(me, fgThread, false); }
            if (GetForegroundWindow() != h) SwitchToThisWindow(h, true);
            for (int i = 0; i < 10 && GetForegroundWindow() != h; i++) Thread.Sleep(30);
        }
    }

    /// <summary>
    /// Музыка через системное управление медиа Windows (то же, что кнопки на клавиатуре и в шторке громкости),
    /// но точнее: пауза — именно пауза, и командуем тем плеером, который играет (Nyao Music — в первую очередь).
    ///   media &lt;id&gt; &lt;play|pause|toggle|next|prev|info&gt;  →  media &lt;id&gt; &lt;ok 0|1&gt; &lt;статус&gt; &lt;base64 исполнитель&gt; &lt;base64 название&gt; &lt;base64 AUMID&gt;
    /// </summary>
    static class Media
    {
        static Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager _mgr;

        // ожидание операции WinRT без System.Runtime.WindowsRuntime (ему нужен Windows.winmd из SDK)
        static Task<T> Wait<T>(Windows.Foundation.IAsyncOperation<T> op)
        {
            var tcs = new TaskCompletionSource<T>();
            op.Completed = (o, st) =>
            {
                if (st == Windows.Foundation.AsyncStatus.Completed) tcs.TrySetResult(o.GetResults());
                else if (st == Windows.Foundation.AsyncStatus.Error) tcs.TrySetException(o.ErrorCode ?? new Exception("media error"));
                else tcs.TrySetCanceled();
            };
            return tcs.Task;
        }

        static string B64(string s) { return Convert.ToBase64String(Encoding.UTF8.GetBytes(s ?? "")); }
        static bool IsNyao(Windows.Media.Control.GlobalSystemMediaTransportControlsSession s) { return false; }
        static bool Playing(Windows.Media.Control.GlobalSystemMediaTransportControlsSession s)
        {
            try { return s.GetPlaybackInfo().PlaybackStatus == Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing; } catch { return false; }
        }

        public static async Task<string> Run(string action)
        {
            if (_mgr == null) _mgr = await Wait(Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager.RequestAsync());
            var all = new List<Windows.Media.Control.GlobalSystemMediaTransportControlsSession>(_mgr.GetSessions());
            Windows.Media.Control.GlobalSystemMediaTransportControlsSession s = null;
            // «продолжи» — в Nyao; остальное — в том, что сейчас играет (Nyao первым), иначе в Nyao, иначе в текущем
            if (action != "play")
            {
                foreach (var x in all) if (Playing(x) && IsNyao(x)) { s = x; break; }
                if (s == null) foreach (var x in all) if (Playing(x)) { s = x; break; }
            }
            if (s == null) foreach (var x in all) if (IsNyao(x)) { s = x; break; }
            if (s == null) s = _mgr.GetCurrentSession();
            if (s == null) return "0 none   ";
            bool ok = true;
            switch (action)
            {
                case "play": ok = await Wait(s.TryPlayAsync()); break;
                case "pause": ok = await Wait(s.TryPauseAsync()); break;
                case "toggle": ok = await Wait(s.TryTogglePlayPauseAsync()); break;
                case "next": ok = await Wait(s.TrySkipNextAsync()); break;
                case "prev": ok = await Wait(s.TrySkipPreviousAsync()); break;
            }
            if (action == "next" || action == "prev") await Task.Delay(900);   // дать плееру сменить трек, чтобы вернуть уже новое название
            string artist = "", title = "";
            try { var p = await Wait(s.TryGetMediaPropertiesAsync()); artist = p.Artist; title = p.Title; } catch { }
            string status = "Unknown";
            try { status = s.GetPlaybackInfo().PlaybackStatus.ToString(); } catch { }
            return (ok ? "1 " : "0 ") + status + " " + B64(artist) + " " + B64(title) + " " + B64(s.SourceAppUserModelId);
        }
    }

    /// <summary>
    /// Устройства вывода звука (колонки, наушники, HDMI): список и выбор «по умолчанию».
    /// Выбор — через IPolicyConfig (то же, что делает «Параметры → Звук»); для всех ролей сразу.
    ///   audio &lt;id&gt; list         → audio &lt;id&gt; 1 &lt;base64: строки «id\tимя\tпо_умолчанию(0|1)»&gt;
    ///   audio &lt;id&gt; set &lt;devId&gt; → audio &lt;id&gt; &lt;ok 0|1&gt;
    /// </summary>
    static class AudioOut
    {
        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceEnumerator
        {
            [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
            [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        }
        [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceCollection
        {
            [PreserveSig] int GetCount(out int count);
            [PreserveSig] int Item(int index, out IMMDevice device);
        }
        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDevice
        {
            [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr p, out IntPtr iface);
            [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore props);
            [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
            [PreserveSig] int GetState(out int state);
        }
        [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IPropertyStore
        {
            [PreserveSig] int GetCount(out int c);
            [PreserveSig] int GetAt(int i, out PROPERTYKEY k);
            [PreserveSig] int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
        }
        // недокументированный, но стабильный с Windows 7 интерфейс — им пользуются все переключатели звука
        [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IPolicyConfig
        {
            [PreserveSig] int GetMixFormat(IntPtr a, IntPtr b);
            [PreserveSig] int GetDeviceFormat(IntPtr a, int b, IntPtr c);
            [PreserveSig] int ResetDeviceFormat(IntPtr a);
            [PreserveSig] int SetDeviceFormat(IntPtr a, IntPtr b, IntPtr c);
            [PreserveSig] int GetProcessingPeriod(IntPtr a, int b, IntPtr c, IntPtr d);
            [PreserveSig] int SetProcessingPeriod(IntPtr a, IntPtr b);
            [PreserveSig] int GetShareMode(IntPtr a, IntPtr b);
            [PreserveSig] int SetShareMode(IntPtr a, IntPtr b);
            [PreserveSig] int GetPropertyValue(IntPtr a, IntPtr b, IntPtr c);
            [PreserveSig] int SetPropertyValue(IntPtr a, IntPtr b, IntPtr c);
            [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int role);
            [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int visible);
        }
        [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
        [StructLayout(LayoutKind.Explicit, Size = 24)] struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }
        [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT v);

        static readonly Guid CLSID_Enumerator = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
        static readonly Guid CLSID_PolicyConfig = new Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9");
        static readonly Guid PKEY_Name = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");   // pid 14 — «Динамики (Realtek …)»

        static IMMDeviceEnumerator Enumerator() { return (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_Enumerator)); }

        static string Name(IMMDevice d)
        {
            IPropertyStore ps;
            if (d.OpenPropertyStore(0, out ps) != 0 || ps == null) return "";
            PROPERTYKEY k = new PROPERTYKEY(); k.fmtid = PKEY_Name; k.pid = 14;
            PROPVARIANT v;
            if (ps.GetValue(ref k, out v) != 0) return "";
            string s = v.vt == 31 /*VT_LPWSTR*/ ? Marshal.PtrToStringUni(v.p) : "";
            PropVariantClear(ref v);
            return s ?? "";
        }

        public static string List()
        {
            IMMDeviceEnumerator e = Enumerator();
            string def = "";
            IMMDevice dd;
            if (e.GetDefaultAudioEndpoint(0 /*eRender*/, 1 /*eMultimedia*/, out dd) == 0 && dd != null) dd.GetId(out def);
            IMMDeviceCollection col;
            if (e.EnumAudioEndpoints(0 /*eRender*/, 1 /*ACTIVE*/, out col) != 0) return "";
            int n; col.GetCount(out n);
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < n; i++)
            {
                IMMDevice d; if (col.Item(i, out d) != 0) continue;
                string id; d.GetId(out id);
                sb.Append(id).Append('\t').Append(Name(d).Replace('\t', ' ').Replace('\n', ' ')).Append('\t').Append(id == def ? "1" : "0").Append('\n');
            }
            return Convert.ToBase64String(Encoding.UTF8.GetBytes(sb.ToString()));
        }

        public static bool Set(string id)
        {
            IPolicyConfig pc = (IPolicyConfig)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_PolicyConfig));
            bool ok = true;
            for (int role = 0; role < 3; role++) ok &= pc.SetDefaultEndpoint(id, role) == 0;   // консоль, мультимедиа, связь
            return ok;
        }
    }

    static class Program
    {
        static readonly object _lock = new object();
        static StreamWriter _out;

        public static void Log(string s)
        {
            try
            {
                string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Felix", "logs");
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "felixinput.log"), DateTime.Now.ToString("s") + " " + s + Environment.NewLine);
            }
            catch { }
        }

        static void Reply(string line) { try { lock (_lock) { _out.WriteLine(line); } } catch { } }

        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        [STAThread]
        static void Main()
        {
            try { SetProcessDPIAware(); } catch { }
            _out = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            _out.AutoFlush = true;
            Input.Start();
            StreamReader input = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8);
            string line;
            while ((line = input.ReadLine()) != null)
            {
                string[] p = line.Trim().Split(' ');
                if (p.Length == 0) continue;
                if (p[0] == "quit") break;
                if (p[0] == "media" && p.Length >= 3)
                {
                    string id = p[1], action = p[2];
                    Task.Run(async () =>
                    {
                        string r;
                        try { r = await Media.Run(action); } catch (Exception e) { Log("media: " + e.Message); r = "0 error   "; }
                        Reply("media " + id + " " + r);
                    });
                }
                else if (p[0] == "audio" && p.Length >= 3)
                {
                    string id = p[1], op = p[2], dev = p.Length >= 4 ? p[3] : "";
                    Task.Run(() =>
                    {
                        string r;
                        try { r = op == "set" ? (AudioOut.Set(dev) ? "1" : "0") : "1 " + AudioOut.List(); }
                        catch (Exception e) { Log("audio: " + e.Message); r = "0"; }
                        Reply("audio " + id + " " + r);
                    });
                }
                else if (p[0] == "do" && p.Length >= 2) Input.Enqueue(line.Trim().Substring(3));
            }
        }
    }
}
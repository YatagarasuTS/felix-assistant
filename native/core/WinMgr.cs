using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

namespace Felix
{
    static class WinMgr
    {
        static readonly HashSet<string> SkipClasses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow",
            "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland", "XamlExplorerHostIslandWindow", "ForegroundStaging"
        };

        public static HashSet<uint> ExcludePids = new HashSet<uint>();

        public static Dictionary<string, object> Describe(IntPtr h)
        {
            N.GetWindowThreadProcessId(h, out uint pid);
            string exe = N.ExeOfPid(pid);
            string aumid = Aumid.ForWindow(h);
            if (exe.EndsWith("ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase))
            {
                // UWP-окно: настоящий процесс у дочернего CoreWindow
                uint realPid = 0;
                N.EnumChildWindows(h, (c, l) =>
                {
                    N.GetWindowThreadProcessId(c, out uint p);
                    if (p != pid) { realPid = p; return false; }
                    return true;
                }, IntPtr.Zero);
                if (realPid != 0) { string e2 = N.ExeOfPid(realPid); if (e2 != "") { exe = e2; pid = realPid; } }
            }
            string cls = N.ClassOf(h);
            bool full = false;
            if (N.GetWindowRect(h, out N.RECT rc) && cls != "Progman" && cls != "WorkerW")
            {
                var b = System.Windows.Forms.Screen.FromHandle(h).Bounds;
                full = rc.Left <= b.Left && rc.Top <= b.Top && rc.Right >= b.Right && rc.Bottom >= b.Bottom;
            }
            return new Dictionary<string, object>
            {
                { "hwnd", h.ToInt64() }, { "title", N.Title(h) }, { "pid", (long)pid }, { "exe", exe },
                { "name", exe == "" ? "" : Path.GetFileNameWithoutExtension(exe) }, { "desc", Desc(exe) }, { "aumid", aumid ?? "" },
                { "cls", cls }, { "min", N.IsIconic(h) }, { "max", N.IsZoomed(h) }, { "active", h == N.GetForegroundWindow() },
                { "fullscreen", full }
            };
        }

        static readonly Dictionary<string, string> _desc = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        /// <summary>Понятное имя программы из описания exe (например «Проводник» вместо explorer).</summary>
        public static string Desc(string exe)
        {
            if (string.IsNullOrEmpty(exe)) return "";
            lock (_desc)
            {
                if (_desc.TryGetValue(exe, out var d)) return d;
                try
                {
                    var vi = System.Diagnostics.FileVersionInfo.GetVersionInfo(exe);
                    d = !string.IsNullOrWhiteSpace(vi.FileDescription) ? vi.FileDescription.Trim() : !string.IsNullOrWhiteSpace(vi.ProductName) ? vi.ProductName.Trim() : Path.GetFileNameWithoutExtension(exe);
                }
                catch { d = Path.GetFileNameWithoutExtension(exe); }
                _desc[exe] = d;
                return d;
            }
        }

        public static bool IsAppWindow(IntPtr h)
        {
            if (!N.IsWindowVisible(h)) return false;
            if (N.GetWindow(h, N.GW_OWNER) != IntPtr.Zero) return false;
            long ex = N.GetWindowLongPtr(h, N.GWL_EXSTYLE).ToInt64();
            if ((ex & N.WS_EX_TOOLWINDOW) != 0 && (ex & N.WS_EX_APPWINDOW) == 0) return false;
            if (N.IsCloaked(h)) return false;
            if (N.GetWindowTextLength(h) == 0) return false;
            if (SkipClasses.Contains(N.ClassOf(h))) return false;
            N.GetWindowThreadProcessId(h, out uint pid);
            if (ExcludePids.Contains(pid)) return false;
            return true;
        }

        public static List<object> List()
        {
            var list = new List<object>();
            N.EnumWindows((h, l) =>
            {
                try { if (IsAppWindow(h)) list.Add(Describe(h)); } catch { }
                return true;
            }, IntPtr.Zero);
            return list;
        }

        public static void Activate(IntPtr h)
        {
            if (!N.IsWindow(h)) throw new Exception("окно не найдено");
            IntPtr fg = N.GetForegroundWindow();
            uint fgThread = N.GetWindowThreadProcessId(fg, out _);
            uint cur = N.GetCurrentThreadId();
            bool attached = fgThread != 0 && fgThread != cur && N.AttachThreadInput(cur, fgThread, true);
            try
            {
                if (N.IsIconic(h)) N.ShowWindow(h, N.SW_RESTORE); else N.ShowWindow(h, N.SW_SHOW);
                N.BringWindowToTop(h);
                N.SetForegroundWindow(h);
            }
            finally { if (attached) N.AttachThreadInput(cur, fgThread, false); }
            if (N.GetForegroundWindow() != h) N.SwitchToThisWindow(h, true);
        }

        public static void Minimize(IntPtr h) => N.PostMessage(h, N.WM_SYSCOMMAND, new IntPtr(N.SC_MINIMIZE), IntPtr.Zero);
        public static void Close(IntPtr h) => N.PostMessage(h, N.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        public static void Maximize(IntPtr h) => N.ShowWindowAsync(h, N.IsZoomed(h) ? N.SW_RESTORE : N.SW_MAXIMIZE);

        /// <summary>Клик по иконке в доке: активное окно сворачивается, иначе — выходит на передний план.</summary>
        public static string Toggle(IntPtr h)
        {
            if (h == N.GetForegroundWindow() && !N.IsIconic(h)) { Minimize(h); return "minimized"; }
            Activate(h); return "activated";
        }

        public static void MinimizeAll()
        {
            N.EnumWindows((h, l) => { try { if (IsAppWindow(h) && !N.IsIconic(h)) Minimize(h); } catch { } return true; }, IntPtr.Zero);
        }
    }

    /// <summary>AppUserModelID окна (нужен для иконок и запуска UWP-приложений).</summary>
    static class Aumid
    {
        [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IPropertyStore
        {
            void GetCount(out uint c);
            void GetAt(uint i, out PROPERTYKEY k);
            void GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
            void SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
            void Commit();
        }
        [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public uint pid; }
        [StructLayout(LayoutKind.Explicit)] struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(16)] public IntPtr p2; }
        [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ps);
        [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT v);

        public static string ForWindow(IntPtr h)
        {
            try
            {
                Guid iid = typeof(IPropertyStore).GUID;
                if (SHGetPropertyStoreForWindow(h, ref iid, out IPropertyStore ps) != 0 || ps == null) return null;
                try
                {
                    var key = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
                    ps.GetValue(ref key, out PROPVARIANT v);
                    string s = v.vt == 31 /*VT_LPWSTR*/ ? Marshal.PtrToStringUni(v.p) : null;
                    PropVariantClear(ref v);
                    return s;
                }
                finally { Marshal.ReleaseComObject(ps); }
            }
            catch { return null; }
        }
    }
}

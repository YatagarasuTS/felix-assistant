using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace Felix
{
    static class ShellApi
    {
        // ---------- Список всех приложений (как в меню «Пуск», включая UWP) ----------
        public static List<object> Apps()
        {
            return Program.Ui.Invoke(() =>
            {
                var list = new List<object>();
                Type t = Type.GetTypeFromProgID("Shell.Application");
                dynamic shell = Activator.CreateInstance(t);
                try
                {
                    dynamic folder = shell.NameSpace("shell:AppsFolder");
                    foreach (dynamic item in folder.Items())
                    {
                        string name = item.Name;
                        string path = item.Path;
                        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(path)) continue;
                        list.Add(new Dictionary<string, object> { { "name", name }, { "id", path } });
                    }
                }
                finally { Marshal.ReleaseComObject(shell); }
                return list;
            });
        }

        // ---------- Иконки (PNG data-URL) для файла, ярлыка или AUMID ----------
        [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IShellItemImageFactory { [PreserveSig] int GetImage(N.SIZE size, int flags, out IntPtr phbm); }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        static extern int SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory item);

        static readonly Dictionary<string, string> _iconCache = new Dictionary<string, string>();

        public static string Icon(string target, int size)
        {
            if (string.IsNullOrEmpty(target)) return null;
            string key = target + "|" + size;
            lock (_iconCache) { if (_iconCache.TryGetValue(key, out var c)) return c; }
            string parsing = target;
            if (!target.Contains("\\") && !target.StartsWith("shell:", StringComparison.OrdinalIgnoreCase) && !target.StartsWith("::"))
                parsing = "shell:AppsFolder\\" + target; // AUMID
            string res = Program.Ui.Invoke(() =>
            {
                Guid iid = typeof(IShellItemImageFactory).GUID;
                if (SHCreateItemFromParsingName(parsing, IntPtr.Zero, ref iid, out var f) != 0 || f == null) return null;
                try
                {
                    if (f.GetImage(new N.SIZE(size, size), 0x4 | 0x1 /*ICONONLY|BIGGERSIZEOK*/, out IntPtr hbmp) != 0) return null;
                    try
                    {
                        using (var bmp = FromHBitmap(hbmp))
                        using (var ms = new MemoryStream())
                        {
                            Bitmap outBmp = bmp;
                            if (bmp.Width != size) outBmp = new Bitmap(bmp, new Size(size, size));
                            outBmp.Save(ms, ImageFormat.Png);
                            if (!ReferenceEquals(outBmp, bmp)) outBmp.Dispose();
                            return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
                        }
                    }
                    finally { N.DeleteObject(hbmp); }
                }
                finally { Marshal.ReleaseComObject(f); }
            });
            if (res != null) lock (_iconCache) _iconCache[key] = res;
            return res;
        }

        static Bitmap FromHBitmap(IntPtr hbmp)
        {
            var ds = new N.DIBSECTION();
            int sz = Marshal.SizeOf(typeof(N.DIBSECTION));
            if (N.GetObject(hbmp, sz, ref ds) != 0 && ds.dsBm.bmBitsPixel == 32 && ds.dsBm.bmBits != IntPtr.Zero)
            {
                int w = ds.dsBm.bmWidth, h = Math.Abs(ds.dsBm.bmHeight), stride = ds.dsBm.bmWidthBytes;
                var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
                var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                bool bottomUp = ds.dsBmih.biHeight > 0;
                var row = new byte[stride];
                for (int y = 0; y < h; y++)
                {
                    IntPtr src = IntPtr.Add(ds.dsBm.bmBits, (bottomUp ? (h - 1 - y) : y) * stride);
                    Marshal.Copy(src, row, 0, stride);
                    Marshal.Copy(row, 0, IntPtr.Add(data.Scan0, y * data.Stride), Math.Min(stride, data.Stride));
                }
                bmp.UnlockBits(data);
                return bmp;
            }
            return Image.FromHbitmap(hbmp);
        }

        // ---------- Значки рабочего стола (для «игры» Ято, пока пользователь отошёл) ----------
        public static List<object> DesktopIcons()
        {
            var list = new List<object>();
            IntPtr defView = IntPtr.Zero;
            IntPtr progman = N.FindWindow("Progman", null);
            if (progman != IntPtr.Zero) defView = N.FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (defView == IntPtr.Zero)
                N.EnumWindows((h, l) =>
                {
                    var d = N.FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null);
                    if (d != IntPtr.Zero) { defView = d; return false; }
                    return true;
                }, IntPtr.Zero);
            if (defView == IntPtr.Zero) return list;
            IntPtr lv = N.FindWindowEx(defView, IntPtr.Zero, "SysListView32", null);
            if (lv == IntPtr.Zero) return list;
            var el = AutomationElement.FromHandle(lv);
            var items = el.FindAll(TreeScope.Children, Condition.TrueCondition);
            foreach (AutomationElement it in items)
            {
                try
                {
                    var r = it.Current.BoundingRectangle;
                    if (r.IsEmpty || r.Width <= 0) continue;
                    list.Add(new Dictionary<string, object> { { "name", it.Current.Name }, { "x", r.X }, { "y", r.Y }, { "w", r.Width }, { "h", r.Height } });
                }
                catch { }
            }
            return list;
        }

        // ---------- Корзина ----------
        public static Dictionary<string, object> RecycleInfo()
        {
            var info = new N.SHQUERYRBINFO { cbSize = Marshal.SizeOf(typeof(N.SHQUERYRBINFO)) };
            N.SHQueryRecycleBin(null, ref info);
            return new Dictionary<string, object> { { "count", info.i64NumItems }, { "bytes", info.i64Size } };
        }

        /// <summary>Очистка корзины: Windows сам спросит подтверждение.</summary>
        public static void EmptyRecycle()
        {
            Program.Ui.Invoke(() => { N.SHEmptyRecycleBin(Program.Ui.Host.Handle, null, 0x2 /*NOPROGRESSUI*/); });
        }
    }
}

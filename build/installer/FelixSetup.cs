// Установщик «Феликса»: окно установки, распаковка программы в %LOCALAPPDATA%\Programs\Felix (без прав администратора),
// ярлыки в «Пуске» и на рабочем столе, запись в «Приложения и возможности», удаление.
// Программа лежит ZIP-архивом в конце этого же exe: [exe][zip][8 байт длина zip][метка].
//   метка «FELIXPK1» — установщик; «FELIXPT1» — переносная версия одним файлом: при первом запуске распаковывается
//   в %LOCALAPPDATA%\Felix\portable-<версия> и сразу запускается, без реестра и ярлыков; дальше запускается мгновенно.
// Собирается встроенным компилятором .NET Framework (C# 5): build\Build-Felix.ps1
//   FelixSetup.exe                         — окно установки
//   FelixSetup.exe /silent [/dir=путь] [/noshortcuts] [/norun] — тихая установка (для проверки и администраторов)
//   Uninstall.exe /uninstall [/silent] [/keepdata]                 — удаление
//   Felix-<версия>.exe [/silent] [/norun] [/dir=путь] [аргументы Феликса] — переносная версия
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

#if PORTABLE
[assembly: AssemblyTitle("Феликс — голосовой ассистент (переносная версия)")]
#else
[assembly: AssemblyTitle("Установка Феликса")]
#endif
[assembly: AssemblyProduct("Felix")]
[assembly: AssemblyCompany("Felix")]
[assembly: AssemblyCopyright("© 2026 Felix")]
[assembly: AssemblyVersion("1.2.0.0")]
[assembly: AssemblyFileVersion("1.2.0.0")]

namespace FelixSetup
{
    static class Product
    {
        public const string Name = "Феликс";
        public const string Version = "1.2.0";   // Build-Felix.ps1 сверяет с app\package.json
        public const string Exe = "Felix.exe";
        public const string RegKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Felix";
        public const string Magic = "FELIXPK1", PortableMagic = "FELIXPT1";
        public static string PortableDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Felix", "portable-" + Version); } }
        public static string DefaultDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Felix"); } }
        public static string StartMenuLink { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Феликс.lnk"); } }
        public static string DesktopLink { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Феликс.lnk"); } }
        public static string DataDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Felix"); } }
        public static readonly Color Teal = Color.FromArgb(31, 181, 163), Bg = Color.FromArgb(7, 17, 19), Panel = Color.FromArgb(14, 30, 33), Text = Color.FromArgb(232, 251, 248), Dim = Color.FromArgb(134, 175, 170);
    }

    static class Program
    {
        public static Dictionary<string, string> Args = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        [STAThread]
        static int Main(string[] argv)
        {
            foreach (string a in argv)
            {
                string s = a.TrimStart('/', '-');
                int i = s.IndexOf('=');
                if (i > 0) Args[s.Substring(0, i)] = s.Substring(i + 1).Trim('"'); else Args[s] = "";
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool silent = Args.ContainsKey("silent");
            try
            {
                if (Args.ContainsKey("uninstall")) return Uninstaller.Run(silent);
                if (Installer.SelfMagic() == Product.PortableMagic) return Portable.Run(argv, silent);
                if (silent)
                {
                    string dir = Args.ContainsKey("dir") ? Args["dir"] : Product.DefaultDir;
                    Installer.Install(dir, !Args.ContainsKey("noshortcuts"), !Args.ContainsKey("noshortcuts"), null);
                    if (!Args.ContainsKey("norun")) Installer.Launch(dir);
                    return 0;
                }
                Application.Run(new SetupForm());
                return 0;
            }
            catch (Exception e)
            {
                Log("ошибка: " + e);
                if (!silent) MessageBox.Show("Не получилось: " + e.Message, "Установка Феликса", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        public static void Log(string s)
        {
            try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "FelixSetup.log"), DateTime.Now.ToString("s") + " " + s + Environment.NewLine, Encoding.UTF8); } catch { }
        }
    }

    /// <summary>Поток, читающий кусок файла (архив в хвосте exe)</summary>
    class SubStream : Stream
    {
        readonly Stream _s; readonly long _start, _len; long _pos;
        public SubStream(Stream s, long start, long len) { _s = s; _start = start; _len = len; }
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return true; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { return _len; } }
        public override long Position { get { return _pos; } set { _pos = value; } }
        public override void Flush() { }
        public override int Read(byte[] buf, int off, int count)
        {
            long left = _len - _pos; if (left <= 0) return 0;
            if (count > left) count = (int)left;
            _s.Position = _start + _pos;
            int n = _s.Read(buf, off, count); _pos += n; return n;
        }
        public override long Seek(long o, SeekOrigin origin)
        {
            if (origin == SeekOrigin.Begin) _pos = o; else if (origin == SeekOrigin.Current) _pos += o; else _pos = _len + o;
            return _pos;
        }
        public override void SetLength(long v) { throw new NotSupportedException(); }
        public override void Write(byte[] b, int o, int c) { throw new NotSupportedException(); }
    }

    static class Installer
    {
        public static string SelfPath { get { return Assembly.GetExecutingAssembly().Location; } }

        /// <summary>Метка в конце exe: FELIXPK1 — установщик, FELIXPT1 — переносная версия, null — без архива (Uninstall.exe)</summary>
        public static string SelfMagic()
        {
            try
            {
                using (FileStream f = new FileStream(SelfPath, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    if (f.Length < 16) return null;
                    byte[] m = new byte[8]; f.Position = f.Length - 8; f.Read(m, 0, 8);
                    return Encoding.ASCII.GetString(m);
                }
            }
            catch { return null; }
        }

        /// <summary>Где в exe начинается архив и сколько в нём байт; -1, если архива нет (это Uninstall.exe)</summary>
        public static long PayloadOffset(Stream f, out long len)
        {
            len = 0;
            if (f.Length < 16) return -1;
            byte[] tail = new byte[16];
            f.Position = f.Length - 16; f.Read(tail, 0, 16);
            string magic = Encoding.ASCII.GetString(tail, 8, 8);
            if (magic != Product.Magic && magic != Product.PortableMagic) return -1;
            len = BitConverter.ToInt64(tail, 0);
            if (len <= 0 || len > f.Length - 16) return -1;
            return f.Length - 16 - len;
        }

        /// <summary>Распаковать архив из хвоста exe в папку; возвращает объём распакованного</summary>
        public static long Extract(FileStream f, long off, long len, string dir, Action<int, string> progress)
        {
            long total = 0;
            using (ZipArchive zip = new ZipArchive(new SubStream(f, off, len), ZipArchiveMode.Read))
            {
                int n = 0, count = zip.Entries.Count;
                string root = Path.GetFullPath(dir).TrimEnd('\\') + "\\";
                foreach (ZipArchiveEntry e in zip.Entries)
                {
                    n++;
                    // ZipFile .NET Framework пишет пути с «\», другие архиваторы — с «/»; пустые папки — имя с косой чертой в конце
                    string name = e.FullName.Replace('\\', '/');
                    string target = Path.GetFullPath(Path.Combine(dir, name.Replace('/', '\\')));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;   // защита от «../» в архиве
                    if (name.EndsWith("/") || e.Name.Length == 0) { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    for (int attempt = 0; ; attempt++)
                    {
                        try { e.ExtractToFile(target, true); break; }
                        catch (IOException) { if (attempt >= 5) throw; Thread.Sleep(600); }
                    }
                    total += e.Length;
                    if (progress != null && (n % 10 == 0 || n == count)) progress(n * 100 / count, e.Name);
                }
            }
            return total;
        }

        public static void CloseRunning(string dir)
        {
            string exe = Path.Combine(dir, Product.Exe);
            foreach (Process p in Process.GetProcessesByName("Felix"))
            {
                try
                {
                    if (!string.Equals(p.MainModule.FileName, exe, StringComparison.OrdinalIgnoreCase)) continue;
                    try { Process.Start(new ProcessStartInfo(exe, "--quit") { UseShellExecute = false, CreateNoWindow = true }); } catch { }
                    if (!p.WaitForExit(8000)) { p.Kill(); p.WaitForExit(3000); }
                }
                catch { }
            }
            foreach (string n in new[] { "FelixCore", "FelixInput", "piper" })
                foreach (Process p in Process.GetProcessesByName(n))
                    try { if (p.MainModule.FileName.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) p.Kill(); } catch { }
        }

        public static void Install(string dir, bool startMenu, bool desktop, Action<int, string> progress)
        {
            Program.Log("установка в " + dir);
            Directory.CreateDirectory(dir);
            CloseRunning(dir);
            long total = 0;
            using (FileStream f = new FileStream(SelfPath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                long len; long off = PayloadOffset(f, out len);
                if (off < 0) throw new Exception("в установщике нет программы (повреждённый файл)");
                total = Extract(f, off, len, dir, progress);
                // деинсталлятор — тот же exe без архива
                long stubLen = f.Length - 16 - len;
                f.Position = 0;
                using (FileStream u = new FileStream(Path.Combine(dir, "Uninstall.exe"), FileMode.Create))
                {
                    byte[] buf = new byte[1 << 16]; long left = stubLen;
                    while (left > 0) { int r = f.Read(buf, 0, (int)Math.Min(buf.Length, left)); if (r <= 0) break; u.Write(buf, 0, r); left -= r; }
                }
            }
            string exe = Path.Combine(dir, Product.Exe);
            if (startMenu) Shortcut(Product.StartMenuLink, exe, dir, "Феликс — голосовой ассистент");
            if (desktop) Shortcut(Product.DesktopLink, exe, dir, "Феликс — голосовой ассистент");
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(Product.RegKey))
            {
                k.SetValue("DisplayName", "Феликс — голосовой ассистент");
                k.SetValue("DisplayVersion", Product.Version);
                k.SetValue("Publisher", "Felix");
                k.SetValue("DisplayIcon", exe);
                k.SetValue("InstallLocation", dir);
                k.SetValue("UninstallString", "\"" + Path.Combine(dir, "Uninstall.exe") + "\" /uninstall");
                k.SetValue("QuietUninstallString", "\"" + Path.Combine(dir, "Uninstall.exe") + "\" /uninstall /silent");
                k.SetValue("EstimatedSize", (int)(total / 1024), RegistryValueKind.DWord);
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
            }
            Program.Log("установлено, " + (total >> 20) + " МБ");
        }

        public static void Shortcut(string lnk, string target, string workDir, string desc)
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(t);
            object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
            Type st = sc.GetType();
            st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
            st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { workDir });
            st.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { desc });
            st.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { target + ",0" });
            st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
        }

        public static void Launch(string dir)
        {
            // через explorer: Феликс не должен зависеть от процесса установщика
            try { Process.Start(new ProcessStartInfo("explorer.exe", "\"" + Path.Combine(dir, Product.Exe) + "\"") { UseShellExecute = false }); } catch { }
        }
    }

    static class Uninstaller
    {
        public static int Run(bool silent)
        {
            string self = Assembly.GetExecutingAssembly().Location;
            string dir = Program.Args.ContainsKey("dir") ? Program.Args["dir"] : Path.GetDirectoryName(self);
            // из папки программы себя не удалить — копируемся во временную папку и запускаемся оттуда
            if (!Program.Args.ContainsKey("dir"))
            {
                if (!silent && MessageBox.Show("Удалить Феликса с этого компьютера?", "Удаление Феликса", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 0;
                bool keep = Program.Args.ContainsKey("keepdata");
                if (!silent && !keep) keep = MessageBox.Show("Сохранить настройки и заметки Феликса на случай, если решите вернуть его?", "Удаление Феликса", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes;
                string tmp = Path.Combine(Path.GetTempPath(), "FelixUninstall.exe");
                File.Copy(self, tmp, true);
                Process.Start(new ProcessStartInfo(tmp, "/uninstall /dir=\"" + dir + "\"" + (silent ? " /silent" : "") + (keep ? " /keepdata" : "")) { UseShellExecute = false });
                return 0;
            }
            Thread.Sleep(800);
            Installer.CloseRunning(dir);
            foreach (string lnk in new[] { Product.StartMenuLink, Product.DesktopLink }) try { if (File.Exists(lnk)) File.Delete(lnk); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(Product.RegKey, false); } catch { }
            // автозапуск, который включает сама программа (Electron: имя значения — AppUserModelId)
            foreach (string run in new[] { @"Software\Microsoft\Windows\CurrentVersion\Run", @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" })
                try { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(run, true)) { if (k != null) { k.DeleteValue("Felix.Assistant", false); k.DeleteValue("Felix", false); } } } catch { }
            // папка программы — только наши файлы (на случай, если пользователь выбрал общую папку)
            if (File.Exists(Path.Combine(dir, Product.Exe)))
            {
                foreach (string sub in new[] { "resources", "locales", "native", "voice", "stt", "models", "sounds", "phone" }) try { Directory.Delete(Path.Combine(dir, sub), true); } catch { }
                foreach (string f in Directory.GetFiles(dir)) try { File.Delete(f); } catch { }
                try { if (Directory.GetFileSystemEntries(dir).Length == 0) Directory.Delete(dir); } catch { }
            }
            if (!Program.Args.ContainsKey("keepdata")) try { Directory.Delete(Product.DataDir, true); } catch { }
            if (!silent) RemoveFirewallRule();
            if (!silent) MessageBox.Show("Феликс удалён. Спасибо, что были вместе!", "Удаление Феликса", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        /// <summary>Правило брандмауэра «Felix Link» (если пользователь разрешал связь с телефоном) — удалить; Windows спросит подтверждение</summary>
        static void RemoveFirewallRule()
        {
            try
            {
                ProcessStartInfo q = new ProcessStartInfo("netsh", "advfirewall firewall show rule name=\"Felix Link\"") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
                using (Process p = Process.Start(q)) { p.StandardOutput.ReadToEnd(); p.WaitForExit(15000); if (p.ExitCode != 0) return; }
                ProcessStartInfo d = new ProcessStartInfo("netsh", "advfirewall firewall delete rule name=\"Felix Link\"") { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
                using (Process p = Process.Start(d)) p.WaitForExit(60000);
            }
            catch { }   // отказался в окне UAC — правило останется, оно касается только портов Феликса
        }
    }

    /// <summary>Переносная версия одним файлом: распаковать один раз и запустить</summary>
    static class Portable
    {
        const string Stamp = ".felix-portable";

        public static int Run(string[] argv, bool silent)
        {
            string dir = Program.Args.ContainsKey("dir") ? Program.Args["dir"] : Product.PortableDir;
            // аргументы, которые не наши, — самому Феликсу (например --quit)
            StringBuilder pass = new StringBuilder();
            foreach (string a in argv)
            {
                string s = a.TrimStart('/', '-'); int i = s.IndexOf('='); string k = i > 0 ? s.Substring(0, i) : s;
                if (k == "silent" || k == "norun" || k == "dir") continue;
                pass.Append(pass.Length > 0 ? " " : "").Append(a.IndexOf(' ') >= 0 ? "\"" + a + "\"" : a);
            }
            string stamp = PayloadStamp();
            string have = null;
            try { have = File.ReadAllText(Path.Combine(dir, Stamp)); } catch { }
            if (have != stamp || !File.Exists(Path.Combine(dir, Product.Exe)))
            {
                if (silent) { Unpack(dir, stamp, null); }
                else
                {
                    PortableForm f = new PortableForm(dir, stamp);
                    Application.Run(f);
                    if (!f.Done) return 1;
                }
            }
            if (!Program.Args.ContainsKey("norun"))
                Process.Start(new ProcessStartInfo(Path.Combine(dir, Product.Exe), pass.ToString()) { UseShellExecute = false, WorkingDirectory = dir });
            return 0;
        }

        /// <summary>Отпечаток архива: длина + SHA-1 последних 64 КБ (там оглавление zip с контрольными суммами всех файлов)</summary>
        static string PayloadStamp()
        {
            using (FileStream f = new FileStream(Installer.SelfPath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                long len; long off = Installer.PayloadOffset(f, out len);
                if (off < 0) throw new Exception("в файле нет программы (повреждённый файл)");
                int n = (int)Math.Min(len, 65536);
                byte[] b = new byte[n]; f.Position = off + len - n; f.Read(b, 0, n);
                using (System.Security.Cryptography.SHA1 sha = System.Security.Cryptography.SHA1.Create())
                    return Product.Version + ":" + len + ":" + BitConverter.ToString(sha.ComputeHash(b)).Replace("-", "");
            }
        }

        public static void Unpack(string dir, string stamp, Action<int, string> progress)
        {
            Program.Log("переносная версия: распаковка в " + dir);
            Directory.CreateDirectory(dir);
            Installer.CloseRunning(dir);
            try { File.Delete(Path.Combine(dir, Stamp)); } catch { }
            using (FileStream f = new FileStream(Installer.SelfPath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                long len; long off = Installer.PayloadOffset(f, out len);
                Installer.Extract(f, off, len, dir, progress);
            }
            File.WriteAllText(Path.Combine(dir, Stamp), stamp);
        }
    }

    /// <summary>Окошко первой распаковки переносной версии</summary>
    class PortableForm : Form
    {
        readonly string _dir, _stamp;
        readonly ProgressBar _bar = new ProgressBar();
        readonly Label _status = new Label();
        public bool Done;

        public PortableForm(string dir, string stamp)
        {
            _dir = dir; _stamp = stamp;
            Text = "Феликс"; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen; ClientSize = new Size(470, 196);
            BackColor = Product.Bg; ForeColor = Product.Text; Font = new Font("Segoe UI", 9.5f);
            try { Icon = Icon.ExtractAssociatedIcon(Installer.SelfPath); } catch { }
            Controls.Add(new Label { Text = "Феликс", Font = new Font("Segoe UI Semibold", 18f), AutoSize = true, Location = new Point(20, 14) });
            Controls.Add(new Label
            {
                Text = "Переносная версия: ничего не устанавливается. Первый запуск — распаковка файлов программы (один раз), потом Феликс открывается сразу.\r\nФеликс — свободная программа с открытым кодом (лицензия MIT, LICENSE.txt в папке программы).",
                ForeColor = Product.Dim, Location = new Point(22, 56), Size = new Size(430, 74)
            });
            _bar.SetBounds(22, 138, 426, 8); Controls.Add(_bar);
            _status.SetBounds(22, 152, 426, 34); _status.ForeColor = Product.Dim; _status.Text = "Распаковываю…"; Controls.Add(_status);
            Shown += delegate
            {
                Thread t = new Thread(delegate ()
                {
                    try
                    {
                        Portable.Unpack(_dir, _stamp, delegate (int pct, string name) { BeginInvoke(new Action(delegate { _bar.Value = Math.Min(100, pct); _status.Text = "Распаковываю: " + name; })); });
                        Done = true;
                        BeginInvoke(new Action(Close));
                    }
                    catch (Exception ex)
                    {
                        Program.Log("ошибка распаковки: " + ex);
                        BeginInvoke(new Action(delegate { MessageBox.Show(this, "Не получилось распаковать: " + ex.Message, "Феликс", MessageBoxButtons.OK, MessageBoxIcon.Error); Close(); }));
                    }
                });
                t.IsBackground = true; t.Start();
            };
        }
    }

    class SetupForm : Form
    {
        readonly TextBox _dir = new TextBox();
        readonly CheckBox _accept = new CheckBox(), _desk = new CheckBox(), _run = new CheckBox();
        readonly Button _go = new Button(), _browse = new Button();
        readonly ProgressBar _bar = new ProgressBar();
        readonly Label _status = new Label();
        readonly Panel _hero = new Panel();
        Image _portrait;

        public SetupForm()
        {
            Text = "Установка Феликса " + Product.Version;
            FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(760, 470);
            BackColor = Product.Bg; ForeColor = Product.Text;
            Font = new Font("Segoe UI", 9.5f);
            try { Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { }
            try { Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("portrait.png"); if (s != null) _portrait = Image.FromStream(s); } catch { }

            _hero.SetBounds(0, 0, 250, 470);
            _hero.Paint += PaintHero;
            Controls.Add(_hero);

            Label title = new Label { Text = "Феликс", Font = new Font("Segoe UI Semibold", 22f), ForeColor = Product.Text, AutoSize = true, Location = new Point(275, 20) };
            Label sub = new Label { Text = "Голосовой 3D-ассистент для рабочего стола Windows", ForeColor = Product.Dim, AutoSize = true, Location = new Point(279, 64) };
            Controls.Add(title); Controls.Add(sub);

            TextBox lic = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BorderStyle = BorderStyle.FixedSingle, BackColor = Product.Panel, ForeColor = Product.Text, Location = new Point(279, 96), Size = new Size(458, 170) };
            lic.Text = License();
            lic.TabStop = false;
            Controls.Add(lic);
            Shown += delegate { lic.SelectionStart = 0; lic.SelectionLength = 0; _accept.Focus(); };

            _accept.Text = "Я прочитал(а) лицензию (MIT)"; _accept.AutoSize = true; _accept.Location = new Point(279, 274); _accept.ForeColor = Product.Text;
            _accept.CheckedChanged += delegate { _go.Enabled = _accept.Checked; };
            Controls.Add(_accept);

            Label dl = new Label { Text = "Папка установки (права администратора не нужны):", ForeColor = Product.Dim, AutoSize = true, Location = new Point(279, 304) };
            Controls.Add(dl);
            _dir.Text = Product.DefaultDir; _dir.Location = new Point(279, 326); _dir.Size = new Size(368, 26); _dir.BackColor = Product.Panel; _dir.ForeColor = Product.Text; _dir.BorderStyle = BorderStyle.FixedSingle;
            Controls.Add(_dir);
            _browse.Text = "Обзор…"; _browse.Location = new Point(655, 324); _browse.Size = new Size(82, 28); Flat(_browse, false);
            _browse.Click += delegate
            {
                using (FolderBrowserDialog d = new FolderBrowserDialog { Description = "Куда установить Феликса", SelectedPath = _dir.Text })
                    if (d.ShowDialog(this) == DialogResult.OK) _dir.Text = Path.Combine(d.SelectedPath, "Felix");
            };
            Controls.Add(_browse);

            _desk.Text = "Ярлык на рабочем столе"; _desk.Checked = true; _desk.AutoSize = true; _desk.Location = new Point(279, 362); _desk.ForeColor = Product.Text;
            _run.Text = "Запустить Феликса после установки"; _run.Checked = true; _run.AutoSize = true; _run.Location = new Point(470, 362); _run.ForeColor = Product.Text;
            Controls.Add(_desk); Controls.Add(_run);

            _bar.Location = new Point(279, 398); _bar.Size = new Size(458, 8); _bar.Visible = false;
            _status.Location = new Point(279, 412); _status.Size = new Size(300, 40); _status.ForeColor = Product.Dim;
            Controls.Add(_bar); Controls.Add(_status);

            _go.Text = "Установить"; _go.Location = new Point(607, 420); _go.Size = new Size(130, 36); _go.Enabled = false; Flat(_go, true);
            _go.Click += delegate { StartInstall(); };
            Controls.Add(_go);
            AcceptButton = _go;
        }

        static void Flat(Button b, bool primary)
        {
            b.FlatStyle = FlatStyle.Flat; b.FlatAppearance.BorderSize = primary ? 0 : 1;
            b.FlatAppearance.BorderColor = Color.FromArgb(60, 90, 88);
            b.BackColor = primary ? Product.Teal : Product.Panel;
            b.ForeColor = primary ? Color.FromArgb(4, 32, 29) : Product.Text;
            if (primary) b.Font = new Font("Segoe UI Semibold", 10f);
        }

        void PaintHero(object sender, PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            using (System.Drawing.Drawing2D.LinearGradientBrush br = new System.Drawing.Drawing2D.LinearGradientBrush(_hero.ClientRectangle, Color.FromArgb(18, 70, 68), Color.FromArgb(7, 17, 19), 70f))
                g.FillRectangle(br, _hero.ClientRectangle);
            if (_portrait != null)
            {
                float h = _hero.Height * 0.95f, w = _portrait.Width * h / _portrait.Height;
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                g.DrawImage(_portrait, (_hero.Width - w) / 2, _hero.Height - h, w, h);
            }
        }

        static string License()
        {
            try
            {
                Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("license.txt");
                if (s != null) using (StreamReader r = new StreamReader(s, Encoding.UTF8)) return r.ReadToEnd().Replace("\r\n", "\n").Replace("\n", "\r\n");
            }
            catch { }
            return "Лицензия MIT — в файле LICENSE.txt в папке программы. Исходный код: github.com/YatagarasuTS/felix-assistant";
        }

        void StartInstall()
        {
            string dir = _dir.Text.Trim();
            if (dir.Length < 4) { MessageBox.Show("Укажите папку установки.", Text); return; }
            _go.Enabled = _browse.Enabled = _dir.Enabled = _accept.Enabled = false;
            _bar.Visible = true;
            bool desk = _desk.Checked, run = _run.Checked;
            Thread t = new Thread(delegate ()
            {
                try
                {
                    Installer.Install(dir, true, desk, delegate (int pct, string name) { BeginInvoke(new Action(delegate { _bar.Value = Math.Min(100, pct); _status.Text = "Копирую: " + name; })); });
                    BeginInvoke(new Action(delegate
                    {
                        _status.Text = "Готово! Феликс установлен.";
                        if (run) Installer.Launch(dir);
                        MessageBox.Show(this, run ? "Феликс установлен и сейчас появится на рабочем столе.\r\nПозовите его: «Феликс, привет!» или Win + Y." : "Феликс установлен. Запустите его из меню «Пуск».", "Установка Феликса", MessageBoxButtons.OK, MessageBoxIcon.Information);
                        Close();
                    }));
                }
                catch (Exception ex)
                {
                    Program.Log("ошибка установки: " + ex);
                    BeginInvoke(new Action(delegate
                    {
                        _status.Text = "Ошибка: " + ex.Message;
                        MessageBox.Show(this, "Не получилось установить: " + ex.Message, "Установка Феликса", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        _go.Enabled = _browse.Enabled = _dir.Enabled = _accept.Enabled = true;
                    }));
                }
            });
            t.IsBackground = true;
            t.Start();
        }
    }
}

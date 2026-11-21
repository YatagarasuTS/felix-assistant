// FelixCore — системный помощник ассистента Феликс.
// Общается с приложением (Electron) строками JSON через stdin/stdout:
//   запрос  {"id":1,"cmd":"windows", ...}
//   ответ   {"id":1,"ok":true,"data":...}
//   событие {"ev":"fg", ...}
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace Felix
{
    static class Program
    {
        public static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 64 };
        static StreamWriter _out;
        static readonly object _lock = new object();
        public static UiThread Ui;

        public static void Send(object o)
        {
            string s = Json.Serialize(o);
            lock (_lock)
            {
                try { _out.Write(s); _out.Write('\n'); _out.Flush(); }
                catch { Environment.Exit(0); }
            }
        }

        public static void Event(string ev, Dictionary<string, object> data = null)
        {
            data = data ?? new Dictionary<string, object>();
            data["ev"] = ev;
            Send(data);
        }

        public static void Log(string msg)
        {
            try
            {
                string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Felix", "logs");
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "felixcore.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + msg + Environment.NewLine);
            }
            catch { }
        }

        [STAThread]
        static int Main(string[] args)
        {
            AppDomain.CurrentDomain.UnhandledException += (s, e) => Log("unhandled: " + e.ExceptionObject);

            _out = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = false };
            var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            Ui = new UiThread();
            Ui.Start();
            Event("ready", new Dictionary<string, object> { { "version", "1.0.0" }, { "pid", System.Diagnostics.Process.GetCurrentProcess().Id } });

            string line;
            while ((line = input.ReadLine()) != null)
            {
                string l = line;
                if (l.Length == 0) continue;
                ThreadPool.QueueUserWorkItem(_ => Handle(l));
            }
            // оболочка закрылась — убираем за собой (панель задач, резерв экрана)
            Ui.Shutdown();
            Stt.Stop();
            return 0;
        }

        static void Handle(string line)
        {
            object id = null;
            try
            {
                var req = Json.Deserialize<Dictionary<string, object>>(line);
                req.TryGetValue("id", out id);
                string cmd = req.TryGetValue("cmd", out var c) ? c as string : "";
                object res = Commands.Run(cmd, new Args(req));
                if (id != null) Send(new Dictionary<string, object> { { "id", id }, { "ok", true }, { "data", res } });
            }
            catch (Exception e)
            {
                Log("cmd error: " + e);
                if (id != null) Send(new Dictionary<string, object> { { "id", id }, { "ok", false }, { "error", e.Message } });
            }
        }
    }

    /// <summary>Удобный доступ к полям запроса.</summary>
    class Args
    {
        readonly Dictionary<string, object> _d;
        public Args(Dictionary<string, object> d) { _d = d; }
        public bool Has(string k) => _d.ContainsKey(k) && _d[k] != null;
        public string S(string k, string def = null) => Has(k) ? Convert.ToString(_d[k], System.Globalization.CultureInfo.InvariantCulture) : def;
        public int I(string k, int def = 0) => Has(k) ? Convert.ToInt32(_d[k], System.Globalization.CultureInfo.InvariantCulture) : def;
        public long L(string k, long def = 0) => Has(k) ? Convert.ToInt64(_d[k], System.Globalization.CultureInfo.InvariantCulture) : def;
        public double D(string k, double def = 0) => Has(k) ? Convert.ToDouble(_d[k], System.Globalization.CultureInfo.InvariantCulture) : def;
        public bool B(string k, bool def = false) => Has(k) ? Convert.ToBoolean(_d[k]) : def;
        public IntPtr H(string k) => new IntPtr(L(k));
        public List<string> List(string k)
        {
            var r = new List<string>();
            if (Has(k) && _d[k] is System.Collections.IEnumerable e && !(_d[k] is string))
                foreach (var x in e) r.Add(Convert.ToString(x));
            return r;
        }
    }
}

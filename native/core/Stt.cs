using System;
using System.Collections.Generic;
using System.Threading;
using NAudio.Wave;
using Vosk;

namespace Felix
{
    /// <summary>Офлайн-распознавание речи (Vosk, русская модель) с микрофона.</summary>
    static class Stt
    {
        static Model _model;
        static VoskRecognizer _rec;
        static WaveInEvent _wave;
        static string _modelPath;
        static int _device;
        static volatile bool _running, _paused;
        static string _lastPartial = "";
        static DateTime _lastLevel = DateTime.MinValue;
        static readonly object _lock = new object();

        public static Dictionary<string, object> Start(string modelPath, int device)
        {
            lock (_lock)
            {
                if (_model == null || _modelPath != modelPath)
                {
                    Vosk.Vosk.SetLogLevel(-1);
                    _model = new Model(modelPath);
                    _modelPath = modelPath;
                }
                _device = device;
                _running = true;
                _paused = false;
                OpenMic();
            }
            return Status();
        }

        static void OpenMic()
        {
            CloseMic();
            if (WaveInEvent.DeviceCount == 0) { Program.Event("stt", new Dictionary<string, object> { { "error", "nomic" } }); RetryLater(); return; }
            _rec = new VoskRecognizer(_model, 16000f);
            _wave = new WaveInEvent { DeviceNumber = Math.Min(_device, WaveInEvent.DeviceCount - 1), WaveFormat = new WaveFormat(16000, 16, 1), BufferMilliseconds = 100, NumberOfBuffers = 4 };
            _wave.DataAvailable += OnData;
            _wave.RecordingStopped += (s, e) =>
            {
                if (_running) { Program.Log("mic stopped: " + e.Exception?.Message); RetryLater(); }
            };
            _wave.StartRecording();
            Program.Event("stt", new Dictionary<string, object> { { "state", "listening" } });
        }

        static void RetryLater()
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                Thread.Sleep(3000);
                lock (_lock) { if (_running) { try { OpenMic(); } catch (Exception e) { Program.Log("mic retry: " + e.Message); RetryLater(); } } }
            });
        }

        static void CloseMic()
        {
            try { if (_wave != null) { _wave.DataAvailable -= OnData; _wave.StopRecording(); _wave.Dispose(); } } catch { }
            _wave = null;
            try { _rec?.Dispose(); } catch { }
            _rec = null;
        }

        static void OnData(object sender, WaveInEventArgs e)
        {
            if (_paused || _rec == null) return;
            // уровень сигнала для анимации «слушаю»
            if ((DateTime.UtcNow - _lastLevel).TotalMilliseconds > 90)
            {
                _lastLevel = DateTime.UtcNow;
                double sum = 0; int n = e.BytesRecorded / 2;
                for (int i = 0; i < e.BytesRecorded - 1; i += 2) { short v = BitConverter.ToInt16(e.Buffer, i); sum += v * (double)v; }
                double rms = n > 0 ? Math.Sqrt(sum / n) / 32768.0 : 0;
                Program.Event("level", new Dictionary<string, object> { { "v", Math.Round(Math.Min(1, rms * 4), 3) } });
            }
            try
            {
                if (_rec.AcceptWaveform(e.Buffer, e.BytesRecorded))
                {
                    string text = Field(_rec.Result(), "text");
                    _lastPartial = "";
                    if (!string.IsNullOrWhiteSpace(text))
                        Program.Event("stt", new Dictionary<string, object> { { "final", true }, { "text", text } });
                }
                else
                {
                    string p = Field(_rec.PartialResult(), "partial");
                    if (p != _lastPartial)
                    {
                        _lastPartial = p;
                        if (!string.IsNullOrWhiteSpace(p)) Program.Event("stt", new Dictionary<string, object> { { "final", false }, { "text", p } });
                    }
                }
            }
            catch (Exception ex) { Program.Log("vosk: " + ex.Message); }
        }

        static string Field(string json, string name)
        {
            try
            {
                var d = Program.Json.Deserialize<Dictionary<string, object>>(json);
                return d != null && d.TryGetValue(name, out var v) ? (v as string ?? "") : "";
            }
            catch { return ""; }
        }

        /// <summary>Распознать WAV-файл (16 кГц, моно) — для проверки словаря и фразы-обращения.</summary>
        public static string FromFile(string modelPath, string wav)
        {
            Vosk.Vosk.SetLogLevel(-1);
            var model = _model != null && _modelPath == modelPath ? _model : new Model(modelPath);
            using (var r = new WaveFileReader(wav))
            using (var rec = new VoskRecognizer(model, r.WaveFormat.SampleRate))
            {
                var sb = new System.Text.StringBuilder();
                var buf = new byte[8000];
                int n;
                while ((n = r.Read(buf, 0, buf.Length)) > 0)
                    if (rec.AcceptWaveform(buf, n)) sb.Append(Field(rec.Result(), "text")).Append(' ');
                sb.Append(Field(rec.FinalResult(), "text"));
                return sb.ToString().Trim();
            }
        }

        public static void Pause(bool p)
        {
            _paused = p;
            if (!p) { try { _rec?.Reset(); } catch { } }
        }

        public static void Stop()
        {
            lock (_lock) { _running = false; CloseMic(); }
        }

        public static Dictionary<string, object> Status()
        {
            var devs = new List<object>();
            for (int i = 0; i < WaveInEvent.DeviceCount; i++) { try { devs.Add(WaveInEvent.GetCapabilities(i).ProductName); } catch { } }
            return new Dictionary<string, object> { { "running", _running }, { "paused", _paused }, { "devices", devs } };
        }
    }
}

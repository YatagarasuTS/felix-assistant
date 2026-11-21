using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Felix
{
    /// <summary>Громкость системы через Core Audio.</summary>
    static class Audio
    {
        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }

        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceEnumerator
        {
            [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
            [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        }

        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDevice
        {
            [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        }

        [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioEndpointVolume
        {
            [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
            [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
            [PreserveSig] int GetChannelCount(out uint count);
            [PreserveSig] int SetMasterVolumeLevel(float levelDB, ref Guid ctx);
            [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
            [PreserveSig] int GetMasterVolumeLevel(out float levelDB);
            [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
            [PreserveSig] int SetChannelVolumeLevel(uint ch, float levelDB, ref Guid ctx);
            [PreserveSig] int SetChannelVolumeLevelScalar(uint ch, float level, ref Guid ctx);
            [PreserveSig] int GetChannelVolumeLevel(uint ch, out float levelDB);
            [PreserveSig] int GetChannelVolumeLevelScalar(uint ch, out float level);
            [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
            [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
        }

        static IAudioEndpointVolume Endpoint()
        {
            var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
            Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0 /*eRender*/, 1 /*eMultimedia*/, out IMMDevice dev));
            Guid iid = typeof(IAudioEndpointVolume).GUID;
            Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23 /*CLSCTX_ALL*/, IntPtr.Zero, out object o));
            return (IAudioEndpointVolume)o;
        }

        /// <summary>Есть ли устройство вывода звука (в ВМ и на ПК без колонок его может не быть).</summary>
        static bool HasDevice()
        {
            try
            {
                var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
                return en.GetDefaultAudioEndpoint(0, 1, out IMMDevice _) == 0;
            }
            catch { return false; }
        }

        public static Dictionary<string, object> Get()
        {
            if (!HasDevice()) return new Dictionary<string, object> { { "level", 0 }, { "muted", true }, { "none", true } };
            var ep = Endpoint();
            ep.GetMasterVolumeLevelScalar(out float lv);
            ep.GetMute(out bool m);
            return new Dictionary<string, object> { { "level", Math.Round(lv * 100) }, { "muted", m } };
        }

        public static Dictionary<string, object> Set(double? level, bool? mute, double? delta)
        {
            if (!HasDevice()) return Get();
            var ep = Endpoint();
            Guid ctx = Guid.Empty;
            ep.GetMasterVolumeLevelScalar(out float cur);
            if (delta.HasValue) level = cur * 100 + delta.Value;
            if (level.HasValue)
            {
                float v = (float)Math.Max(0, Math.Min(100, level.Value)) / 100f;
                ep.SetMasterVolumeLevelScalar(v, ref ctx);
                if (v > 0) ep.SetMute(false, ref ctx);
            }
            if (mute.HasValue) ep.SetMute(mute.Value, ref ctx);
            return Get();
        }
    }
}

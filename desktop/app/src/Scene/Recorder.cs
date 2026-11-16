using System.Diagnostics;
using Godot;

namespace Plano3D.App.Scene;

/// <summary>
/// Graba lo que se ve: un JPG por cuadro (guardado en otro hilo) a 30 cuadros por segundo y,
/// al terminar, ffmpeg los une en un mp4 H.264. Mientras graba, el motor se fija a 30 FPS
/// para que el video dure lo mismo que el recorrido.
/// </summary>
public sealed class Recorder
{
    public const int Fps = 30;
    private readonly string _dir;
    private readonly List<Task> _writes = [];
    private readonly int _previousMaxFps;
    public int Frames { get; private set; }

    public Recorder(string dir)
    {
        _dir = dir;
        System.IO.Directory.CreateDirectory(dir);
        _previousMaxFps = Engine.MaxFps;
        Engine.MaxFps = Fps;
    }

    public void Capture(Viewport viewport)
    {
        var img = viewport.GetTexture().GetImage();
        var path = System.IO.Path.Combine(_dir, $"f{Frames++:00000}.jpg");
        _writes.Add(Task.Run(() => img.SaveJpg(path, 0.92f)));
        if (_writes.Count > 64) _writes.RemoveAll(t => t.IsCompleted);
    }

    /// <summary>Ruta de ffmpeg (en el PATH o junto a la app), o null.</summary>
    public static string? FindFfmpeg()
    {
        var local = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(OS.GetExecutablePath()) ?? "", "ffmpeg.exe");
        if (System.IO.File.Exists(local)) return local;
        foreach (var dir in (System.Environment.GetEnvironmentVariable("PATH") ?? "").Split(System.IO.Path.PathSeparator))
        {
            var candidate = System.IO.Path.Combine(dir.Trim(), "ffmpeg.exe");
            if (System.IO.File.Exists(candidate)) return candidate;
        }
        return null;
    }

    public async Task<(bool Ok, string Message)> FinishAsync(string output)
    {
        Engine.MaxFps = _previousMaxFps;
        await Task.WhenAll(_writes);
        if (Frames < 2) return (false, "La grabación quedó vacía.");
        var ffmpeg = FindFfmpeg();
        if (ffmpeg is null) return (false, $"Falta ffmpeg para armar el video; los cuadros quedaron en {_dir}");
        System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(output)!);
        var psi = new ProcessStartInfo(ffmpeg)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
        };
        foreach (var a in new[] { "-y", "-loglevel", "error", "-framerate", $"{Fps}", "-i", System.IO.Path.Combine(_dir, "f%05d.jpg"),
                     "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", output })
            psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        var err = await p.StandardError.ReadToEndAsync();
        await p.WaitForExitAsync();
        if (p.ExitCode != 0) return (false, $"ffmpeg falló: {err.Trim()}");
        try { System.IO.Directory.Delete(_dir, true); } catch (System.IO.IOException) { }
        return (true, output);
    }
}

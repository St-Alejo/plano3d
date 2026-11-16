using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Plano3D.Infrastructure.Blender;

/// <summary>Calidad del render (la del script: muestras y resolución).</summary>
public enum RenderQuality { Borrador, Final, Alta }

/// <summary>Hora de la escena: el sol del estudio solar, sol rasante o solo las luces de la casa.</summary>
public enum RenderHour { Dia, Atardecer, Noche }

/// <param name="OrbitSeconds">si viene, en vez de fotos se graba una vuelta a la casa de esa duración (mp4)</param>
public sealed record RenderRequest(string PackageDir, RenderQuality Quality, RenderHour Hour, string? Camera = null, double? OrbitSeconds = null)
{
    public static string Arg(RenderQuality q) => q.ToString().ToLowerInvariant();
    public static string Arg(RenderHour h) => h.ToString().ToLowerInvariant();
}

/// <summary>Lo que se sabe del render en curso.</summary>
public sealed record RenderProgress(string Stage, int Camera, int Cameras, string CameraName, int Sample, int Samples)
{
    /// <summary>0…1 sobre todas las cámaras (la preparación de la escena cuenta como 0).</summary>
    public double Fraction => Cameras <= 0 ? 0 : Math.Clamp((Camera - 1 + (Samples > 0 ? (double)Sample / Samples : 0)) / Cameras, 0, 1);
}

/// <summary>Un renglón de la salida de Blender ya interpretado.</summary>
public abstract record BlenderEvent
{
    public sealed record Ready(string Summary) : BlenderEvent;
    public sealed record CameraStart(int Index, int Count, string Name) : BlenderEvent;
    public sealed record Sample(int Done, int Total) : BlenderEvent;
    public sealed record Saved(string Path) : BlenderEvent;
    public sealed record Failure(string Message) : BlenderEvent;
}

/// <summary>Lee la salida de <c>blender -b</c> con <c>arquitectura.py</c> (y la de Cycles).</summary>
public static partial class BlenderOutput
{
    [GeneratedRegex(@"^camara:\s*(\d+)/(\d+)\s+(.+)$")]
    private static partial Regex CameraLine();

    // Cycles: "... | Sample 16/64" (Blender 3.x … 5.x); también "Rendered 16/64 Tiles"
    [GeneratedRegex(@"Sample (\d+)/(\d+)")]
    private static partial Regex SampleLine();

    public static BlenderEvent? Parse(string line)
    {
        var l = line.Trim();
        if (l.Length == 0) return null;
        if (l.StartsWith("render:", StringComparison.Ordinal)) return new BlenderEvent.Saved(l[7..].Trim());
        if (l.StartsWith("Plano 3D: escena lista", StringComparison.Ordinal)) return new BlenderEvent.Ready(l);
        if (CameraLine().Match(l) is { Success: true } c)
            return new BlenderEvent.CameraStart(Int(c.Groups[1].Value), Int(c.Groups[2].Value), c.Groups[3].Value.Trim());
        if (SampleLine().Match(l) is { Success: true } s) return new BlenderEvent.Sample(Int(s.Groups[1].Value), Int(s.Groups[2].Value));
        if (l.StartsWith("Error", StringComparison.Ordinal) || l.StartsWith("Traceback", StringComparison.Ordinal)
            || l.Contains("FileNotFoundError", StringComparison.Ordinal))
            return new BlenderEvent.Failure(l);
        return null;
    }

    private static int Int(string s) => int.Parse(s, CultureInfo.InvariantCulture);
}

/// <summary>Dónde está Blender: lo configurado, la variable PLANO3D_BLENDER, Archivos de programa o el PATH.</summary>
public static class BlenderLocator
{
    public static string? Find(string? configured = null, Func<string, string?>? env = null, IEnumerable<string>? programFiles = null)
    {
        env ??= Environment.GetEnvironmentVariable;
        foreach (var candidate in new[] { configured, env("PLANO3D_BLENDER") })
            if (!string.IsNullOrWhiteSpace(candidate) && File.Exists(candidate)) return candidate;

        programFiles ??= new[] { env("ProgramFiles"), env("ProgramW6432"), env("LOCALAPPDATA") is { } la ? Path.Combine(la, "Programs") : null }
            .Where(p => !string.IsNullOrEmpty(p))!;
        var installed = programFiles
            .Select(pf => Path.Combine(pf, "Blender Foundation"))
            .Where(Directory.Exists)
            .SelectMany(Directory.EnumerateDirectories)
            .Select(dir => Path.Combine(dir, "blender.exe"))
            .Where(File.Exists)
            .OrderByDescending(VersionOf)
            .FirstOrDefault();
        if (installed is not null) return installed;

        foreach (var dir in (env("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            var exe = Path.Combine(dir.Trim(), OperatingSystem.IsWindows() ? "blender.exe" : "blender");
            if (File.Exists(exe)) return exe;
        }
        return null;
    }

    /// <summary>"…\Blender 5.2\blender.exe" → 5.2 (para quedarse con la más nueva).</summary>
    public static Version VersionOf(string exe)
    {
        var folder = Path.GetFileName(Path.GetDirectoryName(exe)) ?? "";
        var m = Regex.Match(folder, @"(\d+)\.(\d+)");
        return m.Success ? new Version(int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture), int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture)) : new Version(0, 0);
    }
}

/// <summary>
/// Corre Blender sin interfaz con el script del paquete: arma la escena (materiales Cycles,
/// cielo, luces, cámaras), la guarda como casa.blend y renderiza en la GPU. Avisa el avance y
/// cada imagen terminada; cancelar mata el proceso.
/// </summary>
public sealed class BlenderRunner(string blenderExe)
{
    public string Exe { get; } = blenderExe;

    public static IReadOnlyList<string> Arguments(RenderRequest r)
    {
        var args = new List<string>
        {
            "-b", "--factory-startup", "-P", Path.Combine(r.PackageDir, "blender", "arquitectura.py"), "--",
            Path.Combine(r.PackageDir, "casa.glb"), "--calidad", RenderRequest.Arg(r.Quality), "--hora", RenderRequest.Arg(r.Hour),
        };
        if (r.OrbitSeconds is { } secs)
            args.AddRange(["--vuelta", secs.ToString("0.#", CultureInfo.InvariantCulture)]);
        else
        {
            args.Add("--render");
            if (!string.IsNullOrWhiteSpace(r.Camera)) args.AddRange(["--camara", r.Camera]);
        }
        return args;
    }

    /// <summary>Las imágenes que salieron (rutas PNG en renders/ del paquete). <paramref name="onImage"/> recibe cada una con su cámara.</summary>
    public async Task<IReadOnlyList<string>> RenderAsync(
        RenderRequest request,
        IProgress<RenderProgress>? progress = null,
        Action<string, string>? onImage = null,
        CancellationToken ct = default)
    {
        var psi = new ProcessStartInfo(Exe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = request.PackageDir,
        };
        foreach (var a in Arguments(request)) psi.ArgumentList.Add(a);
        psi.Environment["PYTHONUNBUFFERED"] = "1";

        using var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
        var images = new List<string>();
        var errors = new List<string>();
        var state = new RenderProgress("Preparando la escena", 0, 0, "", 0, 0);
        var gate = new object();

        void OnLine(string? line)
        {
            if (line is null) return;
            var ev = BlenderOutput.Parse(line);
            lock (gate)
            {
                switch (ev)
                {
                    case BlenderEvent.Ready:
                        state = state with { Stage = "Escena lista" };
                        break;
                    case BlenderEvent.CameraStart c:
                        state = new RenderProgress("Renderizando", c.Index, c.Count, c.Name, 0, 0);
                        break;
                    case BlenderEvent.Sample s:
                        state = state with { Sample = s.Done, Samples = s.Total };
                        break;
                    case BlenderEvent.Saved saved:
                        // el script imprime la ruta relativa a la carpeta del paquete
                        var path = Path.GetFullPath(saved.Path, request.PackageDir);
                        images.Add(path);
                        onImage?.Invoke(path, state.CameraName);
                        break;
                    case BlenderEvent.Failure f:
                        errors.Add(f.Message);
                        break;
                    default:
                        return;
                }
                progress?.Report(state);
            }
        }

        p.OutputDataReceived += (_, e) => OnLine(e.Data);
        p.ErrorDataReceived += (_, e) => OnLine(e.Data);
        if (!p.Start()) throw new InvalidOperationException("No se pudo abrir Blender");
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        progress?.Report(state);
        try
        {
            await p.WaitForExitAsync(ct);
        }
        catch (OperationCanceledException)
        {
            try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            throw;
        }
        p.WaitForExit(); // vacía las colas de salida
        if (p.ExitCode != 0 && images.Count == 0)
            throw new BlenderException(errors.Count > 0 ? errors[^1] : $"Blender terminó con código {p.ExitCode}");
        return images;
    }
}

public sealed class BlenderException(string message) : Exception(message);

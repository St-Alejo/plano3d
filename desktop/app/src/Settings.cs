using Godot;

namespace Plano3D.App;

/// <summary>
/// Cómo se abrió la app: argumentos tras <c>--</c> (desarrollo y pruebas) o un enlace
/// <c>plano3d://open?project=ID&amp;code=XYZ</c> (botón «Abrir en escritorio» de la web).
/// </summary>
public sealed record LaunchOptions(string? Api, string? Smoke, string? Project, string? Code)
{
    public static LaunchOptions Parse(IEnumerable<string> args)
    {
        string? api = null, smoke = null, project = null, code = null;
        var list = args.ToList();
        for (var i = 0; i < list.Count; i++)
        {
            var a = list[i];
            string? Next() => i + 1 < list.Count ? list[++i] : null;
            switch (a)
            {
                case "--api": api = Next(); break;
                case "--smoke": smoke = Next(); break;
                case "--project": project = Next(); break;
                case "--code": code = Next(); break;
                default:
                    if (a.StartsWith("plano3d://", StringComparison.OrdinalIgnoreCase) && Uri.TryCreate(a, UriKind.Absolute, out var uri))
                    {
                        var q = System.Web.HttpUtility.ParseQueryString(uri.Query);
                        project = q["project"] ?? project;
                        code = q["code"] ?? code;
                    }
                    break;
            }
        }
        return new LaunchOptions(api, smoke, project, code);
    }
}

/// <summary>Ajustes guardados en <c>user://ajustes.cfg</c> (%APPDATA%\Godot\app_userdata\Plano 3D).</summary>
public sealed class AppSettings
{
    /// <summary>La API de la demo en Azure.</summary>
    public const string DefaultApi = "https://ca-plano3d-api.bravefield-201b313a.brazilsouth.azurecontainerapps.io";
    private const string Path = "user://ajustes.cfg";

    public string ApiUrl { get; set; } = DefaultApi;

    public static AppSettings Load(LaunchOptions launch)
    {
        var s = new AppSettings();
        var cfg = new ConfigFile();
        if (cfg.Load(Path) == Error.Ok) s.ApiUrl = (string)cfg.GetValue("servidor", "api", DefaultApi);
        var env = System.Environment.GetEnvironmentVariable("PLANO3D_API");
        if (!string.IsNullOrWhiteSpace(env)) s.ApiUrl = env;
        if (!string.IsNullOrWhiteSpace(launch.Api)) s.ApiUrl = launch.Api;
        return s;
    }

    public void Save()
    {
        var cfg = new ConfigFile();
        cfg.SetValue("servidor", "api", ApiUrl);
        cfg.Save(Path);
    }
}

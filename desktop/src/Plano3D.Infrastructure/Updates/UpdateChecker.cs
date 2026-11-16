using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Plano3D.Infrastructure.Updates;

/// <summary>La versión de esta compilación (la pone build-release.ps1 en el instalador).</summary>
public static class AppVersion
{
    public const string Current = "1.0.0";
    public const string DownloadPage = "https://lively-island-09e124b1e.5.azurestaticapps.net/escritorio";
}

/// <summary>Hay una versión publicada más nueva que la instalada.</summary>
public sealed record UpdateInfo(Version Latest, string Url);

/// <summary>
/// Pregunta a GitHub por el último release del instalador. Sin conexión, sin release o con
/// cualquier error responde null: avisar de una actualización nunca debe estorbar.
/// </summary>
public sealed partial class UpdateChecker(HttpClient http, string repo = "St-Alejo/plano3d-frontend")
{
    [GeneratedRegex(@"(\d+)\.(\d+)(?:\.(\d+))?")]
    private static partial Regex VersionPattern();

    /// <summary>"v1.2.0", "1.2" o "escritorio-v1.3.1" → la versión; null si el tag no trae una.</summary>
    public static Version? ParseTag(string? tag)
    {
        if (tag is null || VersionPattern().Match(tag) is not { Success: true } m) return null;
        int N(Group g) => g.Success ? int.Parse(g.Value, CultureInfo.InvariantCulture) : 0;
        return new Version(N(m.Groups[1]), N(m.Groups[2]), N(m.Groups[3]));
    }

    public async Task<UpdateInfo?> CheckAsync(Version current, CancellationToken ct = default)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, $"https://api.github.com/repos/{repo}/releases/latest");
            req.Headers.UserAgent.Add(new ProductInfoHeaderValue("Plano3D-Escritorio", AppVersion.Current));
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
            using var res = await http.SendAsync(req, ct);
            if (!res.IsSuccessStatusCode) return null;
            var json = JsonNode.Parse(await res.Content.ReadAsStringAsync(ct)) as JsonObject;
            var latest = ParseTag((string?)json?["tag_name"]);
            if (latest is null || latest <= current) return null;
            return new UpdateInfo(latest, AppVersion.DownloadPage);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException or InvalidOperationException)
        {
            return null;
        }
    }
}

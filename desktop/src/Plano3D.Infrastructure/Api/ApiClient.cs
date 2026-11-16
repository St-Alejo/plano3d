using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Plano3D.Core.Json;

namespace Plano3D.Infrastructure.Api;

public sealed record SessionUser(string Id, string Email, string Name, bool IsDemo);

public sealed record Session(string AccessToken, string RefreshToken, int ExpiresIn, SessionUser User);

public sealed record ProjectSummary(string Id, string Name, string Status, int RoomCount, double? TotalArea, string UpdatedAt, bool HasSource);

public sealed record AuthConfig(bool AuthRequired, bool DemoEnabled);

/// <summary>Error de la API con el mensaje en español que manda el servidor (campo <c>detail</c>).</summary>
public sealed class ApiException(HttpStatusCode status, string message) : Exception(message)
{
    public HttpStatusCode Status { get; } = status;
}

/// <summary>
/// Cliente REST de Plano 3D (mismo contrato que la web, ADR-020). Pone el token de acceso,
/// y ante un 401 renueva la sesión una sola vez con el de refresco y reintenta.
/// </summary>
public sealed class ApiClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly ITokenStore _store;
    private readonly SemaphoreSlim _refreshing = new(1, 1);
    private string? _access;

    public ApiClient(Uri baseUrl, ITokenStore store, HttpMessageHandler? handler = null)
    {
        BaseUrl = baseUrl;
        _store = store;
        _http = handler is null ? new HttpClient() : new HttpClient(handler);
        _http.BaseAddress = new Uri(baseUrl, "/api/");
        _http.Timeout = TimeSpan.FromSeconds(60);
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("Plano3D-Escritorio/1.0");
    }

    public Uri BaseUrl { get; }
    public SessionUser? User { get; private set; }
    public bool SignedIn => User is not null;

    /// <summary>Cambió la sesión (entró, salió o venció).</summary>
    public event Action<SessionUser?>? SessionChanged;

    // ------------------------------------------------------------------ cuentas
    public async Task<AuthConfig> ConfigAsync(CancellationToken ct = default)
    {
        var json = await SendAsync(HttpMethod.Get, "auth/config", null, ct, auth: false);
        return new AuthConfig((bool?)json["auth_required"] ?? true, (bool?)json["demo_enabled"] ?? false);
    }

    public Task<Session> LoginAsync(string email, string password, CancellationToken ct = default) =>
        EnterAsync("auth/login", new JsonObject { ["email"] = email, ["password"] = password }, ct);

    public Task<Session> DemoAsync(CancellationToken ct = default) => EnterAsync("auth/demo", null, ct);

    /// <summary>Código de 6 caracteres que muestra la web («Abrir en escritorio»).</summary>
    public Task<Session> ExchangeLinkCodeAsync(string code, CancellationToken ct = default) =>
        EnterAsync("auth/link-codes/exchange", new JsonObject { ["code"] = code.Trim().ToUpperInvariant() }, ct);

    /// <summary>Vuelve a entrar con el token de refresco guardado (al abrir la app).</summary>
    public async Task<bool> ResumeAsync(CancellationToken ct = default)
    {
        if (_store.Load() is null) return false;
        return await RefreshAsync(ct);
    }

    public async Task LogoutAsync(CancellationToken ct = default)
    {
        try
        {
            await SendAsync(HttpMethod.Post, "auth/logout", null, ct);
        }
        catch (Exception e) when (e is ApiException or HttpRequestException)
        {
            // sin red: igual se cierra la sesión local
        }
        Clear();
    }

    public async Task<string> WsTicketAsync(CancellationToken ct = default)
    {
        var json = await SendAsync(HttpMethod.Post, "auth/ws-ticket", null, ct);
        return (string)json["ticket"]!;
    }

    // ------------------------------------------------------------------ proyectos
    public async Task<IReadOnlyList<ProjectSummary>> ProjectsAsync(CancellationToken ct = default)
    {
        var json = await SendAsync(HttpMethod.Get, "projects", null, ct);
        return ((JsonArray)json["items"]!).OfType<JsonObject>().Select(p => new ProjectSummary(
            p.Str("id") ?? "",
            p.Str("name") ?? "",
            p.Str("status") ?? "",
            (int?)p["room_count"] ?? 0,
            (double?)p["total_area"],
            p.Str("updated_at") ?? "",
            (bool?)p["has_source"] ?? true)).ToList();
    }

    /// <summary>El proyecto entero (con su modelo como JSON, sin perder campos).</summary>
    public async Task<JsonObject> ProjectAsync(string id, CancellationToken ct = default) =>
        await SendAsync(HttpMethod.Get, $"projects/{Uri.EscapeDataString(id)}", null, ct);

    // ------------------------------------------------------------------ transporte
    private async Task<Session> EnterAsync(string path, JsonObject? body, CancellationToken ct)
    {
        var json = await SendAsync(HttpMethod.Post, path, body, ct, auth: false);
        var session = ParseSession(json);
        Accept(session);
        return session;
    }

    private async Task<bool> RefreshAsync(CancellationToken ct)
    {
        var refresh = _store.Load();
        if (refresh is null) return false;
        await _refreshing.WaitAsync(ct);
        try
        {
            if (_store.Load() != refresh && _access is not null) return true; // otro hilo ya renovó
            for (var attempt = 0; attempt < 2; attempt++)
            {
                using var res = await _http.PostAsJsonAsync("auth/refresh", new { refresh_token = refresh }, ct);
                if (res.IsSuccessStatusCode)
                {
                    Accept(ParseSession((await res.Content.ReadFromJsonAsync<JsonObject>(ct))!));
                    return true;
                }
                if (res.StatusCode == HttpStatusCode.Unauthorized)
                {
                    Clear();
                    return false;
                }
                // frenado o servidor caído: un reintento antes de rendirse (sin borrar el token)
                await Task.Delay(1000, ct);
            }
            return false;
        }
        finally
        {
            _refreshing.Release();
        }
    }

    private async Task<JsonObject> SendAsync(HttpMethod method, string path, JsonObject? body, CancellationToken ct, bool auth = true)
    {
        for (var attempt = 0; ; attempt++)
        {
            using var req = new HttpRequestMessage(method, path);
            if (body is not null) req.Content = JsonContent.Create(body);
            if (auth && _access is not null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _access);
            using var res = await _http.SendAsync(req, ct);
            if (res.StatusCode == HttpStatusCode.Unauthorized && auth && attempt == 0 && await RefreshAsync(ct)) continue;
            var text = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode) throw new ApiException(res.StatusCode, Detail(text, res.StatusCode));
            if (string.IsNullOrWhiteSpace(text)) return new JsonObject();
            var node = JsonNode.Parse(text);
            return node as JsonObject ?? new JsonObject { ["items"] = node };
        }
    }

    private static string Detail(string text, HttpStatusCode status)
    {
        try
        {
            var detail = JsonNode.Parse(text)?["detail"];
            if (detail is JsonValue v) return v.ToString();
            if (detail is JsonArray arr && arr.Count > 0) return arr[0]?["msg"]?.ToString() ?? text;
        }
        catch (System.Text.Json.JsonException)
        {
        }
        return status == HttpStatusCode.TooManyRequests ? "Demasiados intentos: espera un minuto" : $"Error {(int)status}";
    }

    private static Session ParseSession(JsonObject j)
    {
        var u = (JsonObject)j["user"]!;
        return new Session(
            (string)j["access_token"]!,
            (string)j["refresh_token"]!,
            (int?)j["expires_in"] ?? 3600,
            new SessionUser(u.Str("id") ?? "", u.Str("email") ?? "", u.Str("name") ?? "", (bool?)u["is_demo"] ?? false));
    }

    private void Accept(Session s)
    {
        _access = s.AccessToken;
        _store.Save(s.RefreshToken);
        User = s.User;
        SessionChanged?.Invoke(User);
    }

    private void Clear()
    {
        _access = null;
        _store.Clear();
        User = null;
        SessionChanged?.Invoke(null);
    }

    public void Dispose()
    {
        _http.Dispose();
        _refreshing.Dispose();
    }
}

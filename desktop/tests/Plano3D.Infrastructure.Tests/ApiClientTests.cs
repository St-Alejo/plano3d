using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Plano3D.Infrastructure.Api;
using Xunit;

namespace Plano3D.Infrastructure.Tests;

/// <summary>Servidor falso: responde según la ruta y guarda lo que se pidió.</summary>
internal sealed class FakeServer : HttpMessageHandler
{
    public List<(string Path, string? Auth, string? Body)> Calls { get; } = [];
    public Func<string, string?, string?, (HttpStatusCode, object?)> Respond { get; set; } = (_, _, _) => (HttpStatusCode.NotFound, null);

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var path = request.RequestUri!.AbsolutePath;
        var auth = request.Headers.Authorization?.Parameter;
        var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
        Calls.Add((path, auth, body));
        var (status, payload) = Respond(path, auth, body);
        return new HttpResponseMessage(status)
        {
            Content = new StringContent(payload is null ? "" : System.Text.Json.JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
        };
    }

    public static object Session(string access, string refresh) => new
    {
        access_token = access,
        refresh_token = refresh,
        expires_in = 3600,
        token_type = "bearer",
        user = new { id = "usr_1", email = "ana@plano3d.app", name = "Ana", is_demo = false },
    };
}

public class ApiClientTests
{
    private static (ApiClient Api, FakeServer Server, MemoryTokenStore Store) Make()
    {
        var server = new FakeServer();
        var store = new MemoryTokenStore();
        return (new ApiClient(new Uri("http://api.test"), store, server), server, store);
    }

    [Fact]
    public async Task LoginStoresTheSessionAndSendsTheToken()
    {
        var (api, server, store) = Make();
        server.Respond = (path, auth, _) => path switch
        {
            "/api/auth/login" => (HttpStatusCode.OK, FakeServer.Session("a1", "r1")),
            "/api/projects" when auth == "a1" => (HttpStatusCode.OK, new { items = new[] { new { id = "p1", name = "Casa", status = "ready", room_count = 3, updated_at = "hoy", has_source = true } } }),
            _ => (HttpStatusCode.Unauthorized, new { detail = "sin sesión" }),
        };
        SessionUser? changed = null;
        api.SessionChanged += u => changed = u;

        await api.LoginAsync("ana@plano3d.app", "clave-1234");
        var projects = await api.ProjectsAsync();

        Assert.Equal("r1", store.Load());
        Assert.Equal("Ana", changed?.Name);
        Assert.Equal("Casa", Assert.Single(projects).Name);
        Assert.Equal(3, projects[0].RoomCount);
    }

    [Fact]
    public async Task AnExpiredTokenIsRenewedOnceAndTheRequestRetried()
    {
        var (api, server, store) = Make();
        store.Save("r-viejo");
        server.Respond = (path, auth, body) => path switch
        {
            "/api/auth/refresh" when body!.Contains("r-viejo") => (HttpStatusCode.OK, FakeServer.Session("a2", "r2")),
            "/api/projects/p1" when auth == "a2" => (HttpStatusCode.OK, new { id = "p1", model = new { levels = Array.Empty<object>() } }),
            _ => (HttpStatusCode.Unauthorized, new { detail = "vencido" }),
        };

        var project = await api.ProjectAsync("p1");

        Assert.Equal("p1", (string?)project["id"]);
        Assert.Equal(["/api/projects/p1", "/api/auth/refresh", "/api/projects/p1"], server.Calls.Select(c => c.Path));
        Assert.Equal("r2", store.Load());
    }

    [Fact]
    public async Task ARejectedRefreshClosesTheSession()
    {
        var (api, server, store) = Make();
        store.Save("r-revocado");
        server.Respond = (_, _, _) => (HttpStatusCode.Unauthorized, new { detail = "Sesión vencida" });

        Assert.False(await api.ResumeAsync());
        Assert.Null(store.Load());
        Assert.False(api.SignedIn);
    }

    [Fact]
    public async Task ThrottledRefreshIsRetriedWithoutLosingTheToken()
    {
        var (api, server, store) = Make();
        store.Save("r1");
        var n = 0;
        server.Respond = (path, _, _) => path == "/api/auth/refresh" && ++n == 1
            ? (HttpStatusCode.TooManyRequests, new { detail = "Demasiados intentos" })
            : (HttpStatusCode.OK, FakeServer.Session("a3", "r3"));

        Assert.True(await api.ResumeAsync());
        Assert.Equal(2, n);
        Assert.Equal("r3", store.Load());
    }

    [Fact]
    public async Task ServerErrorsCarryTheSpanishMessage()
    {
        var (api, server, _) = Make();
        server.Respond = (_, _, _) => (HttpStatusCode.Unauthorized, new { detail = "Correo o contraseña incorrectos" });
        var e = await Assert.ThrowsAsync<ApiException>(() => api.LoginAsync("x@y.co", "mala-clave"));
        Assert.Equal("Correo o contraseña incorrectos", e.Message);
        Assert.Equal(HttpStatusCode.Unauthorized, e.Status);
    }

    [Fact]
    public async Task LinkCodesAreNormalized()
    {
        var (api, server, _) = Make();
        server.Respond = (_, _, _) => (HttpStatusCode.OK, FakeServer.Session("a", "r"));
        await api.ExchangeLinkCodeAsync("  ab3k9z ");
        Assert.Contains("\"AB3K9Z\"", server.Calls.Single().Body);
    }

    [Fact]
    public void DpapiStoreRoundTripsAndIsNotPlainText()
    {
        var path = Path.Combine(Path.GetTempPath(), $"plano3d-{Guid.NewGuid():N}", "sesion.bin");
        var store = new DpapiTokenStore(path);
        Assert.Null(store.Load());
        store.Save("token-secreto-123");
        Assert.Equal("token-secreto-123", new DpapiTokenStore(path).Load());
        if (OperatingSystem.IsWindows())
            Assert.DoesNotContain("token-secreto", Encoding.UTF8.GetString(File.ReadAllBytes(path)));
        store.Clear();
        Assert.Null(store.Load());
        Directory.Delete(Path.GetDirectoryName(path)!, true);
    }

    [Fact]
    public void CollabUriUsesWssForHttps()
    {
        var api = new ApiClient(new Uri("https://api.plano3d.test"), new MemoryTokenStore());
        var collab = new Collab.CollabClient(api, "prj 1");
        Assert.Equal("wss://api.plano3d.test/api/ws/collab/prj%201?ticket=t%2B1", collab.CollabUri("t+1").AbsoluteUri);
    }
}

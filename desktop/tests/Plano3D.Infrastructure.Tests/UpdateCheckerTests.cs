using System.Net;
using Plano3D.Infrastructure.Updates;
using Xunit;

namespace Plano3D.Infrastructure.Tests;

public class UpdateCheckerTests
{
    private static (UpdateChecker Checker, FakeServer Server) Make(HttpStatusCode status, object? body)
    {
        var server = new FakeServer { Respond = (_, _, _) => (status, body) };
        return (new UpdateChecker(new HttpClient(server)), server);
    }

    [Theory]
    [InlineData("v1.2.0", "1.2.0")]
    [InlineData("1.3", "1.3.0")]
    [InlineData("escritorio-v2.0.1", "2.0.1")]
    public void Lee_la_version_del_tag(string tag, string expected) =>
        Assert.Equal(Version.Parse(expected), UpdateChecker.ParseTag(tag));

    [Fact]
    public void Un_tag_sin_numeros_no_es_version() => Assert.Null(UpdateChecker.ParseTag("ultima"));

    [Fact]
    public async Task Avisa_solo_si_hay_una_mas_nueva()
    {
        var (newer, server) = Make(HttpStatusCode.OK, new { tag_name = "v1.4.0" });
        var info = await newer.CheckAsync(new Version(1, 0, 0));
        Assert.Equal(new Version(1, 4, 0), info?.Latest);
        Assert.Equal(AppVersion.DownloadPage, info?.Url);
        Assert.Equal("/repos/St-Alejo/plano3d-frontend/releases/latest", server.Calls[0].Path);

        var (same, _) = Make(HttpStatusCode.OK, new { tag_name = "v1.0.0" });
        Assert.Null(await same.CheckAsync(new Version(1, 0, 0)));
    }

    [Fact]
    public async Task Sin_release_o_con_error_calla()
    {
        var (missing, _) = Make(HttpStatusCode.NotFound, new { message = "Not Found" });
        Assert.Null(await missing.CheckAsync(new Version(1, 0, 0)));
        var (broken, _) = Make(HttpStatusCode.OK, null); // cuerpo vacío
        Assert.Null(await broken.CheckAsync(new Version(1, 0, 0)));
    }
}

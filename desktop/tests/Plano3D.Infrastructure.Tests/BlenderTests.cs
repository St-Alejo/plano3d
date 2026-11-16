using System.Net;
using Plano3D.Infrastructure.Api;
using Plano3D.Infrastructure.Blender;
using Xunit;

namespace Plano3D.Infrastructure.Tests;

public class BlenderTests
{
    [Fact]
    public void LeeElAvanceDelScriptYDeCycles()
    {
        Assert.Equal(new BlenderEvent.CameraStart(2, 5, "Interior Sala (Piso 1)"), BlenderOutput.Parse("camara: 2/5 Interior Sala (Piso 1)"));
        Assert.Equal(new BlenderEvent.Sample(16, 64),
            BlenderOutput.Parse("Fra:1 Mem:120.50M (Peak 130.20M) | Time:00:02.15 | Remaining:00:10.20 | Mem:50M, Peak:60M | Scene, ViewLayer | Sample 16/64"));
        Assert.Equal(new BlenderEvent.Sample(3, 48), BlenderOutput.Parse("00:01.20 | Mem:80M | Scene, ViewLayer | Sample 3/48"));
        Assert.Equal(new BlenderEvent.Saved(@"C:\p\renders\Fachada_principal.png"), BlenderOutput.Parse(@"render: C:\p\renders\Fachada_principal.png"));
        Assert.IsType<BlenderEvent.Ready>(BlenderOutput.Parse("Plano 3D: escena lista en C:\\p\\casa.blend (300 mallas, 11 cámaras, OPTIX)"));
        Assert.IsType<BlenderEvent.Failure>(BlenderOutput.Parse("Traceback (most recent call last):"));
        Assert.Null(BlenderOutput.Parse("Blender 5.2.0 (hash abc built 2026-10-01)"));
        Assert.Null(BlenderOutput.Parse("   "));
    }

    [Fact]
    public void ElAvanceCuentaTodasLasCamaras()
    {
        Assert.Equal(0, new RenderProgress("Preparando", 0, 0, "", 0, 0).Fraction);
        Assert.Equal(0.5, new RenderProgress("Renderizando", 2, 2, "B", 0, 64).Fraction);
        Assert.Equal(0.75, new RenderProgress("Renderizando", 2, 2, "B", 32, 64).Fraction);
    }

    [Fact]
    public void ArgumentosDelScript()
    {
        var args = BlenderRunner.Arguments(new RenderRequest(@"C:\paq", RenderQuality.Borrador, RenderHour.Atardecer, "Fachada"));
        Assert.Equal("-b", args[0]);
        Assert.Contains(Path.Combine(@"C:\paq", "blender", "arquitectura.py"), args);
        Assert.Equal(["--calidad", "borrador", "--hora", "atardecer", "--camara", "Fachada"], args.Skip(args.ToList().IndexOf("--calidad")));
        Assert.DoesNotContain("--camara", BlenderRunner.Arguments(new RenderRequest(@"C:\paq", RenderQuality.Final, RenderHour.Dia)));
    }

    [Fact]
    public void EncuentraLaVersionMasNueva()
    {
        var root = Directory.CreateTempSubdirectory("plano3d-blender");
        try
        {
            foreach (var v in new[] { "Blender 4.2", "Blender 5.2", "Blender 5.10" })
            {
                var dir = Directory.CreateDirectory(Path.Combine(root.FullName, "Blender Foundation", v));
                File.WriteAllText(Path.Combine(dir.FullName, "blender.exe"), "");
            }
            var found = BlenderLocator.Find(null, _ => null, [root.FullName]);
            Assert.EndsWith(Path.Combine("Blender 5.10", "blender.exe"), found);

            var mine = Path.Combine(root.FullName, "mio.exe");
            File.WriteAllText(mine, "");
            Assert.Equal(mine, BlenderLocator.Find(mine, _ => null, [root.FullName]));
            Assert.Null(BlenderLocator.Find(null, _ => null, [Path.Combine(root.FullName, "nada")]));
        }
        finally
        {
            root.Delete(true);
        }
    }

    [Fact]
    public async Task SubeElRenderYSiLaSesionVencioReintentaConElFormularioEntero()
    {
        var server = new FakeServer();
        var store = new MemoryTokenStore();
        store.Save("r-viejo");
        var api = new ApiClient(new Uri("http://api.test"), store, server);
        server.Respond = (path, auth, body) => path switch
        {
            "/api/auth/refresh" => (HttpStatusCode.OK, FakeServer.Session("a2", "r2")),
            "/api/projects/p1/renders" when auth == "a2" && body!.Contains("Fachada principal") && body.Contains("atardecer") =>
                (HttpStatusCode.Created, new { id = "p1-abc" }),
            _ => (HttpStatusCode.Unauthorized, new { detail = "vencido" }),
        };

        var id = await api.UploadRenderAsync("p1", [0xFF, 0xD8, 0xFF, 0xE0], "fachada.jpg", "Fachada principal", "Fachada principal", "final", "atardecer");

        Assert.Equal("p1-abc", id);
        Assert.Equal(["/api/projects/p1/renders", "/api/auth/refresh", "/api/projects/p1/renders"], server.Calls.Select(c => c.Path));
    }
}

using System.Text.Json;
using System.Text.Json.Nodes;
using Plano3D.Core.Model;
using Plano3D.Core.Rendering;
using Xunit;

namespace Plano3D.Core.Tests;

/// <summary>
/// El <c>proyecto.json</c> del escritorio es el mismo que arma la web: el script de Blender es
/// uno solo. <c>blender-project.json</c> lo generó <c>blenderProject()</c> de la web con la
/// casa de la demo.
/// </summary>
public class BlenderProjectTests
{
    [Fact]
    public void Igual_al_de_la_web_para_la_casa_demo()
    {
        var expected = Fixture.Load("blender-project.json");
        var actual = BlenderProject.Build(BuildingModel.From(Fixture.House()), "Casa 3 pisos");
        AssertSame(expected, actual, "$");
    }

    [Fact]
    public void Frente_del_lado_del_porton_y_un_porton_por_garaje()
    {
        var p = BlenderProject.Build(BuildingModel.From(Fixture.House()), "Casa");
        var site = p["site"]!.AsObject();
        Assert.Equal(2, site["gates"]!.AsArray().Count);
        var names = BlenderProject.CameraNames(p);
        Assert.Contains("Fachada principal", names);
        Assert.Contains(names, n => n.StartsWith("Interior ", StringComparison.Ordinal));
        Assert.DoesNotContain(names, n => n.Contains("Parqueadero", StringComparison.Ordinal));
    }

    [Fact]
    public void Sin_sol_de_dia_usa_el_de_la_manana()
    {
        var p = BlenderProject.Build(BuildingModel.From(Fixture.House()), "Casa", new Lighting.SunPosition(-10, 270));
        Assert.Equal(52, p["sun"]!["altitude"]!.GetValue<double>());
    }

    [Fact]
    public void La_vista_del_editor_pasa_a_Blender_con_su_focal()
    {
        var p = BlenderProject.Build(BuildingModel.From(Fixture.House()), "Casa");
        // 50° verticales en 16:9 ≈ 79,3° horizontales ≈ 21,7 mm en sensor de 36 mm
        var cam = BlenderProject.AddViewCamera(p, "Vista actual", (1, 2, 3), (4, 5, 6), 50);
        Assert.Equal("Vista actual", BlenderProject.CameraNames(p)[0]);
        Assert.Equal([1, -3, 2], cam["location"]!.AsArray().Select(n => n!.GetValue<double>()));
        Assert.Equal([4, -6, 5], cam["target"]!.AsArray().Select(n => n!.GetValue<double>()));
        Assert.InRange(cam["lens"]!.GetValue<double>(), 21.5, 21.9);
    }

    [Theory]
    [InlineData("SALA COMEDOR", "Sala comedor")]
    [InlineData("Alcoba 3", "Alcoba 3")]
    [InlineData("baño", "baño")]
    public void Titulos(string label, string expected) => Assert.Equal(expected, BlenderProject.TitleCase(label));

    private static double Num(JsonNode n) => double.Parse(n.ToJsonString(), System.Globalization.CultureInfo.InvariantCulture);

    private static void AssertSame(JsonNode? a, JsonNode? b, string path)
    {
        switch (a)
        {
            case JsonObject oa:
                var ob = Assert.IsType<JsonObject>(b);
                Assert.True(oa.Select(kv => kv.Key).Order().SequenceEqual(ob.Select(kv => kv.Key).Order()),
                    $"{path}: claves {string.Join(",", oa.Select(k => k.Key))} ≠ {string.Join(",", ob.Select(k => k.Key))}");
                foreach (var (k, v) in oa) AssertSame(v, ob[k], $"{path}.{k}");
                break;
            case JsonArray xa:
                var xb = Assert.IsType<JsonArray>(b);
                Assert.True(xa.Count == xb.Count, $"{path}: {xa.Count} ≠ {xb.Count} elementos");
                for (var i = 0; i < xa.Count; i++) AssertSame(xa[i], xb[i], $"{path}[{i}]");
                break;
            case JsonValue va when va.GetValueKind() == JsonValueKind.Number:
                var nb = b!.AsValue();
                Assert.True(Math.Abs(Num(va) - Num(nb)) <= 0.002, $"{path}: {va} ≠ {nb}");
                break;
            default:
                Assert.True(JsonNode.DeepEquals(a, b), $"{path}: {a?.ToJsonString()} ≠ {b?.ToJsonString()}");
                break;
        }
    }
}

using System.Text.Json.Nodes;
using Plano3D.Core.Rendering;
using Xunit;

namespace Plano3D.Core.Tests;

public class BlenderExportTests
{
    [Theory]
    [InlineData("wall-ladrillo", "wall:ladrillo:solid")]
    [InlineData("floor-madera_roble", "floor:madera_roble")]
    [InlineData("door-frame", "door")]
    [InlineData("window-frame", "frame")]
    [InlineData("glass", "glass")]
    [InlineData("bulb", "lamp")]
    [InlineData("furn-wood-1", "tone:wood")]
    [InlineData("furn-6f7d8c-0.8", "tone:fabric")]
    [InlineData("furn-f2f1ee-0.15", "tone:white")]
    public void Materiales_con_los_nombres_del_visor_web(string key, string expected) =>
        Assert.Equal(expected, BlenderNaming.Material(key)?.Name);

    [Theory]
    [InlineData("ground")]
    [InlineData("hl-ff0000")]
    [InlineData("ghost-00ff00")]
    public void Lo_que_es_solo_del_editor_no_va(string key) => Assert.Null(BlenderNaming.Material(key));

    [Theory]
    [InlineData("wall", "door", "door", "Carpintería")]
    [InlineData("wall", "glass", "window", "Vidrios")]
    [InlineData("wall", "wall-panete", "wall", "Muros")]
    [InlineData("room", "slab", "slab", "Pisos y losas")]
    [InlineData("room", "bulb", "lamp", "Luminarias")]
    [InlineData("stair", "railing", "railing", "Detalles")]
    [InlineData("furniture", "furn-wood-0", "furniture", "Muebles")]
    public void Tipo_y_coleccion(string entity, string material, string kind, string category)
    {
        Assert.Equal(kind, BlenderNaming.Kind(entity, material));
        Assert.Equal(category, BlenderNaming.Category(kind));
    }

    [Fact]
    public void El_nombre_lleva_los_datos_y_vuelve_limpio()
    {
        var name = BlenderNaming.EncodeNode("wall_w1.a", "wall", "Piso 2", "L2");
        Assert.DoesNotContain('.', name);
        var (clean, extras) = BlenderNaming.DecodeNode(name);
        Assert.Equal("wall_w1_a", clean);
        Assert.Equal("wall", extras["kind"]);
        Assert.Equal("Muros", extras["category"]);
        Assert.Equal("Piso 2", extras["level"]);
        Assert.Equal("L2", extras["levelId"]);
    }

    [Fact]
    public void El_glb_queda_con_extras_y_el_binario_intacto()
    {
        var json = new JsonObject
        {
            ["asset"] = new JsonObject { ["version"] = "2.0" },
            ["nodes"] = new JsonArray(
                new JsonObject { ["name"] = BlenderNaming.EncodeNode("muro", "wall", "Piso 1", "L1") },
                new JsonObject { ["name"] = "Casa", ["extras"] = new JsonObject { ["x"] = 1 } }),
        };
        var bin = new byte[] { 1, 2, 3, 4, 5 };
        var (glb, tagged) = GlbExtras.Apply(GlbExtras.Write(json, bin));
        Assert.Equal(1, tagged);
        Assert.Equal(0, glb.Length % 4);
        var (outJson, outBin) = GlbExtras.Read(glb);
        var node = outJson["nodes"]![0]!;
        Assert.Equal("muro", (string?)node["name"]);
        Assert.Equal("Piso 1", (string?)node["extras"]!["level"]);
        Assert.Equal("Muros", (string?)node["extras"]!["category"]);
        Assert.Equal(1, (int)outJson["nodes"]![1]!["extras"]!["x"]!);
        Assert.Equal(new byte[] { 1, 2, 3, 4, 5, 0, 0, 0 }, outBin);
        Assert.Throws<InvalidDataException>(() => GlbExtras.Read(new byte[24]));
    }

    [Fact]
    public void Los_materiales_recuperan_su_nombre_de_la_web()
    {
        var json = new JsonObject
        {
            ["asset"] = new JsonObject { ["version"] = "2.0" },
            ["materials"] = new JsonArray(new JsonObject { ["name"] = "m0" }, new JsonObject { ["name"] = "m1" }, new JsonObject { ["name"] = "otro" }),
        };
        var names = new Dictionary<string, string> { ["m0"] = "wall:plaster:solid", ["m1"] = "door" };
        var (glb, _) = GlbExtras.Apply(GlbExtras.Write(json, null), names);
        var mats = GlbExtras.Read(glb).Json["materials"]!.AsArray().Select(m => (string?)m!["name"]).ToArray();
        Assert.Equal(["wall:plaster:solid", "door", "otro"], mats);
    }
}

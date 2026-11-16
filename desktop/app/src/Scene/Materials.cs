using Godot;
using Plano3D.Core.Editing;

namespace Plano3D.App.Scene;

/// <summary>
/// Materiales de la escena (patrón Flyweight: uno por clase de superficie, compartido por
/// todas las mallas). La fase de gráficos los cambia por PBR con texturas.
/// </summary>
public static class Materials
{
    private static readonly Dictionary<string, StandardMaterial3D> Cache = [];

    private static StandardMaterial3D Get(string key, Func<StandardMaterial3D> make)
    {
        if (!Cache.TryGetValue(key, out var m)) Cache[key] = m = make();
        return m;
    }

    private static StandardMaterial3D Matte(string hex, float rough = 0.9f) => new() { AlbedoColor = new Color(hex), Roughness = rough };

    /// <summary>Acabado de muro con los mismos ids y colores que la web (la fase de gráficos trae las texturas).</summary>
    public static StandardMaterial3D Wall(string material)
    {
        if (material == "glass") return Glass;
        var spec = Catalog.WallFinish(material) ?? Catalog.WallFinishes[0];
        return Get($"wall-{spec.Id}", () => Matte(spec.Color, (float)spec.Roughness));
    }

    public static StandardMaterial3D Floor(string? material, string? roomType)
    {
        if (Catalog.FloorFinish(material) is { } spec) return Get($"floor-{spec.Id}", () => Matte(spec.Color, (float)spec.Roughness));
        return (material ?? roomType) switch
        {
            "tile" or "bathroom" or "kitchen" => Get("floor-tile", () => Matte("d8d3c8", 0.5f)),
            "concrete" or "garage" or "parking" => Get("floor-concrete", () => Matte("a9a59d")),
            "grass" => Get("floor-grass", () => Matte("7d9a5b")),
            _ => Get("floor-wood", () => Matte("b98a5e", 0.7f)),
        };
    }

    public static StandardMaterial3D Door => Get("door", () => Matte("6b4428", 0.6f));

    public static StandardMaterial3D Glass => Get("glass", () => new StandardMaterial3D
    {
        AlbedoColor = new Color(0.62f, 0.78f, 0.84f, 0.35f),
        Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
        Roughness = 0.05f,
        Metallic = 0.1f,
    });

    public static StandardMaterial3D Column => Get("column", () => Matte("bdb8ae"));
    public static StandardMaterial3D Stair => Get("stair", () => Matte("cfc8bb"));
    public static StandardMaterial3D Ground => Get("ground", () => Matte("dcd6c9", 1));

    private static readonly string[] FurniturePalette = ["8a7f72", "5f6b73", "a69886", "7b6a58", "c4b9a8", "6f7d6a", "9c8572"];

    /// <summary>Un tono estable por pieza del catálogo (la fase de gráficos trae los modelos).</summary>
    public static StandardMaterial3D Furniture(string catalogId)
    {
        uint h = 0;
        foreach (var ch in catalogId) h = unchecked(h * 31 + ch);
        var hex = catalogId switch
        {
            var c when c.StartsWith("cama") => "e8e1d4",
            var c when c.StartsWith("sofa") || c.StartsWith("sillon") => "6f7d8c",
            var c when c is "sanitario" or "lavamanos" or "ducha" or "nevera" or "lavadora" => "f2f1ee",
            var c when c.StartsWith("planta") => "5d7d4a",
            _ => FurniturePalette[h % FurniturePalette.Length],
        };
        return Get($"furn-{hex}", () => Matte(hex, 0.8f));
    }

    /// <summary>Capa encima de una malla: lo seleccionado (o lo que mira otra persona).</summary>
    public static StandardMaterial3D Highlight(Color color) => Get($"hl-{color.ToHtml()}", () => new StandardMaterial3D
    {
        AlbedoColor = new Color(color, 0.38f),
        Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
        ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
        CullMode = BaseMaterial3D.CullModeEnum.Disabled,
    });

    /// <summary>Fantasma de lo que otra persona está arrastrando.</summary>
    public static StandardMaterial3D Ghost(Color color) => Get($"ghost-{color.ToHtml()}", () => new StandardMaterial3D
    {
        AlbedoColor = new Color(color, 0.45f),
        Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
        ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
        NoDepthTest = true,
    });
}

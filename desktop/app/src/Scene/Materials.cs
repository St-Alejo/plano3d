using Godot;
using Plano3D.Core.Editing;

namespace Plano3D.App.Scene;

/// <summary>
/// Materiales de la escena (patrón Flyweight: uno por clase de superficie, compartido por
/// todas las mallas). PBR con las mismas fotos CC0 que la web (assets/texturas), proyectadas
/// en coordenadas de mundo: cada textura se repite cada <c>tileM</c> metros, así el ladrillo
/// mide lo mismo en un muro de 1 m que en uno de 8 m y los tramos de un muro quedan continuos.
/// </summary>
public static class Materials
{
    private static readonly Dictionary<string, StandardMaterial3D> Cache = [];
    private static readonly Dictionary<string, Texture2D?> Maps = [];

    private static StandardMaterial3D Get(string key, Func<StandardMaterial3D> make)
    {
        if (!Cache.TryGetValue(key, out var m))
        {
            Cache[key] = m = make();
            m.ResourceName = key;
        }
        return m;
    }

    private static StandardMaterial3D Matte(string hex, float rough = 0.9f) => new() { AlbedoColor = new Color(hex), Roughness = rough };

    private static Texture2D? Map(string texture, string kind)
    {
        var key = $"{texture}/{kind}";
        if (!Maps.TryGetValue(key, out var t))
        {
            var path = $"res://assets/texturas/{texture}/{kind}.webp";
            Maps[key] = t = ResourceLoader.Exists(path) ? GD.Load<Texture2D>(path) : null;
        }
        return t;
    }

    /// <summary>Material PBR de una foto teñida; si falta la foto, color plano.</summary>
    private static StandardMaterial3D Pbr(string texture, string tint, float normal = 0.8f, string fallback = "cccccc", float fallbackRough = 0.9f)
    {
        var color = Map(texture, "color");
        if (color is null) return Matte(fallback, fallbackRough);
        var k = 1f / (float)FinishSpec.TileMeters.GetValueOrDefault(texture, 1);
        return new StandardMaterial3D
        {
            AlbedoColor = new Color(tint),
            AlbedoTexture = color,
            NormalEnabled = Map(texture, "normal") is not null,
            NormalTexture = Map(texture, "normal"),
            NormalScale = normal,
            Roughness = 1,
            RoughnessTexture = Map(texture, "rough"),
            RoughnessTextureChannel = BaseMaterial3D.TextureChannel.Red,
            Uv1Triplanar = true,
            Uv1WorldTriplanar = true,
            Uv1TriplanarSharpness = 8,
            Uv1Scale = new Vector3(k, k, k),
            TextureFilter = BaseMaterial3D.TextureFilterEnum.LinearWithMipmapsAnisotropic,
        };
    }

    private static StandardMaterial3D Finish(FinishSpec spec) =>
        spec.Texture is { } t ? Pbr(t, spec.Tint ?? "ffffff", fallback: spec.Color, fallbackRough: (float)spec.Roughness) : Matte(spec.Color, (float)spec.Roughness);

    /// <summary>Acabado de muro con los mismos ids, fotos y tintes que la web.</summary>
    public static StandardMaterial3D Wall(string material)
    {
        if (material == "glass") return Glass;
        var spec = Catalog.WallFinish(material) ?? Catalog.WallFinishes[0];
        return Get($"wall-{spec.Id}", () => Finish(spec));
    }

    /// <summary>Piso del ambiente: el acabado elegido o, si no hay, uno según su nombre (como la web).</summary>
    public static StandardMaterial3D Floor(string? material, string? label)
    {
        var spec = Catalog.FloorFinish(material) ?? Catalog.FloorFinish(FloorFor(material ?? label ?? ""));
        return Get($"floor-{spec!.Id}", () => Finish(spec));
    }

    private static string FloorFor(string label)
    {
        var l = Catalog.Normalize(label);
        if (l.Contains("cocin") || l.Contains("kitchen") || l == "tile") return "porcelanato";
        if (l.Contains("bano") || l.Contains("bath") || l.Contains("toilet")) return "baldosa_gris";
        if (l.Contains("dormi") || l.Contains("habita") || l.Contains("alcoba") || l.Contains("bed") || l.Contains("cuarto")) return "madera_roble";
        if (l.Contains("sala") || l.Contains("living") || l.Contains("estar") || l.Contains("comedor") || l == "wood") return "madera_roble";
        if (l.Contains("patio") || l.Contains("terraza") || l.Contains("balc") || l.Contains("garaje") || l.Contains("garage")
            || l.Contains("parque") || l.Contains("parking") || l == "concrete") return "cemento";
        return "porcelanato";
    }

    public static StandardMaterial3D Door => Get("door", () => Pbr("madera", "b48c66", 0.5f, "8d6e4f", 0.55f));
    public static StandardMaterial3D DoorFrame => Get("door-frame", () => Pbr("madera", "8f6a4b", 0.5f, "6f5139", 0.55f));
    public static StandardMaterial3D WindowFrame => Get("window-frame", () => Matte("3b3f42", 0.45f));
    public static StandardMaterial3D Sill => Get("sill", () => Pbr("concreto", "e4e2da", 0.5f, "dedcd4", 0.6f));

    public static StandardMaterial3D Glass => Get("glass", () => new StandardMaterial3D
    {
        AlbedoColor = new Color(0.62f, 0.78f, 0.84f, 0.28f),
        Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
        Roughness = 0.04f,
        Metallic = 0.2f,
        MetallicSpecular = 0.9f,
    });

    public static StandardMaterial3D Column => Get("column", () => Pbr("concreto", "d2d0c8", fallback: "c9c6bd", fallbackRough: 0.8f));
    public static StandardMaterial3D Stair => Get("stair", () => Pbr("madera", "c9a582", fallback: "a98c6a", fallbackRough: 0.6f));
    public static StandardMaterial3D Railing => Get("railing", () => new StandardMaterial3D { AlbedoColor = new Color("2f3133"), Metallic = 0.7f, Roughness = 0.35f });
    public static StandardMaterial3D Slab => Get("slab", () =>
    {
        var m = Pbr("concreto", "b8b5ad", 0.6f, "b8b5ad");
        m.CullMode = BaseMaterial3D.CullModeEnum.Disabled;
        return m;
    });
    public static StandardMaterial3D Ground => Get("ground", () => Pbr("pasto", "a9b391", 0.6f, "7f9a62", 1));

    private static readonly string[] FurniturePalette = ["8a7f72", "5f6b73", "a69886", "7b6a58", "c4b9a8", "6f7d6a", "9c8572"];

    /// <summary>Un tono estable por pieza del catálogo (los modelos de muebles llegan más adelante).</summary>
    public static StandardMaterial3D Furniture(string catalogId)
    {
        uint h = 0;
        foreach (var ch in catalogId) h = unchecked(h * 31 + ch);
        var c = catalogId;
        if (c.StartsWith("mesa") || c.StartsWith("escritorio") || c.StartsWith("biblioteca") || c.StartsWith("closet") || c.StartsWith("mueble"))
            return Get($"furn-wood-{h % 3}", () => Pbr("madera", h % 3 == 0 ? "c9a582" : h % 3 == 1 ? "a07e5e" : "e2cfb5", 0.4f, "a98c6a", 0.6f));
        var hex = c switch
        {
            _ when c.StartsWith("cama") => "e8e1d4",
            _ when c.StartsWith("sofa") || c.StartsWith("sillon") => "6f7d8c",
            "sanitario" or "lavamanos" or "ducha" or "nevera" or "lavadora" => "f2f1ee",
            _ when c.StartsWith("planta") => "5d7d4a",
            _ => FurniturePalette[h % FurniturePalette.Length],
        };
        var rough = c is "sanitario" or "lavamanos" or "ducha" ? 0.15f : c is "nevera" or "lavadora" ? 0.3f : 0.8f;
        return Get($"furn-{hex}-{rough}", () => Matte(hex, rough));
    }

    /// <summary>Lámpara encendida de noche: emite su propio color.</summary>
    public static StandardMaterial3D Bulb => Get("bulb", () => new StandardMaterial3D
    {
        AlbedoColor = new Color("fff3dc"),
        EmissionEnabled = true,
        Emission = new Color("ffd9a0"),
        EmissionEnergyMultiplier = 4,
    });

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

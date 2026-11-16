using Plano3D.Core.Editing;

namespace Plano3D.Core.Rendering;

/// <summary>Material que va en el GLB para Blender: el nombre que entiende el script y su color plano.</summary>
public readonly record struct ExportMaterial(string Name, string Hex, float Alpha = 1);

/// <summary>
/// Traducción de la escena del escritorio a lo que espera <c>arquitectura.py</c>: nombres de
/// material como los del visor web (<c>wall:ladrillo:solid</c>, <c>floor:porcelanato</c>,
/// <c>door</c>, <c>tone:fabric</c>…), el tipo de cada malla y su colección (Piso N / categoría).
/// El script rehace cada material por su nombre como material procedural de Cycles.
/// </summary>
public static class BlenderNaming
{
    /// <summary>Categoría (colección de Blender) de cada tipo de malla; como <c>CATEGORY</c> de la web.</summary>
    public static readonly IReadOnlyDictionary<string, string> Categories = new Dictionary<string, string>
    {
        ["wall"] = "Muros",
        ["column"] = "Estructura",
        ["structure"] = "Estructura",
        ["footing"] = "Estructura",
        ["room"] = "Pisos y losas",
        ["slab"] = "Pisos y losas",
        ["facade"] = "Fachada",
        ["door"] = "Carpintería",
        ["window"] = "Vidrios",
        ["furniture"] = "Muebles",
        ["stair"] = "Escalera",
        ["roof"] = "Cubierta",
        ["lamp"] = "Luminarias",
    };

    public static string Category(string kind) => Categories.GetValueOrDefault(kind, "Detalles");

    /// <summary>
    /// Tipo de una malla según la entidad que la dibuja y su material: dentro de un muro hay
    /// hojas de puerta y marcos (puerta), vidrios, marcos de ventana y alféizares (ventana).
    /// </summary>
    public static string Kind(string entityKind, string materialKey) => (entityKind, materialKey) switch
    {
        ("wall", "door" or "door-frame") => "door",
        ("wall", "glass" or "window-frame" or "sill") => "window",
        ("room", "slab") => "slab",
        ("room", "bulb") => "lamp",
        ("stair", "railing") => "railing",
        _ => entityKind,
    };

    /// <summary>
    /// El material de exportación para la clave de un material del escritorio (su
    /// <c>ResourceName</c>). null = no va a Blender (resaltados, fantasmas, el terreno: el
    /// script arma su propio entorno).
    /// </summary>
    public static ExportMaterial? Material(string key)
    {
        if (key.StartsWith("wall-", StringComparison.Ordinal))
        {
            var spec = Catalog.WallFinish(key[5..]) ?? Catalog.WallFinishes[0];
            return new($"wall:{spec.Id}:solid", spec.Color);
        }
        if (key.StartsWith("floor-", StringComparison.Ordinal))
        {
            var spec = Catalog.FloorFinish(key[6..]);
            return new($"floor:{spec?.Id ?? key[6..]}", spec?.Color ?? "c8c3b8");
        }
        if (key.StartsWith("furn-wood-", StringComparison.Ordinal))
        {
            var tone = key[^1] switch { '0' => "c9a582", '1' => "a07e5e", _ => "e2cfb5" };
            return new("tone:wood", tone);
        }
        if (key.StartsWith("furn-", StringComparison.Ordinal))
        {
            // furn-<hex>-<aspereza>
            var parts = key.Split('-');
            var hex = parts.Length > 1 ? parts[1] : "8a7f72";
            var rough = parts.Length > 2 && double.TryParse(parts[2], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var r) ? r : 0.8;
            var tone = hex switch
            {
                "5d7d4a" => "tone:soft",
                _ when rough <= 0.35 => "tone:white",
                _ => "tone:fabric",
            };
            return new(tone, hex);
        }
        return key switch
        {
            "door" => new("door", "8d6e4f"),
            "door-frame" => new("door", "6f5139"),
            "window-frame" => new("frame", "3b3f42"),
            "sill" => new("structure", "dedcd4"),
            "glass" => new("glass", "9ec7d6", 0.28f),
            "column" => new("column", "c9c6bd"),
            "slab" => new("slab", "b8b5ad"),
            "stair" => new("stair", "a98c6a"),
            "railing" => new("railing", "2f3133"),
            "bulb" => new("lamp", "fff3dc"),
            _ => null,
        };
    }

    private const string Sep = "~~";

    /// <summary>
    /// Nombre de nodo que lleva sus datos (tipo, categoría, piso): el exportador de glTF de
    /// Godot no escribe extras, así que viajan en el nombre y <see cref="GlbExtras"/> los pasa
    /// a <c>extras</c> del glTF, que Blender importa como propiedades del objeto.
    /// </summary>
    public static string EncodeNode(string name, string kind, string level, string? levelId)
    {
        var parts = new List<string> { Clean(name), $"kind={kind}", $"category={Category(kind)}", $"level={Clean(level)}" };
        if (!string.IsNullOrEmpty(levelId)) parts.Add($"levelId={Clean(levelId)}");
        return string.Join(Sep, parts);
    }

    /// <summary>De vuelta: el nombre limpio y sus datos (vacío si no traía).</summary>
    public static (string Name, Dictionary<string, string> Extras) DecodeNode(string encoded)
    {
        var parts = encoded.Split(Sep);
        var extras = new Dictionary<string, string>();
        foreach (var p in parts.Skip(1))
        {
            var eq = p.IndexOf('=');
            if (eq > 0) extras[p[..eq]] = p[(eq + 1)..];
        }
        return (parts[0], extras);
    }

    /// <summary>Godot no admite . : @ / " % en nombres de nodo.</summary>
    private static string Clean(string s)
    {
        var chars = s.Select(c => c is '.' or ':' or '@' or '/' or '"' or '%' ? '_' : c).ToArray();
        return new string(chars).Replace(Sep, "_");
    }
}

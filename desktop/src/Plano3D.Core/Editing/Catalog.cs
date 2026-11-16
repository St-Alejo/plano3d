namespace Plano3D.Core.Editing;

/// <summary>Una pieza del catálogo de muebles (mismos ids y medidas que <c>frontend/src/domain/catalog.ts</c>).</summary>
public sealed record CatalogItem(string Id, string Name, string Category, double Width, double Depth, double Height);

/// <summary>Un acabado de muro o de piso (mismos ids que <c>frontend/src/domain/materials.ts</c>).</summary>
/// <summary>Acabado: color plano y, si hay, la foto PBR (<c>Texture</c>, carpeta de assets/texturas) teñida con <c>Tint</c>.</summary>
public sealed record FinishSpec(string Id, string Name, string Color, double Roughness, string? Texture = null, string? Tint = null)
{
    /// <summary>Lado real de cada textura en metros (igual que TEXTURES de la web).</summary>
    public static readonly IReadOnlyDictionary<string, double> TileMeters = new Dictionary<string, double>
    {
        ["ladrillo"] = 1.1, ["panete"] = 2, ["concreto"] = 1.1, ["madera_piso"] = 1.8, ["porcelanato"] = 1,
        ["baldosa"] = 0.8, ["pasto"] = 2, ["tierra"] = 2.1, ["madera"] = 0.8, ["teja"] = 1.6,
    };
}

/// <summary>
/// Catálogo de muebles y acabados compartido con la web: los ids viajan en el modelo, así que
/// lo que se pone desde el escritorio se ve igual en el navegador y al revés.
/// </summary>
public static class Catalog
{
    public static readonly IReadOnlyList<CatalogItem> Items =
    [
        new("cama_doble", "Cama doble (1,40)", "Alcoba", 1.4, 1.95, 1),
        new("cama_sencilla", "Cama sencilla (1,00)", "Alcoba", 1.0, 1.95, 1),
        new("mesa_noche", "Mesa de noche", "Alcoba", 0.45, 0.4, 0.5),
        new("closet", "Clóset", "Alcoba", 1.6, 0.6, 2.2),
        new("sofa_3", "Sofá de 3 puestos", "Sala", 2.0, 0.9, 0.82),
        new("sofa_2", "Sofá de 2 puestos", "Sala", 1.5, 0.9, 0.82),
        new("sillon", "Sillón", "Sala", 0.85, 0.9, 0.82),
        new("mesa_centro", "Mesa de centro", "Sala", 1.0, 0.55, 0.4),
        new("mueble_tv", "Mueble de TV", "Sala", 1.6, 0.4, 1.2),
        new("tapete", "Tapete", "Sala", 2.0, 1.4, 0.01),
        new("comedor_4", "Comedor de 4 puestos", "Comedor", 1.2, 1.6, 0.9),
        new("cocina_lineal", "Cocina lineal", "Cocina", 2.4, 0.6, 0.91),
        new("nevera", "Nevera", "Cocina", 0.7, 0.7, 1.8),
        new("sanitario", "Sanitario", "Baño", 0.4, 0.7, 0.78),
        new("lavamanos", "Lavamanos", "Baño", 0.55, 0.45, 0.85),
        new("ducha", "Ducha", "Baño", 0.9, 0.9, 2.0),
        new("lavadora", "Lavadora", "Otros", 0.6, 0.6, 0.85),
        new("escritorio", "Escritorio", "Estudio", 1.2, 0.6, 0.75),
        new("silla", "Silla", "Estudio", 0.45, 0.5, 0.9),
        new("planta", "Planta", "Otros", 0.4, 0.4, 1.1),
    ];

    public static readonly IReadOnlyList<FinishSpec> WallFinishes =
    [
        new("plaster", "Pañete blanco", "eef0e6", 0.9, "panete", "f4f3ee"),
        new("pintura_arena", "Pintura arena", "e3d5bd", 0.85, "panete", "e8d9bf"),
        new("pintura_verde", "Pintura verde salvia", "b9c4ad", 0.85, "panete", "bfcab2"),
        new("ladrillo", "Ladrillo a la vista", "a65a3c", 0.95, "ladrillo"),
        new("concreto", "Concreto", "a7a7a1", 0.95, "concreto", "c4c4bd"),
    ];

    public static readonly IReadOnlyList<FinishSpec> FloorFinishes =
    [
        new("madera_roble", "Madera roble", "b08a64", 0.6, "madera_piso"),
        new("madera_oscura", "Madera oscura", "6f4e37", 0.55, "madera_piso", "7a5a42"),
        new("porcelanato", "Porcelanato claro", "d9d4c7", 0.3, "porcelanato", "f1ece2"),
        new("baldosa_gris", "Baldosa gris", "9aa0a0", 0.4, "baldosa", "b9bebe"),
        new("cemento", "Cemento pulido", "a3a39b", 0.7, "concreto", "b8b8b0"),
    ];

    public static CatalogItem? Item(string id) => Items.FirstOrDefault(i => i.Id == id);

    /// <summary>Busca por nombre o categoría, sin tildes ni mayúsculas.</summary>
    public static IEnumerable<CatalogItem> Search(string query)
    {
        var q = Normalize(query);
        return q.Length == 0 ? Items : Items.Where(i => Normalize($"{i.Category} {i.Name}").Contains(q));
    }

    public static FinishSpec? WallFinish(string? id) => WallFinishes.FirstOrDefault(m => m.Id == id)
        // ids antiguos que todavía traen algunos modelos
        ?? id switch { "brick" => WallFinishes[3], "concrete" => WallFinishes[4], _ => null };

    public static FinishSpec? FloorFinish(string? id) => FloorFinishes.FirstOrDefault(m => m.Id == id);

    public static string Normalize(string s)
    {
        var d = s.Normalize(System.Text.NormalizationForm.FormD);
        var chars = d.Where(c => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.NonSpacingMark);
        return new string(chars.ToArray()).ToLowerInvariant().Trim();
    }
}

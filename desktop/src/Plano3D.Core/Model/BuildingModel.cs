using System.Text.Json;
using System.Text.Json.Nodes;
using Plano3D.Core.Json;

namespace Plano3D.Core.Model;

/// <summary>Punto del plano en metros (x a la derecha, y hacia abajo del dibujo).</summary>
public readonly record struct Point2(double X, double Y)
{
    public static Point2 operator +(Point2 a, Point2 b) => new(a.X + b.X, a.Y + b.Y);
    public static Point2 operator -(Point2 a, Point2 b) => new(a.X - b.X, a.Y - b.Y);
    public static Point2 operator *(Point2 a, double k) => new(a.X * k, a.Y * k);
    public double Length => Math.Sqrt(X * X + Y * Y);
    public Point2 Normalized => Length > 1e-12 ? this * (1 / Length) : new Point2(1, 0);
}

/// <param name="Operation">cómo abre: swing (batiente), folding (portón de garaje), sliding, casement, none (vano sin hoja)…</param>
public sealed record Opening(string Id, string Kind, double Offset, double Width, double Height, double Sill = 0, string? Operation = null)
{
    public bool IsDoor => Kind is "door" or "garage";
    /// <summary>Portón de garaje: sube en vez de girar.</summary>
    public bool IsGate => Kind == "garage" || (Kind == "door" && Operation == "folding");
    /// <summary>Vano de puerta sin hoja (paso abierto).</summary>
    public bool NoLeaf => Operation == "none";
}

public sealed record Wall(
    string Id,
    Point2 Start,
    Point2 End,
    double Thickness = 0.15,
    double Height = 2.6,
    string Material = "plaster",
    IReadOnlyList<Opening>? Openings = null,
    double? Bulge = null,
    string Kind = "interior")
{
    public bool IsExterior => Kind == "exterior";
    public IReadOnlyList<Opening> OpeningsOrEmpty => Openings ?? [];
    public double Length => (End - Start).Length;
    public Point2 Direction => (End - Start).Normalized;
}

public sealed record Room(string Id, string Label, IReadOnlyList<Point2> Polygon, string? FloorMaterial = null, string? RoomType = null);

public sealed record Column(string Id, Point2 Center, double Width = 0.3, double Depth = 0.3, double Rotation = 0, bool Round = false);

public sealed record Stair(string Id, Point2 Start, Point2 End, double Width, int Steps, double Riser = 0.17, double Base = 0, string? ToLevelId = null);

public sealed record Furniture(string Id, string CatalogId, Point2 Position, double Width, double Depth, double Height, double Rotation = 0);

public sealed record Level(
    string Id,
    string Name,
    double Elevation,
    double? Height,
    IReadOnlyList<Wall> Walls,
    IReadOnlyList<Room> Rooms,
    IReadOnlyList<Column> Columns,
    IReadOnlyList<Stair> Stairs,
    IReadOnlyList<Furniture> Furniture);

/// <summary>
/// Vista tipada (solo lectura) del modelo para dibujarlo. El modelo "de verdad" viaja como
/// JSON (<see cref="JsonObject"/>) para no perder campos que este cliente aún no conoce;
/// esta vista se reconstruye cuando cambia.
/// </summary>
public sealed record BuildingModel(string ProjectId, double MetersPerPixel, string Facade, IReadOnlyList<Level> Levels, bool FacadeCustom = false)
{
    public static BuildingModel From(JsonObject json)
    {
        var levels = json.Items("levels").OfType<JsonObject>().Select(ParseLevel).ToList();
        var scale = json["scale"] as JsonObject;
        return new BuildingModel(
            json.Str("project_id") ?? "",
            Num(scale, "meters_per_pixel", 0.01),
            json.Str("facade") ?? "moderna_blanca",
            levels,
            json["facade_custom"] is JsonObject);
    }

    public Level? FindLevel(string id) => Levels.FirstOrDefault(l => l.Id == id);

    public static Level ParseLevel(JsonObject lv) => new(
        lv.Str("id") ?? "",
        lv.Str("name") ?? "",
        Num(lv, "elevation", 0),
        lv["height"] is null ? null : Num(lv, "height", 2.6),
        lv.Items("walls").OfType<JsonObject>().Select(ParseWall).ToList(),
        lv.Items("rooms").OfType<JsonObject>().Select(ParseRoom).ToList(),
        lv.Items("columns").OfType<JsonObject>().Select(ParseColumn).ToList(),
        lv.Items("stairs").OfType<JsonObject>().Select(ParseStair).ToList(),
        lv.Items("furniture").OfType<JsonObject>().Select(ParseFurniture).ToList());

    public static Wall ParseWall(JsonObject w) => new(
        w.Str("id") ?? "",
        Pt(w["start"]),
        Pt(w["end"]),
        Num(w, "thickness", 0.15),
        Num(w, "height", 2.6),
        w.Str("material") ?? "plaster",
        w.Items("openings").OfType<JsonObject>().Select(o => new Opening(
            o.Str("id") ?? "",
            o.Str("kind") ?? "door",
            Num(o, "offset", 0),
            Num(o, "width", 0.9),
            Num(o, "height", 2.1),
            Num(o, "sill", 0),
            o.Str("operation"))).ToList(),
        w["bulge"] is null ? null : Num(w, "bulge", 0),
        w.Str("kind") ?? "interior");

    public static Room ParseRoom(JsonObject r) => new(
        r.Str("id") ?? "",
        r.Str("label") ?? "",
        r.Items("polygon").Select(Pt).ToList(),
        r.Str("floor_material"),
        r.Str("room_type"));

    public static Column ParseColumn(JsonObject c) => new(
        c.Str("id") ?? "", Pt(c["center"]), Num(c, "width", 0.3), Num(c, "depth", 0.3), Num(c, "rotation", 0), Bool(c, "round"));

    public static Stair ParseStair(JsonObject s) => new(
        s.Str("id") ?? "", Pt(s["start"]), Pt(s["end"]), Num(s, "width", 1), (int)Num(s, "steps", 16), Num(s, "riser", 0.17), Num(s, "base", 0), s.Str("to_level_id"));

    public static Furniture ParseFurniture(JsonObject f) => new(
        f.Str("id") ?? "", f.Str("catalog_id") ?? "", Pt(f["position"]), Num(f, "width", 0.5), Num(f, "depth", 0.5), Num(f, "height", 0.8), Num(f, "rotation", 0));

    private static Point2 Pt(JsonNode? n) => n is JsonObject o ? new Point2(Num(o, "x", 0), Num(o, "y", 0)) : default;

    private static double Num(JsonObject? o, string key, double fallback)
    {
        if (o is null || !o.TryGetPropertyValue(key, out var v) || v is not JsonValue jv) return fallback;
        return jv.GetValueKind() == JsonValueKind.Number ? JsonUtil.AsDouble(jv) : fallback;
    }

    private static bool Bool(JsonObject o, string key) =>
        o.TryGetPropertyValue(key, out var v) && v is JsonValue jv && jv.GetValueKind() == JsonValueKind.True;
}

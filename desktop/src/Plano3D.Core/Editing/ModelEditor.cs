using System.Text.Json;
using System.Text.Json.Nodes;
using Plano3D.Core.Json;
using Plano3D.Core.Model;
using Plano3D.Core.Ops;

namespace Plano3D.Core.Editing;

/// <summary>La edición pedida no tiene sentido (muro de largo cero, puerta que no cabe…). El mensaje es para la persona.</summary>
public sealed class EditException(string message) : Exception(message);

/// <summary>Dónde vive una entidad del modelo JSON: su piso, su tipo y, si es abertura, su muro.</summary>
public sealed record Found(JsonObject Level, string Kind, JsonObject Entity, JsonObject? Wall);

/// <summary>
/// Ediciones del modelo (patrón Command sin estado: cada función recibe el modelo y devuelve
/// una copia cambiada). Trabaja sobre el JSON para no perder campos que este cliente no
/// conoce; el envío a la sala lo hace <c>LiveDocument.Edit</c>, que compara y arma las ops.
/// Mismas reglas que <c>frontend/src/domain/commands.ts</c>.
/// </summary>
public static class ModelEditor
{
    public const double MinWall = 0.05;
    public static readonly (double Width, double Height, double Sill) Door = (0.9, 2.1, 0);
    public static readonly (double Width, double Height, double Sill) Window = (1.2, 1.2, 0.9);

    // ------------------------------------------------------------------ utilidades
    public static string NewId(string prefix) => $"{prefix}_{Guid.NewGuid():N}"[..(prefix.Length + 11)];

    public static double R(double v) => Math.Round(v, 4);

    public static JsonObject P(Point2 p) => new() { ["x"] = R(p.X), ["y"] = R(p.Y) };

    public static Point2 Pt(JsonNode? n) => n is JsonObject o ? new Point2(Num(o, "x"), Num(o, "y")) : default;

    public static double Num(JsonObject o, string key, double fallback = 0) =>
        o[key] is JsonValue v && v.GetValueKind() == JsonValueKind.Number ? JsonUtil.AsDouble(v) : fallback;

    private static JsonObject Clone(JsonObject model) => (JsonObject)model.DeepClone();

    public static JsonObject LevelOf(JsonObject model, string levelId) =>
        model.Items("levels").OfType<JsonObject>().FirstOrDefault(l => l.Str("id") == levelId)
        ?? throw new EditException("Ese piso ya no existe");

    private static JsonArray List(JsonObject owner, string key)
    {
        if (owner[key] is not JsonArray arr)
        {
            arr = new JsonArray();
            owner[key] = arr;
        }
        return arr;
    }

    /// <summary>Busca cualquier entidad por id (también las aberturas dentro de su muro).</summary>
    public static Found? Find(JsonObject model, string id)
    {
        foreach (var level in model.Items("levels").OfType<JsonObject>())
        {
            foreach (var (kind, key) in ModelOps.Collections)
                foreach (var e in level.Items(key).OfType<JsonObject>())
                    if (e.Str("id") == id) return new Found(level, kind, e, null);
            foreach (var w in level.Items("walls").OfType<JsonObject>())
                foreach (var o in w.Items("openings").OfType<JsonObject>())
                    if (o.Str("id") == id) return new Found(level, "opening", o, w);
        }
        return null;
    }

    private static Found Require(JsonObject model, string id) => Find(model, id) ?? throw new EditException("Eso ya no existe (quizá otra persona lo borró)");

    private static double WallLength(JsonObject w) => (Pt(w["end"]) - Pt(w["start"])).Length;

    /// <summary>Recorta las aberturas al nuevo largo del muro (las que ya no caben se quitan).</summary>
    private static void FitOpenings(JsonObject w)
    {
        var len = WallLength(w);
        var kept = new JsonArray();
        foreach (var o in w.Items("openings").OfType<JsonObject>())
        {
            var width = Num(o, "width");
            if (width > len + 1e-6) continue;
            o["offset"] = R(Math.Clamp(Num(o, "offset"), 0, Math.Max(0, len - width)));
            kept.Add(o.DeepClone());
        }
        w["openings"] = kept;
        if (w.ContainsKey("length")) w["length"] = R(len);
    }

    // ------------------------------------------------------------------ agregar
    public static (JsonObject Model, string Id) AddWall(JsonObject model, string levelId, Point2 a, Point2 b, double thickness = 0.15, double? height = null)
    {
        if (Snapping.Distance(a, b) < MinWall) throw new EditException("El muro es demasiado corto");
        var m = Clone(model);
        var lv = LevelOf(m, levelId);
        var id = NewId("w");
        List(lv, "walls").Add(new JsonObject
        {
            ["id"] = id,
            ["start"] = P(a),
            ["end"] = P(b),
            ["thickness"] = R(thickness),
            ["height"] = R(height ?? Num(lv, "height", 2.6)),
            ["material"] = "plaster",
            ["openings"] = new JsonArray(),
            ["confidence"] = 1,
        });
        return (m, id);
    }

    /// <summary>Dónde cabe una abertura de ese ancho centrada cerca de <paramref name="center"/> (m a lo largo del muro).</summary>
    public static (double Offset, bool Ok) Place(Wall wall, double width, double center, string? ignoreId = null, double step = 0.05)
    {
        var len = wall.Length;
        var offset = center - width / 2;
        if (step > 0) offset = Math.Round(offset / step) * step;
        offset = Math.Clamp(offset, 0, Math.Max(0, len - width));
        var ok = width <= len + 1e-6 && !wall.OpeningsOrEmpty.Any(o => o.Id != ignoreId && offset < o.Offset + o.Width - 1e-6 && o.Offset < offset + width - 1e-6);
        return (offset, ok);
    }

    public static (JsonObject Model, string Id) AddOpening(JsonObject model, string wallId, string kind, double center)
    {
        var m = Clone(model);
        var found = Require(m, wallId);
        if (found.Kind != "wall") throw new EditException("Las puertas y ventanas van sobre un muro");
        var wall = BuildingModel.ParseWall(found.Entity);
        var spec = kind == "window" ? Window : Door;
        var width = Math.Min(spec.Width, wall.Length * 0.9);
        var (offset, ok) = Place(wall, width, center);
        if (!ok) throw new EditException("No cabe ahí: choca con otra puerta o ventana");
        var id = NewId("op");
        List(found.Entity, "openings").Add(new JsonObject
        {
            ["id"] = id,
            ["kind"] = kind,
            ["offset"] = R(offset),
            ["width"] = R(width),
            ["height"] = spec.Height,
            ["sill"] = spec.Sill,
            ["confidence"] = 1,
        });
        return (m, id);
    }

    public static (JsonObject Model, string Id) AddFurniture(JsonObject model, string levelId, string catalogId, Point2 position, double rotation = 0)
    {
        var item = Catalog.Item(catalogId) ?? throw new EditException($"No existe la pieza «{catalogId}» en el catálogo");
        var m = Clone(model);
        var id = NewId("f");
        List(LevelOf(m, levelId), "furniture").Add(new JsonObject
        {
            ["id"] = id,
            ["catalog_id"] = item.Id,
            ["position"] = P(position),
            ["width"] = item.Width,
            ["depth"] = item.Depth,
            ["height"] = item.Height,
            ["rotation"] = R(rotation),
        });
        return (m, id);
    }

    public static (JsonObject Model, string Id) AddRoom(JsonObject model, string levelId, IReadOnlyList<Point2> polygon, string label = "Ambiente")
    {
        if (polygon.Count < 3 || Math.Abs(Geometry.BuildingGeometry.SignedArea(polygon)) < 0.2)
            throw new EditException("Un ambiente necesita al menos tres puntos y algo de área");
        var m = Clone(model);
        var id = NewId("r");
        List(LevelOf(m, levelId), "rooms").Add(new JsonObject
        {
            ["id"] = id,
            ["label"] = label,
            ["polygon"] = new JsonArray(polygon.Select(p => (JsonNode)P(p)).ToArray()),
            ["confidence"] = 1,
        });
        return (m, id);
    }

    public static (JsonObject Model, string Id) AddColumn(JsonObject model, string levelId, Point2 center, double size = 0.3)
    {
        var m = Clone(model);
        var id = NewId("c");
        List(LevelOf(m, levelId), "columns").Add(new JsonObject
        {
            ["id"] = id,
            ["center"] = P(center),
            ["width"] = size,
            ["depth"] = size,
            ["round"] = false,
            ["rotation"] = 0.0,
            ["confidence"] = 1,
        });
        return (m, id);
    }

    // ------------------------------------------------------------------ borrar
    public static JsonObject Delete(JsonObject model, IEnumerable<string> ids)
    {
        var m = Clone(model);
        foreach (var id in ids.Distinct())
        {
            if (Find(m, id) is not { } f) continue;
            if (f.Wall is { } w)
            {
                w["openings"] = new JsonArray(w.Items("openings").Where(o => o.Str("id") != id).Select(o => o!.DeepClone()).ToArray());
                continue;
            }
            var key = ModelOps.Collections[f.Kind];
            f.Level[key] = new JsonArray(f.Level.Items(key).Where(e => e.Str("id") != id).Select(e => e!.DeepClone()).ToArray());
        }
        return m;
    }

    // ------------------------------------------------------------------ mover, girar, reflejar
    private delegate Point2 PointMap(Point2 p);

    /// <summary>Aplica una transformación a los puntos de cada entidad (y ajusta el giro de muebles y columnas).</summary>
    private static void MapEntity(Found f, PointMap map, Func<double, double> rotate, bool reverseRooms = false)
    {
        var e = f.Entity;
        switch (f.Kind)
        {
            case "furniture":
                e["position"] = P(map(Pt(e["position"])));
                e["rotation"] = R(Normalize(rotate(Num(e, "rotation"))));
                break;
            case "column":
                e["center"] = P(map(Pt(e["center"])));
                e["rotation"] = R(Normalize(rotate(Num(e, "rotation"))));
                break;
            case "wall":
            case "stair":
            case "dimension":
                foreach (var key in new[] { "start", "end" })
                    if (e[key] is JsonObject) e[key] = P(map(Pt(e[key])));
                break;
            case "room":
                var pts = e.Items("polygon").Select(p => map(Pt(p))).ToList();
                if (reverseRooms) pts.Reverse();
                e["polygon"] = new JsonArray(pts.Select(p => (JsonNode)P(p)).ToArray());
                if (e["centroid"] is JsonObject) e["centroid"] = P(Shapes.Centroid(pts));
                break;
            case "label":
                if (e["position"] is JsonObject) e["position"] = P(map(Pt(e["position"])));
                break;
        }
    }

    private static double Normalize(double a)
    {
        a %= 2 * Math.PI;
        if (a > Math.PI) a -= 2 * Math.PI;
        if (a <= -Math.PI) a += 2 * Math.PI;
        return a;
    }

    /// <summary>Punto de referencia de una entidad (para girar y reflejar grupos).</summary>
    private static Point2 Anchor(Found f) => f.Kind switch
    {
        "furniture" or "label" => Pt(f.Entity["position"]),
        "column" => Pt(f.Entity["center"]),
        "room" => Shapes.Centroid(f.Entity.Items("polygon").Select(Pt).ToList()),
        _ => (Pt(f.Entity["start"]) + Pt(f.Entity["end"])) * 0.5,
    };

    public static JsonObject Translate(JsonObject model, IEnumerable<string> ids, Point2 delta)
    {
        var m = Clone(model);
        foreach (var id in ids.Distinct())
        {
            if (Find(m, id) is not { } f) continue;
            if (f.Kind == "opening")
            {
                // una abertura solo corre a lo largo de su muro
                var wall = BuildingModel.ParseWall(f.Wall!);
                var along = delta.X * wall.Direction.X + delta.Y * wall.Direction.Y;
                var width = Num(f.Entity, "width");
                var (offset, ok) = Place(wall, width, Num(f.Entity, "offset") + width / 2 + along, id, 0);
                if (ok) f.Entity["offset"] = R(offset);
                continue;
            }
            MapEntity(f, p => p + delta, r => r);
        }
        return m;
    }

    /// <summary>Gira alrededor del centro del grupo (uno solo gira sobre sí mismo).</summary>
    public static JsonObject Rotate(JsonObject model, IEnumerable<string> ids, double delta)
    {
        var m = Clone(model);
        var found = ids.Distinct().Select(id => Find(m, id)).OfType<Found>().Where(f => f.Kind != "opening").ToList();
        if (found.Count == 0) return m;
        var center = Shapes.Centroid(found.Select(Anchor).ToList());
        var c = Math.Cos(delta);
        var s = Math.Sin(delta);
        Point2 Map(Point2 p)
        {
            var r = p - center;
            return center + new Point2(r.X * c - r.Y * s, r.X * s + r.Y * c);
        }
        foreach (var f in found) MapEntity(f, Map, r => r + delta);
        return m;
    }

    /// <summary>Refleja el grupo sobre un eje vertical (<paramref name="acrossX"/>) u horizontal que pasa por su centro.</summary>
    public static JsonObject Mirror(JsonObject model, IEnumerable<string> ids, bool acrossX = true)
    {
        var m = Clone(model);
        var found = ids.Distinct().Select(id => Find(m, id)).OfType<Found>().Where(f => f.Kind != "opening").ToList();
        if (found.Count == 0) return m;
        var center = Shapes.Centroid(found.Select(Anchor).ToList());
        Point2 Map(Point2 p) => acrossX ? new Point2(2 * center.X - p.X, p.Y) : new Point2(p.X, 2 * center.Y - p.Y);
        foreach (var f in found) MapEntity(f, Map, r => acrossX ? Math.PI - r : -r, reverseRooms: true);
        return m;
    }

    /// <summary>Mueve un extremo de muro; con <paramref name="joint"/> arrastra también las esquinas unidas a él.</summary>
    public static JsonObject MoveWallPoint(JsonObject model, string wallId, bool end, Point2 to, bool joint = true)
    {
        var m = Clone(model);
        var f = Require(m, wallId);
        if (f.Kind != "wall") throw new EditException("Solo los muros tienen extremos");
        var key = end ? "end" : "start";
        var from = Pt(f.Entity[key]);
        var touched = new List<JsonObject>();
        foreach (var w in f.Level.Items("walls").OfType<JsonObject>())
            foreach (var k in new[] { "start", "end" })
                if (w == f.Entity ? k == key : joint && Snapping.Distance(Pt(w[k]), from) < 1e-3)
                {
                    w[k] = P(to);
                    touched.Add(w);
                }
        foreach (var w in touched.Distinct())
        {
            if (WallLength(w) < MinWall) throw new EditException("El muro quedaría de largo cero");
            FitOpenings(w);
        }
        return m;
    }

    // ------------------------------------------------------------------ propiedades
    /// <summary>
    /// Cambia un campo de una entidad (o de un piso, por su id) desde el panel de propiedades.
    /// Además de los campos del JSON entiende <c>x</c>/<c>y</c> (posición) y <c>length</c> (muro).
    /// </summary>
    public static JsonObject Patch(JsonObject model, string id, string field, JsonNode? value)
    {
        var m = Clone(model);
        if (m.Items("levels").OfType<JsonObject>().FirstOrDefault(l => l.Str("id") == id) is { } level)
        {
            if (field == "height" && value is JsonValue lv && JsonUtil.AsDouble(lv) < 1.8)
                throw new EditException("Un piso necesita al menos 1,80 m de alto");
            level[field] = value?.DeepClone();
            return m;
        }
        var f = Require(m, id);
        var e = f.Entity;
        double Number()
        {
            if (value is not JsonValue v || v.GetValueKind() != JsonValueKind.Number) throw new EditException("Se esperaba un número");
            return JsonUtil.AsDouble(v);
        }
        switch (field)
        {
            case "x" or "y":
                var key = f.Kind == "column" ? "center" : "position";
                var p = Pt(e[key]);
                e[key] = P(field == "x" ? p with { X = Number() } : p with { Y = Number() });
                break;
            case "length" when f.Kind == "wall":
                var len = Number();
                if (len < MinWall) throw new EditException("El muro es demasiado corto");
                var start = Pt(e["start"]);
                var dir = (Pt(e["end"]) - start).Normalized;
                // las esquinas unidas al extremo final se mueven con él
                return MoveWallPoint(m, id, true, start + dir * len);
            case "width" or "depth" or "height" or "thickness" or "sill":
                var n = Number();
                if (n < (field == "sill" ? 0 : 0.01)) throw new EditException("La medida debe ser positiva");
                e[field] = R(n);
                if (f.Kind == "opening" && field == "width")
                {
                    var wall = BuildingModel.ParseWall(f.Wall!);
                    var (offset, ok) = Place(wall, n, Num(e, "offset") + n / 2, id, 0);
                    if (!ok) throw new EditException("Con ese ancho choca con otra abertura o se sale del muro");
                    e["offset"] = R(offset);
                }
                break;
            default:
                e[field] = value?.DeepClone();
                break;
        }
        return m;
    }

    // ------------------------------------------------------------------ duplicar y repetir
    private static JsonObject Fresh(JsonObject e, string kind)
    {
        var copy = (JsonObject)e.DeepClone();
        copy["id"] = NewId(kind switch { "wall" => "w", "room" => "r", "column" => "c", "stair" => "s", "furniture" => "f", "opening" => "op", "dimension" => "dim", _ => "lb" });
        if (kind == "wall")
            copy["openings"] = new JsonArray(copy.Items("openings").OfType<JsonObject>().Select(o =>
            {
                var oc = (JsonObject)o.DeepClone();
                oc["id"] = NewId("op");
                return (JsonNode)oc;
            }).ToArray());
        return copy;
    }

    /// <summary>Copia las entidades corridas <paramref name="offset"/>; devuelve los ids nuevos.</summary>
    public static (JsonObject Model, List<string> Ids) Duplicate(JsonObject model, IEnumerable<string> ids, Point2 offset)
    {
        var m = Clone(model);
        var created = new List<string>();
        foreach (var id in ids.Distinct())
        {
            if (Find(m, id) is not { } f || f.Kind == "opening") continue;
            var copy = Fresh(f.Entity, f.Kind);
            List(f.Level, ModelOps.Collections[f.Kind]).Add(copy);
            MapEntity(new Found(f.Level, f.Kind, copy, null), p => p + offset, r => r);
            created.Add(copy.Str("id")!);
        }
        return (m, created);
    }

    /// <summary>Repite una puerta o ventana a lo largo de su muro (matriz), mientras quepa.</summary>
    public static (JsonObject Model, List<string> Ids) ArrayOpening(JsonObject model, string openingId, int count, double gap)
    {
        var m = Clone(model);
        var f = Require(m, openingId);
        if (f.Kind != "opening") throw new EditException("Elige una puerta o ventana para repetirla");
        var created = new List<string>();
        var step = Num(f.Entity, "width") + Math.Max(0, gap);
        for (var i = 1; i < count; i++)
        {
            var wall = BuildingModel.ParseWall(f.Wall!);
            var offset = Num(f.Entity, "offset") + step * i;
            var width = Num(f.Entity, "width");
            if (offset + width > wall.Length + 1e-6) break;
            var (_, ok) = Place(wall, width, offset + width / 2, null, 0);
            if (!ok) break;
            var copy = Fresh(f.Entity, "opening");
            copy["offset"] = R(offset);
            List(f.Wall!, "openings").Add(copy);
            created.Add(copy.Str("id")!);
        }
        if (created.Count == 0) throw new EditException("No cabe ninguna copia más en ese muro");
        return (m, created);
    }

    /// <summary>Copia un piso entero encima del último (muros, ambientes, columnas y muebles).</summary>
    public static (JsonObject Model, string LevelId) DuplicateLevel(JsonObject model, string levelId)
    {
        var m = Clone(model);
        var source = LevelOf(m, levelId);
        var levels = List(m, "levels");
        var top = levels.OfType<JsonObject>().Max(l => Num(l, "elevation") + Num(l, "height", Geometry.BuildingGeometry.DefaultStorey));
        var id = NewId("lvl");
        var copy = new JsonObject
        {
            ["id"] = id,
            ["name"] = $"Piso {levels.Count + 1}",
            ["elevation"] = R(top),
            ["height"] = Num(source, "height", Geometry.BuildingGeometry.DefaultStorey),
        };
        foreach (var (kind, key) in new[] { ("wall", "walls"), ("room", "rooms"), ("column", "columns"), ("furniture", "furniture") })
            copy[key] = new JsonArray(source.Items(key).OfType<JsonObject>().Select(e => (JsonNode)Fresh(e, kind)).ToArray());
        foreach (var key in new[] { "stairs", "dimensions", "labels" }) copy[key] = new JsonArray();
        levels.Add(copy);
        return (m, id);
    }

    public static JsonObject DeleteLevel(JsonObject model, string levelId)
    {
        var m = Clone(model);
        var levels = List(m, "levels");
        if (levels.Count <= 1) throw new EditException("La casa necesita al menos un piso");
        LevelOf(m, levelId);
        m["levels"] = new JsonArray(levels.Where(l => l.Str("id") != levelId).Select(l => l!.DeepClone()).ToArray());
        return m;
    }
}

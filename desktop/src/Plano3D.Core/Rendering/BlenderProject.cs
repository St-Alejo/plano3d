using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Plano3D.Core.Geometry;
using Plano3D.Core.Lighting;
using Plano3D.Core.Model;

namespace Plano3D.Core.Rendering;

/// <summary>
/// <c>proyecto.json</c> del paquete para Blender (versión 1): cámaras, sol, lámparas, pisos y
/// la calle frente a la fachada. Es el mismo contrato que arma la web
/// (<c>blenderPackage.ts</c>) y que lee <c>arquitectura.py</c>, así el script es uno solo.
/// Coordenadas de Blender: (x, −y del plano, altura).
/// </summary>
public static partial class BlenderProject
{
    /// <summary>Sol por defecto: 10 de la mañana de un día de marzo en Bogotá.</summary>
    public static readonly SunPosition DefaultSun = new(52, 105);

    private const int MaxInteriorsPerFloor = 2;

    [GeneratedRegex("ba[ñn]o|escalera|pasillo|hall|parqueadero|garaje|ropas|patio|dep[oó]sito|closet|vest[ií]er", RegexOptions.IgnoreCase)]
    private static partial Regex NoInterior();

    public sealed record Floor(int Number, string Name, string Id, double Elevation, double Height)
    {
        public string Collection => $"Piso {Number}";
    }

    /// <summary>Pisos de abajo hacia arriba, numerados desde 1 (como en la web).</summary>
    public static List<Floor> Floors(BuildingModel model) =>
        model.Levels.OrderBy(l => l.Elevation)
            .Select((l, i) => new Floor(i + 1, l.Name, l.Id, l.Elevation, l.Height ?? 2.6))
            .ToList();

    /// <summary>
    /// El JSON del proyecto. <paramref name="top"/> es la altura real de la escena (con
    /// antepecho y cubierta); sin ella se estima con el entrepiso del último piso.
    /// </summary>
    public static JsonObject Build(BuildingModel model, string name, SunPosition? sun = null, double? top = null)
    {
        var floors = Floors(model);
        var (min, max) = PlanBounds(model);
        var c = new Point2((min.X + max.X) / 2, (min.Y + max.Y) / 2);
        var s = Math.Max(Math.Max(max.X - min.X, max.Y - min.Y), 1);
        var height = top ?? (floors.Count > 0 ? floors[^1].Elevation + floors[^1].Height : 2.5);
        var ground = model.Levels.OrderBy(l => l.Elevation).FirstOrDefault();
        var f = (ground is null ? null : FrontNormal(ground)) ?? new Point2(0, 1);
        var side = new Point2(-f.Y, f.X);
        Point2 At(double along, double across) => c + f * along + side * across;

        var half = Math.Abs(f.X) * ((max.X - min.X) / 2) + Math.Abs(f.Y) * ((max.Y - min.Y) / 2);
        var width = Math.Abs(side.X) * (max.X - min.X) + Math.Abs(side.Y) * (max.Y - min.Y);
        var cameras = new JsonArray
        {
            Cam("Fachada principal", At(half + Math.Max(10, height * 2), 0), 1.6, c, 1.6, 28, true),
            Cam("Calle (altura de ojos)", At(half + Math.Max(7, height * 1.4), s * 0.45), 1.6, At(0, -s * 0.1), 1.6, 24, true),
            Cam("Aérea 3/4", At(s * 1.25, s * 1.05), height + s * 0.9, c, height * 0.4, 35, false),
        };
        foreach (var l in floors)
        {
            var plan = Cam($"Planta {(string.IsNullOrEmpty(l.Name) ? $"Piso {l.Number}" : l.Name)}", c, l.Elevation + l.Height + 12, c, l.Elevation, 0, false);
            plan["ortho_scale"] = R3(Math.Max(max.X - min.X, (max.Y - min.Y) * 16 / 9) * 1.12);
            plan["floor"] = l.Number;
            plan["lines"] = true;
            cameras.Add(plan);
        }
        var elevation = Cam("Alzado frontal", At(half + 40, 0), height / 2, c, height / 2, 0, false);
        elevation["ortho_scale"] = R3(Math.Max(width, height * 16 / 9) * 1.2);
        elevation["lines"] = true;
        cameras.Add(elevation);
        foreach (var cam in InteriorCameras(model, floors)) cameras.Add(cam);

        var sp = sun is { Altitude: > 2 } ? sun.Value : DefaultSun;
        var (dx, dy, dz) = Sun.Direction(sp);
        var lamps = new JsonArray();
        foreach (var level in model.Levels)
        {
            var floor = floors.FirstOrDefault(x => x.Id == level.Id);
            var ceiling = level.Elevation + (level.Walls.Count > 0 ? level.Walls.Max(w => w.Height) : level.Height ?? 2.6);
            foreach (var r in level.Rooms.Where(r => r.Polygon.Count >= 3))
            {
                var area = Math.Abs(BuildingGeometry.SignedArea(r.Polygon));
                if (area < 1.5) continue;
                var p = Centroid(r.Polygon);
                lamps.Add(new JsonObject
                {
                    ["room"] = r.Label,
                    ["collection"] = floor?.Collection ?? "General",
                    ["location"] = Bl(p.X, p.Y, ceiling - 0.12),
                    ["area"] = R3(area),
                });
            }
        }

        return new JsonObject
        {
            ["version"] = 1,
            ["name"] = name,
            ["units"] = "m",
            ["height"] = R3(height),
            ["floors"] = new JsonArray(floors.Select(l => (JsonNode)new JsonObject
            {
                ["number"] = l.Number,
                ["name"] = l.Name,
                ["collection"] = l.Collection,
                ["elevation"] = R3(l.Elevation),
                ["height"] = R3(l.Height),
            }).ToArray()),
            ["cameras"] = cameras,
            ["sun"] = new JsonObject
            {
                ["direction"] = new JsonArray(R3(dx), R3(-dz), R3(dy)),
                ["altitude"] = R3(sp.Altitude),
                ["azimuth"] = R3(sp.Azimuth),
            },
            ["lamps"] = lamps,
            ["facade"] = new JsonObject { ["style"] = model.Facade, ["custom"] = model.FacadeCustom },
            ["site"] = new JsonObject
            {
                ["center"] = new JsonArray(R3(c.X), R3(-c.Y)),
                ["front"] = new JsonArray(R3(f.X), R3(-f.Y)),
                ["side"] = new JsonArray(R3(side.X), R3(-side.Y)),
                ["depth"] = R3(half),
                ["width"] = R3(width),
                ["gates"] = ground is null ? new JsonArray() : Gates(ground, c, side),
            },
        };
    }

    /// <summary>
    /// Agrega una cámara tomada de una vista del editor (la actual o un marcador). Recibe
    /// coordenadas de la escena (x, y arriba, z = y del plano) y el campo de visión vertical;
    /// Blender usa un sensor de 36 mm a lo ancho, así que la focal sale del campo horizontal.
    /// </summary>
    public static JsonObject AddViewCamera(JsonObject project, string name, (double X, double Y, double Z) eye, (double X, double Y, double Z) target, double vfovDeg, double aspect = 16.0 / 9)
    {
        var h = 2 * Math.Atan(Math.Tan(vfovDeg * Math.PI / 360) * aspect);
        var cam = new JsonObject
        {
            ["name"] = name,
            ["location"] = new JsonArray(R3(eye.X), R3(-eye.Z), R3(eye.Y)),
            ["target"] = new JsonArray(R3(target.X), R3(-target.Z), R3(target.Y)),
            ["lens"] = R3(18 / Math.Tan(h / 2)),
            ["level"] = false,
        };
        if (project["cameras"] is not JsonArray cams) project["cameras"] = cams = [];
        cams.Insert(0, cam);
        return cam;
    }

    /// <summary>Nombres de las cámaras (para elegir cuáles renderizar).</summary>
    public static List<string> CameraNames(JsonObject project) =>
        (project["cameras"] as JsonArray ?? []).OfType<JsonObject>().Select(c => (string?)c["name"] ?? "").ToList();

    // ------------------------------------------------------------------ cámaras interiores
    /// <summary>
    /// Vista a la altura de los ojos en los ambientes principales de cada piso: desde la esquina
    /// más despejada, 0,6 m hacia adentro, mirando a la esquina opuesta.
    /// </summary>
    private static IEnumerable<JsonObject> InteriorCameras(BuildingModel model, List<Floor> floors)
    {
        foreach (var l in floors)
        {
            var lv = model.FindLevel(l.Id)!;
            var rooms = lv.Rooms
                .Where(r => r.Polygon.Count >= 3 && Math.Abs(BuildingGeometry.SignedArea(r.Polygon)) >= 9 && !NoInterior().IsMatch(r.Label))
                .OrderByDescending(r => Math.Abs(BuildingGeometry.SignedArea(r.Polygon)))
                .Take(MaxInteriorsPerFloor);
            foreach (var r in rooms)
            {
                var x0 = r.Polygon.Min(p => p.X);
                var x1 = r.Polygon.Max(p => p.X);
                var y0 = r.Polygon.Min(p => p.Y);
                var y1 = r.Polygon.Max(p => p.Y);
                var c = new Point2((x0 + x1) / 2, (y0 + y1) / 2);
                (Point2 At, Point2 Far, double Free)? best = null;
                foreach (var k in new[] { new Point2(x0, y0), new Point2(x1, y0), new Point2(x1, y1), new Point2(x0, y1) })
                {
                    var len = (c - k).Length;
                    var at = k + (c - k) * (0.6 / len);
                    if (!Inside(at, r.Polygon)) continue;
                    var free = lv.Furniture.Select(f => (f.Position - at).Length - Math.Sqrt(f.Width * f.Width + f.Depth * f.Depth) / 2).Append(10).Min();
                    if (best is null || free > best.Value.Free) best = (at, c * 2 - k, free);
                }
                if (best is not { } b) continue;
                var cam = Cam($"Interior {TitleCase(r.Label)} (Piso {l.Number})", b.At, l.Elevation + 1.45, b.Far, l.Elevation + 1.2, 16, true);
                cam["interior"] = true;
                yield return cam;
            }
        }
    }

    // ------------------------------------------------------------------ calle y portones
    /// <summary>Hacia la calle: la normal exterior del primer muro de fachada con portón.</summary>
    public static Point2? FrontNormal(Level ground)
    {
        foreach (var w in ground.Walls)
        {
            if (!w.IsExterior || w.Bulge is not null and not 0) continue;
            if (!w.OpeningsOrEmpty.Any(o => o.IsGate)) continue;
            var n = LeftNormal(w);
            return n * OutwardSign(w, ground);
        }
        return null;
    }

    private static Point2 LeftNormal(Wall w)
    {
        var d = w.Direction;
        return new Point2(-d.Y, d.X);
    }

    /// <summary>+1 si afuera queda a la izquierda del muro: el lado que no cae en ningún ambiente.</summary>
    private static int OutwardSign(Wall w, Level lv)
    {
        var n = LeftNormal(w);
        var d = w.Direction;
        var reach = w.Thickness / 2 + 0.25;
        int Score(int sgn) => new[] { 0.25, 0.5, 0.75 }
            .Select(t => w.Start + d * (w.Length * t) + n * (reach * sgn))
            .Count(p => lv.Rooms.Any(r => Inside(p, r.Polygon)));
        var left = Score(1);
        var right = Score(-1);
        if (left != right) return left < right ? 1 : -1;
        var xs = lv.Walls.SelectMany(x => new[] { x.Start.X, x.End.X }).ToList();
        var ys = lv.Walls.SelectMany(x => new[] { x.Start.Y, x.End.Y }).ToList();
        var c = new Point2((xs.Min() + xs.Max()) / 2, (ys.Min() + ys.Max()) / 2);
        var mid = (w.Start + w.End) * 0.5;
        return (mid.X - c.X) * n.X + (mid.Y - c.Y) * n.Y >= 0 ? 1 : -1;
    }

    private static JsonArray Gates(Level ground, Point2 c, Point2 side)
    {
        var gates = new JsonArray();
        foreach (var w in ground.Walls.Where(w => w.IsExterior))
        {
            var d = w.Direction;
            foreach (var o in w.OpeningsOrEmpty.Where(o => o.IsGate))
            {
                var p = w.Start + d * (o.Offset + o.Width / 2);
                gates.Add(new JsonObject
                {
                    ["offset"] = R3((p.X - c.X) * side.X + (p.Y - c.Y) * side.Y),
                    ["width"] = R3(o.Width),
                });
            }
        }
        return gates;
    }

    // ------------------------------------------------------------------ utilidades
    /// <summary>Caja de muros y ambientes (como <c>modelBounds</c> de la web).</summary>
    public static (Point2 Min, Point2 Max) PlanBounds(BuildingModel model)
    {
        var pts = model.Levels.SelectMany(l => l.Walls.SelectMany(w => new[] { w.Start, w.End }).Concat(l.Rooms.SelectMany(r => r.Polygon))).ToList();
        if (pts.Count == 0) return (new Point2(0, 0), new Point2(1, 1));
        return (new Point2(pts.Min(p => p.X), pts.Min(p => p.Y)), new Point2(pts.Max(p => p.X), pts.Max(p => p.Y)));
    }

    private static JsonObject Cam(string name, Point2 at, double h, Point2 target, double th, double lens, bool level) => new()
    {
        ["name"] = name,
        ["location"] = Bl(at.X, at.Y, h),
        ["target"] = Bl(target.X, target.Y, th),
        ["lens"] = lens,
        ["level"] = level,
    };

    private static JsonArray Bl(double x, double y, double h) => new(R3(x), R3(-y), R3(h));

    private static double R3(double v)
    {
        var r = Math.Round(v * 1000, MidpointRounding.AwayFromZero) / 1000;
        return r == 0 ? 0 : r; // sin −0
    }

    public static bool Inside(Point2 p, IReadOnlyList<Point2> poly)
    {
        var hit = false;
        for (int i = 0, j = poly.Count - 1; i < poly.Count; j = i++)
        {
            var a = poly[i];
            var b = poly[j];
            if (a.Y > p.Y != b.Y > p.Y && p.X < (b.X - a.X) * (p.Y - a.Y) / (b.Y - a.Y) + a.X) hit = !hit;
        }
        return hit;
    }

    /// <summary>Centroide de área del polígono (el de la web); si es degenerado, el promedio.</summary>
    public static Point2 Centroid(IReadOnlyList<Point2> pts)
    {
        double signed = 0, cx = 0, cy = 0;
        for (var i = 0; i < pts.Count; i++)
        {
            var a = pts[i];
            var b = pts[(i + 1) % pts.Count];
            var cross = a.X * b.Y - b.X * a.Y;
            signed += cross;
            cx += (a.X + b.X) * cross;
            cy += (a.Y + b.Y) * cross;
        }
        if (Math.Abs(signed) < 1e-12) return new Point2(pts.Average(p => p.X), pts.Average(p => p.Y));
        return new Point2(cx / (3 * signed), cy / (3 * signed));
    }

    /// <summary>"SALA COMEDOR" → "Sala comedor"; lo que ya trae minúsculas queda igual.</summary>
    public static string TitleCase(string s)
    {
        if (string.IsNullOrEmpty(s) || s != s.ToUpperInvariant() || s == s.ToLowerInvariant()) return s;
        var es = CultureInfo.GetCultureInfo("es");
        var lower = s.ToLower(es);
        return char.ToUpper(lower[0], es) + lower[1..];
    }
}

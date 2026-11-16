using Plano3D.Core.Model;

namespace Plano3D.Core.Geometry;

/// <summary>Punto 3D en metros. Convención de Godot: Y hacia arriba; el "y" del plano va a Z.</summary>
public readonly record struct Vec3(double X, double Y, double Z);

/// <summary>
/// Caja orientada: centro, tamaño (largo X, alto Y, grueso Z), giro sobre el eje vertical y,
/// si hace falta, inclinación del eje X local hacia arriba (pasamanos de una escalera).
/// </summary>
public readonly record struct Box(Vec3 Center, Vec3 Size, double Yaw, string Part, double Pitch = 0);

/// <summary>
/// Geometría del edificio sin motor gráfico (testeable con xUnit). El escritorio la convierte
/// en mallas de Godot; la web hace lo mismo con three.js en <c>SceneBuilder.ts</c>.
/// </summary>
public static class BuildingGeometry
{
    /// <summary>Altura de piso a piso si el nivel no la trae.</summary>
    public const double DefaultStorey = 2.6;
    public const double SlabThickness = 0.12;

    /// <summary>Giro sobre Y que lleva el eje X local a la dirección del muro en el plano.</summary>
    public static double YawOf(Point2 dir) => Math.Atan2(-dir.Y, dir.X);

    public static Vec3 To3D(Point2 p, double y) => new(p.X, y, p.Y);

    /// <summary>
    /// Un muro partido en cajas macizas: los tramos llenos entre aberturas, el antepecho bajo
    /// cada ventana y el dintel sobre cada puerta o ventana.
    /// </summary>
    public static List<Box> WallPieces(Wall wall, double elevation)
    {
        var boxes = new List<Box>();
        var len = wall.Length;
        if (len < 1e-6) return boxes;
        var dir = wall.Direction;
        var yaw = YawOf(dir);
        var h = wall.Height;
        var t = wall.Thickness;

        void Add(double from, double to, double y0, double y1, string part)
        {
            if (to - from < 1e-4 || y1 - y0 < 1e-4) return;
            var mid = wall.Start + dir * ((from + to) / 2);
            boxes.Add(new Box(To3D(mid, elevation + (y0 + y1) / 2), new Vec3(to - from, y1 - y0, t), yaw, part));
        }

        var cursor = 0.0;
        foreach (var o in wall.OpeningsOrEmpty.OrderBy(o => o.Offset))
        {
            var a = Math.Clamp(o.Offset, 0, len);
            var b = Math.Clamp(o.Offset + o.Width, 0, len);
            if (b <= cursor) continue;
            Add(cursor, a, 0, h, "solid");
            var sill = o.IsDoor ? 0 : Math.Clamp(o.Sill, 0, h);
            var top = Math.Clamp(sill + o.Height, sill, h);
            Add(Math.Max(a, cursor), b, 0, sill, "sill");
            Add(Math.Max(a, cursor), b, top, h, "lintel");
            cursor = Math.Max(cursor, b);
        }
        Add(cursor, len, 0, h, "solid");
        return boxes;
    }

    /// <summary>Hoja de puerta o vidrio de ventana dentro del vano.</summary>
    public static Box OpeningInfill(Wall wall, Opening o, double elevation)
    {
        var dir = wall.Direction;
        var mid = wall.Start + dir * (o.Offset + o.Width / 2);
        var sill = o.IsDoor ? 0 : o.Sill;
        var thick = o.IsDoor ? 0.04 : 0.02;
        return new Box(To3D(mid, elevation + sill + o.Height / 2), new Vec3(o.Width, o.Height, thick), YawOf(dir), o.IsDoor ? "door" : "glass");
    }

    /// <summary>
    /// Remates de un vano: marco (jambas y cabezal) y, en las ventanas, el alféizar que
    /// sobresale del muro. Es lo que hace que un hueco se lea como puerta o ventana.
    /// </summary>
    public static List<Box> OpeningTrim(Wall wall, Opening o, double elevation)
    {
        var boxes = new List<Box>();
        var dir = wall.Direction;
        var yaw = YawOf(dir);
        var t = wall.Thickness;
        var sill = o.IsDoor ? 0 : o.Sill;
        var top = sill + o.Height;
        var frame = o.IsDoor ? 0.06 : 0.05;
        var depth = o.IsDoor ? t + 0.02 : Math.Min(t, 0.08);
        var part = o.IsDoor ? "door_frame" : "window_frame";
        Point2 At(double along) => wall.Start + dir * along;
        // jambas
        boxes.Add(new Box(To3D(At(o.Offset + frame / 2), elevation + sill + o.Height / 2), new Vec3(frame, o.Height, depth), yaw, part));
        boxes.Add(new Box(To3D(At(o.Offset + o.Width - frame / 2), elevation + sill + o.Height / 2), new Vec3(frame, o.Height, depth), yaw, part));
        // cabezal
        boxes.Add(new Box(To3D(At(o.Offset + o.Width / 2), elevation + top - frame / 2), new Vec3(o.Width, frame, depth), yaw, part));
        if (!o.IsDoor)
        {
            boxes.Add(new Box(To3D(At(o.Offset + o.Width / 2), elevation + sill + frame / 2), new Vec3(o.Width, frame, depth), yaw, part));
            // alféizar: 5 cm a cada lado del vano y 4 cm hacia afuera de cada cara
            boxes.Add(new Box(To3D(At(o.Offset + o.Width / 2), elevation + sill - 0.02), new Vec3(o.Width + 0.1, 0.04, t + 0.08), yaw, "sill_stone"));
        }
        return boxes;
    }

    public static Box ColumnBox(Column c, double elevation, double height) =>
        new(To3D(c.Center, elevation + height / 2), new Vec3(c.Width, height, c.Depth), -c.Rotation, c.Round ? "round" : "column");

    public static Box FurnitureBox(Furniture f, double elevation) =>
        new(To3D(f.Position, elevation + f.Height / 2), new Vec3(f.Width, f.Height, f.Depth), -f.Rotation, f.CatalogId);

    /// <summary>Peldaños de una escalera recta: una caja por huella, subiendo hacia <c>End</c>.</summary>
    public static List<Box> StairSteps(Stair s, double elevation)
    {
        var steps = new List<Box>();
        var run = (s.End - s.Start).Length;
        if (run < 1e-6 || s.Steps <= 0) return steps;
        var dir = (s.End - s.Start).Normalized;
        var tread = run / s.Steps;
        for (var i = 0; i < s.Steps; i++)
        {
            var top = s.Base + s.Riser * (i + 1);
            var mid = s.Start + dir * (tread * (i + 0.5));
            steps.Add(new Box(To3D(mid, elevation + top / 2), new Vec3(tread, top, s.Width), YawOf(dir), "step"));
        }
        return steps;
    }

    /// <summary>
    /// Baranda de una escalera por su lado derecho (mirando hacia arriba): parales cada
    /// ~0,9 m y un pasamanos inclinado a 0,9 m sobre la nariz de los peldaños.
    /// </summary>
    public static List<Box> StairRailing(Stair s, double elevation, double height = 0.9)
    {
        var parts = new List<Box>();
        var runVec = s.End - s.Start;
        var run = runVec.Length;
        if (run < 1e-6 || s.Steps <= 0) return parts;
        var dir = runVec.Normalized;
        var side = new Point2(-dir.Y, dir.X) * (s.Width / 2 - 0.04);
        var tread = run / s.Steps;
        var rise = s.Riser * s.Steps;
        double StepTop(double along) => s.Base + s.Riser * Math.Clamp(Math.Ceiling(along / tread - 1e-9), 1, s.Steps);
        var posts = Math.Max(2, (int)Math.Ceiling(run / 0.9) + 1);
        for (var i = 0; i < posts; i++)
        {
            var along = Math.Clamp(run * i / (posts - 1), tread / 2, run - tread / 2);
            var floor = StepTop(along);
            var railY = s.Base + s.Riser + (rise - s.Riser) * (along / run) + height;
            var p = s.Start + dir * along + side;
            parts.Add(new Box(To3D(p, elevation + (floor + railY) / 2), new Vec3(0.03, railY - floor, 0.03), YawOf(dir), "post"));
        }
        var pitch = Math.Atan2(rise - s.Riser, run);
        var mid = s.Start + dir * (run / 2) + side;
        var midY = s.Base + s.Riser + (rise - s.Riser) / 2 + height;
        var length = Math.Sqrt(run * run + (rise - s.Riser) * (rise - s.Riser));
        parts.Add(new Box(To3D(mid, elevation + midY), new Vec3(length, 0.04, 0.05), YawOf(dir), "handrail", pitch));
        return parts;
    }

    /// <summary>Altura de cada nivel (lo declarado o la distancia al siguiente).</summary>
    public static double StoreyHeight(BuildingModel model, Level level)
    {
        if (level.Height is { } h and > 0.5) return h;
        var above = model.Levels.Where(l => l.Elevation > level.Elevation + 0.5).Select(l => l.Elevation - level.Elevation).DefaultIfEmpty(DefaultStorey).Min();
        return above;
    }

    // ------------------------------------------------------------------ polígonos
    public static double SignedArea(IReadOnlyList<Point2> poly)
    {
        double a = 0;
        for (var i = 0; i < poly.Count; i++)
        {
            var p = poly[i];
            var q = poly[(i + 1) % poly.Count];
            a += p.X * q.Y - q.X * p.Y;
        }
        return a / 2;
    }

    /// <summary>
    /// Triangulación por recorte de orejas (polígonos simples, cóncavos incluidos).
    /// Devuelve índices de a tres, en sentido antihorario del plano.
    /// </summary>
    public static List<int> Triangulate(IReadOnlyList<Point2> poly)
    {
        var result = new List<int>();
        var n = poly.Count;
        if (n < 3) return result;
        var idx = Enumerable.Range(0, n).ToList();
        if (SignedArea(poly) < 0) idx.Reverse();
        var guard = 0;
        while (idx.Count > 3 && guard++ < n * n)
        {
            var clipped = false;
            for (var i = 0; i < idx.Count; i++)
            {
                int ia = idx[(i - 1 + idx.Count) % idx.Count], ib = idx[i], ic = idx[(i + 1) % idx.Count];
                var a = poly[ia];
                var b = poly[ib];
                var c = poly[ic];
                if (Cross(a, b, c) <= 1e-12) continue; // vértice reflejo
                var inside = false;
                foreach (var j in idx)
                {
                    if (j == ia || j == ib || j == ic) continue;
                    if (InTriangle(poly[j], a, b, c))
                    {
                        inside = true;
                        break;
                    }
                }
                if (inside) continue;
                result.AddRange([ia, ib, ic]);
                idx.RemoveAt(i);
                clipped = true;
                break;
            }
            if (!clipped) break; // polígono degenerado: se deja lo triangulado
        }
        if (idx.Count == 3) result.AddRange([idx[0], idx[1], idx[2]]);
        return result;
    }

    private static double Cross(Point2 a, Point2 b, Point2 c) => (b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X);

    private static bool InTriangle(Point2 p, Point2 a, Point2 b, Point2 c) =>
        Cross(a, b, p) >= 0 && Cross(b, c, p) >= 0 && Cross(c, a, p) >= 0;

    /// <summary>Caja que encierra todos los muros (para encuadrar la cámara).</summary>
    public static (Point2 Min, Point2 Max) Bounds(BuildingModel model)
    {
        var pts = model.Levels.SelectMany(l => l.Walls.SelectMany(w => new[] { w.Start, w.End })).ToList();
        if (pts.Count == 0) return (new Point2(0, 0), new Point2(10, 10));
        return (new Point2(pts.Min(p => p.X), pts.Min(p => p.Y)), new Point2(pts.Max(p => p.X), pts.Max(p => p.Y)));
    }
}

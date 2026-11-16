using Plano3D.Core.Model;

namespace Plano3D.Core.Editing;

/// <summary>Qué hay bajo el cursor en la planta: tipo de entidad (como en las ops) e id.</summary>
public sealed record Hit(string Kind, string Id);

/// <summary>Contornos en planta de cada entidad (para dibujar y para elegir con el mouse).</summary>
public static class Shapes
{
    /// <summary>Esquinas de un rectángulo girado: ancho sobre (cos θ, sin θ), fondo sobre la perpendicular.</summary>
    public static Point2[] Rect(Point2 center, double width, double depth, double rotation)
    {
        var u = new Point2(Math.Cos(rotation), Math.Sin(rotation));
        var v = new Point2(-u.Y, u.X);
        var hw = width / 2;
        var hd = depth / 2;
        return
        [
            center - u * hw - v * hd,
            center + u * hw - v * hd,
            center + u * hw + v * hd,
            center - u * hw + v * hd,
        ];
    }

    public static Point2[] Furniture(Furniture f) => Rect(f.Position, f.Width, f.Depth, f.Rotation);

    public static Point2[] Column(Column c) => Rect(c.Center, c.Width, c.Depth, c.Rotation);

    public static Point2[] Stair(Stair s)
    {
        var run = (s.End - s.Start).Length;
        var dir = (s.End - s.Start).Normalized;
        return Rect(s.Start + dir * (run / 2), run, s.Width, Math.Atan2(dir.Y, dir.X));
    }

    /// <summary>Las cuatro esquinas del cuerpo de un muro.</summary>
    public static Point2[] Wall(Wall w)
    {
        var dir = w.Direction;
        return Rect(w.Start + dir * (w.Length / 2), w.Length, w.Thickness, Math.Atan2(dir.Y, dir.X));
    }

    /// <summary>Tramo del eje del muro que ocupa una abertura.</summary>
    public static (Point2 A, Point2 B) Opening(Wall w, Opening o)
    {
        var dir = w.Direction;
        return (w.Start + dir * o.Offset, w.Start + dir * (o.Offset + o.Width));
    }

    public static bool InRect(Point2 p, Point2 center, double width, double depth, double rotation, double tol = 0)
    {
        var rel = p - center;
        var c = Math.Cos(rotation);
        var s = Math.Sin(rotation);
        var u = rel.X * c + rel.Y * s;
        var v = -rel.X * s + rel.Y * c;
        return Math.Abs(u) <= width / 2 + tol && Math.Abs(v) <= depth / 2 + tol;
    }

    public static bool InPolygon(Point2 p, IReadOnlyList<Point2> poly)
    {
        var inside = false;
        for (int i = 0, j = poly.Count - 1; i < poly.Count; j = i++)
        {
            var a = poly[i];
            var b = poly[j];
            if ((a.Y > p.Y) != (b.Y > p.Y) && p.X < (b.X - a.X) * (p.Y - a.Y) / (b.Y - a.Y) + a.X) inside = !inside;
        }
        return inside;
    }

    public static double SegmentDistance(Point2 p, Point2 a, Point2 b)
    {
        var ab = b - a;
        var len2 = ab.X * ab.X + ab.Y * ab.Y;
        if (len2 < 1e-12) return (p - a).Length;
        var t = Math.Clamp(((p.X - a.X) * ab.X + (p.Y - a.Y) * ab.Y) / len2, 0, 1);
        return (p - (a + ab * t)).Length;
    }

    public static Point2 Centroid(IReadOnlyList<Point2> poly) =>
        poly.Count == 0 ? default : new Point2(poly.Average(p => p.X), poly.Average(p => p.Y));
}

/// <summary>
/// Elegir con el mouse en la planta. Gana lo más pequeño que esté encima: aberturas, muebles,
/// columnas, escaleras, muros y al final el ambiente (que ocupa todo el piso).
/// </summary>
public static class PlanHit
{
    public static Hit? At(Level level, Point2 p, double tol)
    {
        foreach (var w in level.Walls)
            foreach (var o in w.OpeningsOrEmpty)
            {
                var (a, b) = Shapes.Opening(w, o);
                if (Shapes.SegmentDistance(p, a, b) <= w.Thickness / 2 + tol) return new Hit("opening", o.Id);
            }
        // los muebles de arriba (los últimos en la lista) se dibujan encima: se eligen primero
        for (var i = level.Furniture.Count - 1; i >= 0; i--)
        {
            var f = level.Furniture[i];
            if (Shapes.InRect(p, f.Position, f.Width, f.Depth, f.Rotation, tol)) return new Hit("furniture", f.Id);
        }
        foreach (var c in level.Columns)
            if (Shapes.InRect(p, c.Center, c.Width, c.Depth, c.Rotation, tol)) return new Hit("column", c.Id);
        foreach (var s in level.Stairs)
            if (Shapes.InPolygon(p, Shapes.Stair(s))) return new Hit("stair", s.Id);
        Hit? wall = null;
        var best = double.MaxValue;
        foreach (var w in level.Walls)
        {
            var d = Shapes.SegmentDistance(p, w.Start, w.End);
            if (d <= w.Thickness / 2 + tol && d < best)
            {
                best = d;
                wall = new Hit("wall", w.Id);
            }
        }
        if (wall is not null) return wall;
        // el ambiente más pequeño que contiene el punto (los hay anidados)
        return level.Rooms
            .Where(r => r.Polygon.Count >= 3 && Shapes.InPolygon(p, r.Polygon))
            .OrderBy(r => Math.Abs(Geometry.BuildingGeometry.SignedArea(r.Polygon)))
            .Select(r => new Hit("room", r.Id))
            .FirstOrDefault();
    }

    /// <summary>Lo que queda entero dentro de un recuadro (selección por arrastre).</summary>
    public static List<Hit> InBox(Level level, Point2 a, Point2 b)
    {
        var min = new Point2(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y));
        var max = new Point2(Math.Max(a.X, b.X), Math.Max(a.Y, b.Y));
        bool Inside(IEnumerable<Point2> pts) => pts.All(p => p.X >= min.X && p.X <= max.X && p.Y >= min.Y && p.Y <= max.Y);
        var hits = new List<Hit>();
        hits.AddRange(level.Walls.Where(w => Inside([w.Start, w.End])).Select(w => new Hit("wall", w.Id)));
        hits.AddRange(level.Furniture.Where(f => Inside(Shapes.Furniture(f))).Select(f => new Hit("furniture", f.Id)));
        hits.AddRange(level.Columns.Where(c => Inside(Shapes.Column(c))).Select(c => new Hit("column", c.Id)));
        hits.AddRange(level.Stairs.Where(s => Inside(Shapes.Stair(s))).Select(s => new Hit("stair", s.Id)));
        hits.AddRange(level.Rooms.Where(r => r.Polygon.Count >= 3 && Inside(r.Polygon)).Select(r => new Hit("room", r.Id)));
        return hits;
    }
}

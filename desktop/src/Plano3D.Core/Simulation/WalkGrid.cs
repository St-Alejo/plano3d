using Plano3D.Core.Editing;
using Plano3D.Core.Geometry;
using Plano3D.Core.Model;

namespace Plano3D.Core.Simulation;

/// <summary>
/// Por dónde se puede caminar en un piso: una cuadrícula (celdas de <see cref="Cell"/> m) donde
/// los muros, columnas, muebles y escaleras ocupan espacio y las puertas dejan pasar. Busca
/// caminos con A* (8 vecinos, sin cortar esquinas) y los alisa con línea de vista. Es lo que
/// usan las personas de la simulación para ir de un ambiente a otro.
/// </summary>
public sealed class WalkGrid
{
    public double Cell { get; }
    public Point2 Origin { get; }
    public int Width { get; }
    public int Height { get; }
    private readonly bool[] _free;

    private WalkGrid(double cell, Point2 origin, int w, int h)
    {
        Cell = cell;
        Origin = origin;
        Width = w;
        Height = h;
        _free = new bool[w * h];
    }

    /// <param name="clearance">medio ancho de una persona: lo que se separa de muros y muebles</param>
    public static WalkGrid Build(Level level, double cell = 0.2, double clearance = 0.22)
    {
        var pts = level.Walls.SelectMany(w => new[] { w.Start, w.End }).Concat(level.Rooms.SelectMany(r => r.Polygon)).ToList();
        if (pts.Count == 0) pts = [new Point2(0, 0), new Point2(1, 1)];
        var min = new Point2(pts.Min(p => p.X) - 1, pts.Min(p => p.Y) - 1);
        var max = new Point2(pts.Max(p => p.X) + 1, pts.Max(p => p.Y) + 1);
        var w = (int)Math.Ceiling((max.X - min.X) / cell);
        var h = (int)Math.Ceiling((max.Y - min.Y) / cell);
        var g = new WalkGrid(cell, min, w, h);

        var solids = level.Columns.Select(Shapes.Column)
            .Concat(level.Furniture.Select(Shapes.Furniture))
            .Concat(level.Stairs.Select(Shapes.Stair))
            .Select(p => (Poly: p, Box: Bounds(p, clearance)))
            .ToList();

        for (var j = 0; j < h; j++)
        for (var i = 0; i < w; i++)
        {
            var p = g.Center(i, j);
            var free = !level.Walls.Any(wall => Blocks(wall, p, clearance));
            if (free)
                foreach (var (poly, box) in solids)
                {
                    if (p.X < box.Min.X || p.X > box.Max.X || p.Y < box.Min.Y || p.Y > box.Max.Y) continue;
                    if (Shapes.InPolygon(p, poly) || EdgeDistance(p, poly) < clearance)
                    {
                        free = false;
                        break;
                    }
                }
            g._free[j * w + i] = free;
        }
        return g;
    }

    private static (Point2 Min, Point2 Max) Bounds(IReadOnlyList<Point2> poly, double pad) =>
        (new Point2(poly.Min(p => p.X) - pad, poly.Min(p => p.Y) - pad), new Point2(poly.Max(p => p.X) + pad, poly.Max(p => p.Y) + pad));

    private static double EdgeDistance(Point2 p, IReadOnlyList<Point2> poly)
    {
        var d = double.MaxValue;
        for (var i = 0; i < poly.Count; i++) d = Math.Min(d, Shapes.SegmentDistance(p, poly[i], poly[(i + 1) % poly.Count]));
        return d;
    }

    /// <summary>¿El muro ocupa el punto? No, si cae en el vano de una puerta.</summary>
    private static bool Blocks(Wall wall, Point2 p, double clearance)
    {
        if (Shapes.SegmentDistance(p, wall.Start, wall.End) >= wall.Thickness / 2 + clearance) return false;
        var len = wall.Length;
        if (len < 1e-6) return true;
        var along = (p.X - wall.Start.X) * wall.Direction.X + (p.Y - wall.Start.Y) * wall.Direction.Y;
        foreach (var o in wall.OpeningsOrEmpty)
            if (o.IsDoor && along > o.Offset + clearance * 0.5 && along < o.Offset + o.Width - clearance * 0.5) return false;
        return true;
    }

    public Point2 Center(int i, int j) => new(Origin.X + (i + 0.5) * Cell, Origin.Y + (j + 0.5) * Cell);

    public (int I, int J) CellOf(Point2 p) =>
        (Math.Clamp((int)Math.Floor((p.X - Origin.X) / Cell), 0, Width - 1), Math.Clamp((int)Math.Floor((p.Y - Origin.Y) / Cell), 0, Height - 1));

    public bool IsFree(int i, int j) => i >= 0 && j >= 0 && i < Width && j < Height && _free[j * Width + i];

    public bool IsFree(Point2 p)
    {
        var (i, j) = CellOf(p);
        return IsFree(i, j);
    }

    public int FreeCount => _free.Count(f => f);

    /// <summary>La celda libre más cercana (búsqueda en anillos), o null si no hay ninguna cerca.</summary>
    public Point2? NearestFree(Point2 p, int maxRing = 15)
    {
        var (ci, cj) = CellOf(p);
        for (var r = 0; r <= maxRing; r++)
        {
            Point2? best = null;
            var bestD = double.MaxValue;
            for (var j = cj - r; j <= cj + r; j++)
            for (var i = ci - r; i <= ci + r; i++)
            {
                if (Math.Max(Math.Abs(i - ci), Math.Abs(j - cj)) != r || !IsFree(i, j)) continue;
                var c = Center(i, j);
                var d = (c - p).Length;
                if (d < bestD)
                {
                    bestD = d;
                    best = c;
                }
            }
            if (best is not null) return best;
        }
        return null;
    }

    /// <summary>Camino de <paramref name="from"/> a <paramref name="to"/> (A* y alisado), o null si no se llega.</summary>
    public List<Point2>? Path(Point2 from, Point2 to)
    {
        if (NearestFree(from) is not { } a || NearestFree(to) is not { } b) return null;
        var (si, sj) = CellOf(a);
        var (gi, gj) = CellOf(b);
        var start = sj * Width + si;
        var goal = gj * Width + gi;
        var came = new Dictionary<int, int>();
        var cost = new Dictionary<int, double> { [start] = 0 };
        var open = new PriorityQueue<int, double>();
        open.Enqueue(start, 0);
        var closed = new HashSet<int>();
        while (open.TryDequeue(out var cur, out _))
        {
            if (cur == goal) break;
            if (!closed.Add(cur)) continue;
            var ci = cur % Width;
            var cj = cur / Width;
            for (var dj = -1; dj <= 1; dj++)
            for (var di = -1; di <= 1; di++)
            {
                if (di == 0 && dj == 0) continue;
                var ni = ci + di;
                var nj = cj + dj;
                if (!IsFree(ni, nj)) continue;
                if (di != 0 && dj != 0 && (!IsFree(ci + di, cj) || !IsFree(ci, cj + dj))) continue; // no cortar esquinas
                var n = nj * Width + ni;
                var c = cost[cur] + (di != 0 && dj != 0 ? Math.Sqrt(2) : 1);
                if (cost.TryGetValue(n, out var old) && old <= c) continue;
                cost[n] = c;
                came[n] = cur;
                open.Enqueue(n, c + Math.Sqrt((ni - gi) * (ni - gi) + (nj - gj) * (nj - gj)));
            }
        }
        if (!cost.ContainsKey(goal)) return null;
        var cells = new List<int> { goal };
        while (cells[^1] != start) cells.Add(came[cells[^1]]);
        cells.Reverse();
        var raw = cells.Select(c => Center(c % Width, c / Width)).ToList();
        return Smooth(raw);
    }

    /// <summary>Quita los puntos intermedios que se ven en línea recta.</summary>
    private List<Point2> Smooth(List<Point2> pts)
    {
        if (pts.Count <= 2) return pts;
        var outPts = new List<Point2> { pts[0] };
        var anchor = 0;
        for (var k = 2; k < pts.Count; k++)
        {
            if (Visible(pts[anchor], pts[k])) continue;
            outPts.Add(pts[k - 1]);
            anchor = k - 1;
        }
        outPts.Add(pts[^1]);
        return outPts;
    }

    public bool Visible(Point2 a, Point2 b)
    {
        var d = (b - a).Length;
        var steps = Math.Max(1, (int)Math.Ceiling(d / (Cell * 0.5)));
        for (var s = 0; s <= steps; s++)
            if (!IsFree(a + (b - a) * ((double)s / steps))) return false;
        return true;
    }

    /// <summary>Largo de un camino en metros.</summary>
    public static double Length(IReadOnlyList<Point2> path) =>
        path.Zip(path.Skip(1)).Sum(p => (p.Second - p.First).Length);
}

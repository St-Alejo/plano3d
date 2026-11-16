using Plano3D.Core.Model;

namespace Plano3D.Core.Editing;

/// <summary>Línea guía de alineación: del extremo existente al punto que quedó alineado con él.</summary>
public readonly record struct Guide(Point2 From, Point2 To);

/// <summary>
/// Imanes del editor de planta (port de <c>frontend/src/domain/snap.ts</c>): extremos de muros,
/// ejes 0°/90° respecto del ancla, alineación con otras esquinas y rejilla.
/// </summary>
public static class Snapping
{
    public static double Distance(Point2 a, Point2 b) => (a - b).Length;

    public static IEnumerable<Point2> WallEndpoints(IEnumerable<Wall> walls, string? exceptWallId = null) =>
        walls.Where(w => w.Id != exceptWallId).SelectMany(w => new[] { w.Start, w.End });

    public static (Point2 Point, bool Snapped) ToPoints(Point2 p, IEnumerable<Point2> candidates, double tol)
    {
        Point2? best = null;
        var bestD = tol;
        foreach (var c in candidates)
        {
            var d = Distance(p, c);
            if (d <= bestD)
            {
                best = c;
                bestD = d;
            }
        }
        return best is { } b ? (b, true) : (p, false);
    }

    /// <summary>Si el segmento ancla→p está a menos de <paramref name="degTol"/> de horizontal o vertical, lo endereza.</summary>
    public static Point2 ToAxis(Point2 anchor, Point2 p, double degTol = 6)
    {
        var dx = p.X - anchor.X;
        var dy = p.Y - anchor.Y;
        var ang = Math.Atan2(Math.Abs(dy), Math.Abs(dx)) * 180 / Math.PI;
        if (ang < degTol) return new Point2(p.X, anchor.Y);
        if (90 - ang < degTol) return new Point2(anchor.X, p.Y);
        return p;
    }

    public static Point2 ToGrid(Point2 p, double step) =>
        step > 0 ? new Point2(Math.Round(p.X / step) * step, Math.Round(p.Y / step) * step) : p;

    /// <summary>
    /// Imán completo, del más fuerte al más débil: extremo existente → eje respecto del ancla →
    /// alineación con otra esquina (devuelve la guía) → rejilla en el eje que quede libre.
    /// </summary>
    public static (Point2 Point, List<Guide> Guides) WithGuides(
        Point2 p, IReadOnlyCollection<Point2> candidates, double tol, Point2? anchor = null, double grid = 0, double degTol = 6)
    {
        var s = ToPoints(p, candidates, tol);
        if (s.Snapped) return (s.Point, []);
        var axis = anchor is { } a ? ToAxis(a, p, degTol) : p;
        var lockX = anchor is { } ax0 && axis.X == ax0.X;
        var lockY = anchor is { } ay0 && axis.Y == ay0.Y;
        var others = candidates.Where(c => anchor is not { } an || Distance(c, an) > 1e-9).ToList();
        Point2? Nearest(Func<Point2, double> key)
        {
            Point2? best = null;
            var bestD = tol;
            foreach (var c in others)
            {
                var d = Math.Abs(key(c) - key(axis));
                if (d <= bestD)
                {
                    best = c;
                    bestD = d;
                }
            }
            return best;
        }
        var alignX = lockX ? null : Nearest(c => c.X);
        var alignY = lockY ? null : Nearest(c => c.Y);
        var g = grid > 0 ? ToGrid(axis, grid) : axis;
        var point = new Point2(
            alignX is { } bx ? bx.X : lockX ? axis.X : g.X,
            alignY is { } by ? by.Y : lockY ? axis.Y : g.Y);
        var guides = new List<Guide>();
        if (alignX is { } gx) guides.Add(new Guide(gx, point));
        if (alignY is { } gy) guides.Add(new Guide(gy, point));
        return (point, guides);
    }

    /// <summary>Proyección de un punto sobre el eje del muro: distancia desde el inicio (recortada) y distancia al eje.</summary>
    public static (double Offset, double Distance) ProjectOnWall(Wall wall, Point2 p)
    {
        var len = wall.Length;
        if (len < 1e-9) return (0, Distance(p, wall.Start));
        var dir = wall.Direction;
        var rel = p - wall.Start;
        var t = Math.Clamp(rel.X * dir.X + rel.Y * dir.Y, 0, len);
        var foot = wall.Start + dir * t;
        return (t, Distance(p, foot));
    }

    /// <summary>Muro más cercano a un punto (para poner puertas y ventanas con un clic).</summary>
    public static (Wall Wall, double Offset)? NearestWall(Level level, Point2 p, double tol)
    {
        (Wall Wall, double Offset, double D)? best = null;
        foreach (var w in level.Walls)
        {
            var (offset, d) = ProjectOnWall(w, p);
            if (d <= Math.Max(tol, w.Thickness / 2) && (best is null || d < best.Value.D)) best = (w, offset, d);
        }
        return best is { } b ? (b.Wall, b.Offset) : null;
    }
}

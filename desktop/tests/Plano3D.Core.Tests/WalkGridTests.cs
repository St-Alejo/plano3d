using Plano3D.Core.Editing;
using Plano3D.Core.Model;
using Plano3D.Core.Simulation;
using Xunit;

namespace Plano3D.Core.Tests;

public class WalkGridTests
{
    /// <summary>Dos cuartos de 4×4 m lado a lado; el muro del medio con o sin puerta.</summary>
    private static Level TwoRooms(bool door)
    {
        Wall W(string id, double x0, double y0, double x1, double y1, Opening? o = null) =>
            new(id, new Point2(x0, y0), new Point2(x1, y1), 0.15, 2.6, Openings: o is null ? null : [o]);
        var walls = new List<Wall>
        {
            W("n", 0, 0, 8, 0), W("s", 0, 4, 8, 4), W("o", 0, 0, 0, 4), W("e", 8, 0, 8, 4),
            W("m", 4, 0, 4, 4, door ? new Opening("p", "door", 1.5, 0.9, 2.1) : null),
        };
        Room R(string id, double x) => new(id, id, [new(x, 0), new(x + 4, 0), new(x + 4, 4), new(x, 4)]);
        return new Level("L1", "Piso 1", 0, 2.6, walls, [R("a", 0), R("b", 4)], [], [], []);
    }

    [Fact]
    public void CruzaPorLaPuerta()
    {
        var g = WalkGrid.Build(TwoRooms(door: true));
        var path = g.Path(new Point2(2, 2), new Point2(6, 2));
        Assert.NotNull(path);
        // el camino pasa por el vano (y entre 1,5 y 2,4 al cruzar x = 4)
        var cross = path!.Zip(path.Skip(1)).First(s => (s.First.X - 4) * (s.Second.X - 4) <= 0);
        var t = (4 - cross.First.X) / (cross.Second.X - cross.First.X);
        var y = cross.First.Y + t * (cross.Second.Y - cross.First.Y);
        Assert.InRange(y, 1.5, 2.4);
        Assert.True(path.Zip(path.Skip(1)).All(s => g.Visible(s.First, s.Second)));
    }

    [Fact]
    public void SinPuertaNoHayCamino()
    {
        var g = WalkGrid.Build(TwoRooms(door: false));
        Assert.Null(g.Path(new Point2(2, 2), new Point2(6, 2)));
        Assert.NotNull(g.Path(new Point2(1, 1), new Point2(3, 3))); // dentro del mismo cuarto sí
    }

    [Fact]
    public void LosMueblesEstorban()
    {
        var level = TwoRooms(door: true) with { Furniture = [new Furniture("f", "cama_doble", new Point2(2, 2), 1.6, 2, 0.5)] };
        var g = WalkGrid.Build(level);
        Assert.False(g.IsFree(new Point2(2, 2)));
        Assert.True(g.IsFree(new Point2(0.6, 0.6)));
    }

    [Fact]
    public void EnLaCasaDemoSeRecorrenLosAmbientes()
    {
        var model = BuildingModel.From(Fixture.House());
        var reachable = 0;
        var total = 0;
        foreach (var level in model.Levels)
        {
            var g = WalkGrid.Build(level);
            var rooms = level.Rooms.Where(r => Math.Abs(BuildingGeometry2.Area(r)) > 2).ToList();
            for (var i = 1; i < rooms.Count; i++)
            {
                total++;
                if (g.Path(Shapes.Centroid(rooms[0].Polygon), Shapes.Centroid(rooms[i].Polygon)) is not null) reachable++;
            }
        }
        Assert.True(total > 5);
        Assert.True(reachable >= total * 0.6, $"solo {reachable} de {total} ambientes alcanzables");
    }
}

file static class BuildingGeometry2
{
    public static double Area(Room r) => Plano3D.Core.Geometry.BuildingGeometry.SignedArea(r.Polygon);
}

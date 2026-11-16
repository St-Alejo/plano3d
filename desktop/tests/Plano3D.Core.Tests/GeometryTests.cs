using Plano3D.Core.Geometry;
using Plano3D.Core.Model;
using Xunit;

namespace Plano3D.Core.Tests;

public class GeometryTests
{
    private static Wall WallX(params Opening[] openings) =>
        new("w", new Point2(0, 0), new Point2(5, 0), 0.15, 2.6, "plaster", openings);

    [Fact]
    public void WallWithoutOpeningsIsOneSolidBox()
    {
        var box = Assert.Single(BuildingGeometry.WallPieces(WallX(), 0));
        Assert.Equal("solid", box.Part);
        Assert.Equal(new Vec3(2.5, 1.3, 0), box.Center);
        Assert.Equal(new Vec3(5, 2.6, 0.15), box.Size);
        Assert.Equal(0, box.Yaw, 9);
    }

    [Fact]
    public void DoorLeavesTwoSolidsAndALintel()
    {
        var pieces = BuildingGeometry.WallPieces(WallX(new Opening("d", "door", 1, 0.9, 2.1)), 0);
        Assert.Equal(["solid", "lintel", "solid"], pieces.Select(p => p.Part));
        var lintel = pieces[1];
        Assert.Equal(0.5, lintel.Size.Y, 9); // 2,6 − 2,1
        Assert.Equal(2.35, lintel.Center.Y, 9);
        Assert.Equal(1.45, lintel.Center.X, 9);
    }

    [Fact]
    public void WindowHasSillAndLintelAndKeepsTheLengthOfTheWall()
    {
        var pieces = BuildingGeometry.WallPieces(WallX(new Opening("v", "window", 2, 1.2, 1.2, 0.9)), 3);
        Assert.Equal(["solid", "sill", "lintel", "solid"], pieces.Select(p => p.Part));
        Assert.Equal(0.9, pieces[1].Size.Y, 9);
        Assert.Equal(3 + 0.45, pieces[1].Center.Y, 9); // sobre la elevación del piso
        // los tramos llenos y el vano suman el largo del muro
        Assert.Equal(5, pieces[0].Size.X + 1.2 + pieces[3].Size.X, 9);
    }

    [Fact]
    public void PlanYGoesToZAndYawFollowsTheWall()
    {
        var w = new Wall("w", new Point2(1, 1), new Point2(1, 4));
        var box = Assert.Single(BuildingGeometry.WallPieces(w, 0));
        Assert.Equal(new Vec3(1, 1.3, 2.5), box.Center);
        Assert.Equal(-Math.PI / 2, box.Yaw, 9); // x local apunta hacia +Z
    }

    [Fact]
    public void StraightStairClimbsStepByStep()
    {
        var steps = BuildingGeometry.StairSteps(new Stair("s", new Point2(0, 0), new Point2(3, 0), 1, 10, 0.17), 0);
        Assert.Equal(10, steps.Count);
        Assert.Equal(1.7, steps[^1].Size.Y, 9);
        Assert.True(steps.Zip(steps.Skip(1)).All(p => p.Second.Size.Y > p.First.Size.Y));
    }

    [Fact]
    public void TriangulatesAnLShapedRoom()
    {
        Point2[] l = [new(0, 0), new(4, 0), new(4, 2), new(2, 2), new(2, 4), new(0, 4)];
        var tri = BuildingGeometry.Triangulate(l);
        Assert.Equal(12, tri.Count); // n − 2 triángulos
        double area = 0;
        for (var i = 0; i < tri.Count; i += 3)
            area += Math.Abs(BuildingGeometry.SignedArea([l[tri[i]], l[tri[i + 1]], l[tri[i + 2]]]));
        Assert.Equal(12, area, 9);
    }

    [Fact]
    public void ClockwisePolygonsAreTriangulatedToo()
    {
        Point2[] square = [new(0, 0), new(0, 3), new(3, 3), new(3, 0)];
        Assert.Equal(6, BuildingGeometry.Triangulate(square).Count);
    }

    [Fact]
    public void TheDemoHouseHasThreeStoreysWithWallsRoomsAndFurniture()
    {
        var model = BuildingModel.From(Fixture.House());
        Assert.Equal(3, model.Levels.Count);
        Assert.All(model.Levels, l => Assert.NotEmpty(l.Walls));
        Assert.Contains(model.Levels, l => l.Furniture.Count > 0);
        Assert.Contains(model.Levels, l => l.Stairs.Count > 0);
        foreach (var level in model.Levels)
        {
            Assert.InRange(BuildingGeometry.StoreyHeight(model, level), 2.2, 4);
            foreach (var room in level.Rooms.Where(r => r.Polygon.Count >= 3))
                Assert.Equal((room.Polygon.Count - 2) * 3, BuildingGeometry.Triangulate(room.Polygon).Count);
        }
        var (min, max) = BuildingGeometry.Bounds(model);
        Assert.InRange(max.X - min.X, 5, 30);
        Assert.InRange(max.Y - min.Y, 5, 30);
    }
}

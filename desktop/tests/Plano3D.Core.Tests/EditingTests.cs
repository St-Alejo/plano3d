using System.Text.Json.Nodes;
using Plano3D.Core.Collab;
using Plano3D.Core.Editing;
using Plano3D.Core.Json;
using Plano3D.Core.Model;
using Plano3D.Core.Ops;
using Xunit;

namespace Plano3D.Core.Tests;

public class EditingTests
{
    private static JsonObject Empty() => (JsonObject)JsonNode.Parse("""
        {"project_id":"p","scale":{"meters_per_pixel":0.01},"facade":"moderna_blanca",
         "levels":[{"id":"L1","name":"Piso 1","elevation":0,"height":2.6,"walls":[],"rooms":[]}]}
        """)!;

    private static Level Level(JsonObject model, int i = 0) => BuildingModel.From(model).Levels[i];

    [Fact]
    public void AddWallUsesTheLevelHeightAndRejectsZeroLength()
    {
        var (m, id) = ModelEditor.AddWall(Empty(), "L1", new Point2(0, 0), new Point2(4, 0));
        var wall = Assert.Single(Level(m).Walls);
        Assert.Equal(id, wall.Id);
        Assert.Equal(2.6, wall.Height);
        Assert.Equal(4, wall.Length, 6);
        Assert.Throws<EditException>(() => ModelEditor.AddWall(Empty(), "L1", new Point2(1, 1), new Point2(1.01, 1)));
    }

    [Fact]
    public void OpeningsAreCenteredOnTheClickAndNeverOverlap()
    {
        var (m, wall) = ModelEditor.AddWall(Empty(), "L1", new Point2(0, 0), new Point2(5, 0));
        (m, var door) = ModelEditor.AddOpening(m, wall, "door", 2.5);
        var o = Assert.Single(Level(m).Walls[0].OpeningsOrEmpty);
        Assert.Equal(door, o.Id);
        Assert.Equal(2.05, o.Offset, 6); // 2,5 − 0,9/2 redondeado a 5 cm
        Assert.Throws<EditException>(() => ModelEditor.AddOpening(m, wall, "window", 2.4));
        // cerca del borde se corre hacia adentro
        (m, _) = ModelEditor.AddOpening(m, wall, "window", 4.9);
        Assert.Equal(3.8, Level(m).Walls[0].OpeningsOrEmpty[1].Offset, 6);
    }

    [Fact]
    public void FurnitureComesFromTheSharedCatalog()
    {
        var (m, id) = ModelEditor.AddFurniture(Empty(), "L1", "sofa_3", new Point2(2, 3), Math.PI / 2);
        var f = Assert.Single(Level(m).Furniture);
        Assert.Equal((id, "sofa_3", 2.0, 0.9), (f.Id, f.CatalogId, f.Width, f.Depth));
        Assert.Throws<EditException>(() => ModelEditor.AddFurniture(Empty(), "L1", "no_existe", default));
    }

    [Fact]
    public void TranslateMovesWallsFurnitureRoomsAndSlidesOpeningsAlongTheirWall()
    {
        var (m, wall) = ModelEditor.AddWall(Empty(), "L1", new Point2(0, 0), new Point2(5, 0));
        (m, var door) = ModelEditor.AddOpening(m, wall, "door", 1);
        (m, var sofa) = ModelEditor.AddFurniture(m, "L1", "sofa_2", new Point2(1, 1));
        (m, var room) = ModelEditor.AddRoom(m, "L1", [new(0, 0), new(2, 0), new(2, 2), new(0, 2)]);
        m = ModelEditor.Translate(m, [wall, sofa, room], new Point2(1, 2));
        var lv = Level(m);
        Assert.Equal(new Point2(1, 2), lv.Walls[0].Start);
        Assert.Equal(new Point2(2, 3), lv.Furniture[0].Position);
        Assert.Equal(new Point2(1, 2), lv.Rooms[0].Polygon[0]);
        // la puerta solo corre a lo largo del muro (la parte en y se ignora)
        m = ModelEditor.Translate(m, [door], new Point2(1, 5));
        Assert.Equal(1.55, Level(m).Walls[0].OpeningsOrEmpty[0].Offset, 6);
    }

    [Fact]
    public void RotatingAGroupTurnsItAroundItsCenter()
    {
        var (m, a) = ModelEditor.AddFurniture(Empty(), "L1", "silla", new Point2(0, 0));
        (m, var b) = ModelEditor.AddFurniture(m, "L1", "silla", new Point2(2, 0));
        m = ModelEditor.Rotate(m, [a, b], Math.PI / 2);
        var f = Level(m).Furniture;
        Assert.Equal(1, f[0].Position.X, 6);
        Assert.Equal(-1, f[0].Position.Y, 6);
        Assert.Equal(1, f[1].Position.Y, 6);
        Assert.Equal(Math.PI / 2, f[0].Rotation, 3);
        // uno solo gira sobre sí mismo
        m = ModelEditor.Rotate(m, [a], Math.PI / 2);
        Assert.Equal(1, Level(m).Furniture[0].Position.X, 6);
        Assert.Equal(Math.PI, Math.Abs(Level(m).Furniture[0].Rotation), 3);
    }

    [Fact]
    public void MirrorFlipsPositionsAndRotations()
    {
        var (m, a) = ModelEditor.AddFurniture(Empty(), "L1", "silla", new Point2(0, 0), 0.3);
        (m, var b) = ModelEditor.AddFurniture(m, "L1", "silla", new Point2(4, 1));
        m = ModelEditor.Mirror(m, [a, b]);
        var f = Level(m).Furniture;
        Assert.Equal(4, f[0].Position.X, 6);
        Assert.Equal(0, f[1].Position.X, 6);
        Assert.Equal(Math.PI - 0.3, f[0].Rotation, 3);
    }

    [Fact]
    public void MovingACornerDragsTheJoinedWallAndKeepsOpeningsInside()
    {
        var (m, w1) = ModelEditor.AddWall(Empty(), "L1", new Point2(0, 0), new Point2(4, 0));
        (m, var w2) = ModelEditor.AddWall(m, "L1", new Point2(4, 0), new Point2(4, 3));
        (m, _) = ModelEditor.AddOpening(m, w1, "window", 3.2);
        m = ModelEditor.MoveWallPoint(m, w1, true, new Point2(3, 0));
        var lv = Level(m);
        Assert.Equal(new Point2(3, 0), lv.Walls[0].End);
        Assert.Equal(new Point2(3, 0), lv.Walls.Single(w => w.Id == w2).Start);
        var o = lv.Walls[0].OpeningsOrEmpty[0];
        Assert.True(o.Offset + o.Width <= 3 + 1e-9);
        // sin unión, el otro muro se queda
        m = ModelEditor.MoveWallPoint(m, w1, true, new Point2(2.5, 0), joint: false);
        Assert.Equal(new Point2(3, 0), Level(m).Walls.Single(w => w.Id == w2).Start);
    }

    [Fact]
    public void PatchHandlesLengthPositionAndValidation()
    {
        var (m, wall) = ModelEditor.AddWall(Empty(), "L1", new Point2(0, 0), new Point2(4, 0));
        m = ModelEditor.Patch(m, wall, "length", 2.5);
        Assert.Equal(2.5, Level(m).Walls[0].Length, 6);
        m = ModelEditor.Patch(m, wall, "material", "ladrillo");
        Assert.Equal("ladrillo", Level(m).Walls[0].Material);
        Assert.Throws<EditException>(() => ModelEditor.Patch(m, wall, "thickness", -1));
        (m, var sofa) = ModelEditor.AddFurniture(m, "L1", "sofa_2", new Point2(1, 1));
        m = ModelEditor.Patch(m, sofa, "x", 3.25);
        Assert.Equal(new Point2(3.25, 1), Level(m).Furniture[0].Position);
        m = ModelEditor.Patch(m, "L1", "name", "Primer piso");
        Assert.Equal("Primer piso", Level(m).Name);
    }

    [Fact]
    public void DuplicateGivesFreshIdsAlsoToOpenings()
    {
        var (m, wall) = ModelEditor.AddWall(Empty(), "L1", new Point2(0, 0), new Point2(5, 0));
        (m, var door) = ModelEditor.AddOpening(m, wall, "door", 2);
        (m, var ids) = ModelEditor.Duplicate(m, [wall], new Point2(0, 1));
        var copy = Level(m).Walls.Single(w => w.Id == ids[0]);
        Assert.NotEqual(wall, copy.Id);
        Assert.NotEqual(door, copy.OpeningsOrEmpty[0].Id);
        Assert.Equal(1, copy.Start.Y, 6);
    }

    [Fact]
    public void ArrayRepeatsAWindowWhileItFits()
    {
        var (m, wall) = ModelEditor.AddWall(Empty(), "L1", new Point2(0, 0), new Point2(6, 0));
        (m, var win) = ModelEditor.AddOpening(m, wall, "window", 0.6); // 0 → 1,2
        (m, var ids) = ModelEditor.ArrayOpening(m, win, 10, 0.3);
        Assert.Equal(3, ids.Count); // 1,5 · 3,0 · 4,5 (la de 6,0 ya no cabe)
        Assert.Equal(4, Level(m).Walls[0].OpeningsOrEmpty.Count);
    }

    [Fact]
    public void DuplicateLevelStacksACopyOnTop()
    {
        var house = Fixture.House();
        var first = BuildingModel.From(house).Levels[0];
        var (m, id) = ModelEditor.DuplicateLevel(house, first.Id);
        var model = BuildingModel.From(m);
        var copy = model.FindLevel(id)!;
        Assert.Equal(4, model.Levels.Count);
        Assert.Equal(7.8, copy.Elevation, 6);
        Assert.Equal(first.Walls.Count, copy.Walls.Count);
        Assert.Empty(copy.Walls.Select(w => w.Id).Intersect(model.Levels.SelectMany(l => l.Walls).Where(w => !copy.Walls.Contains(w)).Select(w => w.Id)));
        // y las ops de ese cambio se aplican igual que en el servidor
        Assert.Empty(ModelOps.Diff(ModelOps.Apply(house, ModelOps.Diff(house, m)), m));
        m = ModelEditor.DeleteLevel(m, id);
        Assert.Equal(3, BuildingModel.From(m).Levels.Count);
    }

    [Fact]
    public void DeleteRemovesAnyEntityIncludingOpenings()
    {
        var (m, wall) = ModelEditor.AddWall(Empty(), "L1", new Point2(0, 0), new Point2(5, 0));
        (m, var door) = ModelEditor.AddOpening(m, wall, "door", 2);
        (m, var col) = ModelEditor.AddColumn(m, "L1", new Point2(1, 1));
        m = ModelEditor.Delete(m, [door, col]);
        Assert.Empty(Level(m).Walls[0].OpeningsOrEmpty);
        Assert.Empty(Level(m).Columns);
        Assert.Null(ModelEditor.Find(m, col));
    }

    [Fact]
    public void HitTestPrefersTheSmallestThing()
    {
        var (m, wall) = ModelEditor.AddWall(Empty(), "L1", new Point2(0, 0), new Point2(5, 0));
        (m, var door) = ModelEditor.AddOpening(m, wall, "door", 2.5);
        (m, var room) = ModelEditor.AddRoom(m, "L1", [new(0, 0), new(5, 0), new(5, 4), new(0, 4)]);
        (m, var bed) = ModelEditor.AddFurniture(m, "L1", "cama_doble", new Point2(2, 2), Math.PI / 2);
        var lv = Level(m);
        Assert.Equal(door, PlanHit.At(lv, new Point2(2.5, 0.02), 0.05)?.Id);
        Assert.Equal(wall, PlanHit.At(lv, new Point2(0.5, 0.05), 0.05)?.Id);
        // la cama está girada 90°: el ancho (1,40) queda sobre y y el largo (1,95) sobre x
        Assert.Equal(bed, PlanHit.At(lv, new Point2(2.9, 2), 0.01)?.Id);
        Assert.Equal(room, PlanHit.At(lv, new Point2(2, 2.9), 0.01)?.Id);
        Assert.Equal(room, PlanHit.At(lv, new Point2(4, 3), 0.01)?.Id);
        Assert.Null(PlanHit.At(lv, new Point2(9, 9), 0.01));
        var boxed = PlanHit.InBox(lv, new Point2(0.5, 0.5), new Point2(3.6, 3.6));
        Assert.Equal([bed], boxed.Select(h => h.Id));
    }

    [Fact]
    public void SnapPrefersEndpointsThenAxisThenGrid()
    {
        Point2[] corners = [new(0, 0), new(3, 2)];
        Assert.Equal(new Point2(3, 2), Snapping.WithGuides(new Point2(3.05, 2.04), corners, 0.1).Point);
        // casi horizontal desde el ancla: se endereza; luego rejilla en x
        var (p, _) = Snapping.WithGuides(new Point2(1.93, 0.08), [], 0.1, anchor: new Point2(0, 0), grid: 0.25);
        Assert.Equal(new Point2(2, 0), p);
        // alineado con la esquina (3, 2) en x: guía
        var (q, guides) = Snapping.WithGuides(new Point2(3.06, 5), corners, 0.1);
        Assert.Equal(3, q.X, 9);
        Assert.Single(guides);
    }

    [Fact]
    public void UndoRevertsOnlyMyEditEvenAfterSomeoneElseChangedAnotherWall()
    {
        var history = new EditHistory();
        var (base0, theirs) = ModelEditor.AddWall(Empty(), "L1", new Point2(0, 5), new Point2(4, 5));
        var (mine, myWall) = ModelEditor.AddWall(base0, "L1", new Point2(0, 0), new Point2(4, 0));
        history.Record("Agregar muro", base0, mine);
        // otra persona alarga su muro
        var now = ModelEditor.Patch(mine, theirs, "length", 6);
        var undone = history.Undo(now)!.Value;
        Assert.Equal("Agregar muro", undone.Label);
        var lv = Level(undone.Model);
        Assert.Null(lv.Walls.FirstOrDefault(w => w.Id == myWall));
        Assert.Equal(6, lv.Walls.Single(w => w.Id == theirs).Length, 6);
        Assert.True(history.CanRedo);
        var redone = history.Redo(undone.Model)!.Value;
        Assert.NotNull(Level(redone.Model).Walls.FirstOrDefault(w => w.Id == myWall));
        Assert.False(history.CanRedo);
    }

    [Fact]
    public void UndoSkipsWhatNoLongerApplies()
    {
        var history = new EditHistory();
        var (before, sofa) = ModelEditor.AddFurniture(Empty(), "L1", "sofa_2", new Point2(1, 1));
        var after = ModelEditor.Translate(before, [sofa], new Point2(1, 0));
        history.Record("Mover", before, after);
        // otra persona borró el piso entero (aquí: el modelo no tiene ese nivel)
        var gone = (JsonObject)after.DeepClone();
        gone["levels"] = new JsonArray();
        var result = history.Undo(gone)!.Value;
        Assert.Empty(BuildingModel.From(result.Model).Levels);
    }

    [Fact]
    public void EditsTravelThroughTheLiveDocumentAsEntityOps()
    {
        var doc = new LiveDocument();
        doc.Welcome(Empty(), null, 0, 1);
        var (m, _) = ModelEditor.AddFurniture(doc.View!, "L1", "planta", new Point2(1, 1));
        var batch = doc.Edit(m)!;
        var op = Assert.Single(batch.Ops);
        Assert.Equal("put", op.Str("t"));
        Assert.Equal("furniture", op.Str("k"));
    }

    [Fact]
    public void CatalogSearchIgnoresAccentsAndCase()
    {
        Assert.Contains(Catalog.Search("SOFA"), i => i.Id == "sofa_3");
        Assert.Contains(Catalog.Search("baño"), i => i.Id == "ducha");
        Assert.Equal("Ladrillo a la vista", Catalog.WallFinish("brick")!.Name);
    }
}

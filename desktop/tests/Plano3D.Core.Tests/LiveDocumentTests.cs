using System.Text.Json.Nodes;
using Plano3D.Core.Collab;
using Plano3D.Core.Ops;
using Xunit;

namespace Plano3D.Core.Tests;

/// <summary>Mismo algoritmo que CollabSession.ts: lo confirmado, lo pendiente y el rebase.</summary>
public class LiveDocumentTests
{
    private static JsonObject Model(params string[] wallIds) => new()
    {
        ["project_id"] = "p",
        ["scale"] = new JsonObject { ["meters_per_pixel"] = 0.01 },
        ["levels"] = new JsonArray(new JsonObject
        {
            ["id"] = "L1",
            ["name"] = "Piso 1",
            ["elevation"] = 0,
            ["walls"] = new JsonArray(wallIds.Select(id => (JsonNode)Wall(id, 0)).ToArray()),
            ["rooms"] = new JsonArray(),
        }),
    };

    private static JsonObject Wall(string id, double x) => new()
    {
        ["id"] = id,
        ["start"] = new JsonObject { ["x"] = x, ["y"] = 0 },
        ["end"] = new JsonObject { ["x"] = x + 3, ["y"] = 0 },
        ["thickness"] = 0.15,
        ["height"] = 2.6,
        ["openings"] = new JsonArray(),
    };

    private static JsonArray Put(string id, double x) =>
        new(new JsonObject { ["t"] = "put", ["k"] = "wall", ["level"] = "L1", ["id"] = id, ["v"] = Wall(id, x) });

    private static JsonObject WithWall(JsonObject model, string id, double x)
    {
        var copy = (JsonObject)model.DeepClone();
        var walls = (JsonArray)copy["levels"]![0]!["walls"]!;
        var i = walls.Select((w, n) => (w, n)).FirstOrDefault(p => (string?)p.w!["id"] == id).n;
        if (walls.Any(w => (string?)w!["id"] == id)) walls[i] = Wall(id, x);
        else walls.Add(Wall(id, x));
        return copy;
    }

    private static double XOf(JsonObject? model, string id) =>
        (double)((JsonArray)model!["levels"]![0]!["walls"]!).Single(w => (string?)w!["id"] == id)!["start"]!["x"]!;

    [Fact]
    public void WelcomeWithTheModelShowsIt()
    {
        var doc = new LiveDocument();
        var resend = doc.Welcome(Model("a"), null, 5, 2);
        Assert.Empty(resend);
        Assert.Equal(5, doc.Seq);
        Assert.Equal(2, doc.Revision);
        Assert.Equal(0, XOf(doc.View, "a"));
        Assert.Equal(5, doc.LastSeq);
    }

    [Fact]
    public void ALocalEditBecomesAPendingBatchUntilTheServerAcks()
    {
        var doc = new LiveDocument();
        doc.Welcome(Model("a"), null, 1, 1);
        var batch = doc.Edit(WithWall(doc.View!, "a", 2));
        Assert.NotNull(batch);
        Assert.Single(doc.Pending);
        Assert.Equal(2, XOf(doc.View, "a"));

        var fromOther = doc.Applied(2, batch!.OpId, batch.Ops);
        Assert.False(fromOther);
        Assert.Empty(doc.Pending);
        Assert.Equal(2, XOf(doc.Confirmed, "a"));
    }

    [Fact]
    public void AnEditWithoutChangesSendsNothing()
    {
        var doc = new LiveDocument();
        doc.Welcome(Model("a"), null, 1, 1);
        Assert.Null(doc.Edit((JsonObject)doc.View!.DeepClone()));
    }

    [Fact]
    public void RemoteChangesAreRebasedUnderMyPendingOnes()
    {
        var doc = new LiveDocument();
        doc.Welcome(Model("a", "b"), null, 1, 1);
        JsonObject? seen = null;
        doc.ViewChanged += v => seen = v;
        doc.Edit(WithWall(doc.View!, "a", 7)); // mío, sin confirmar

        Assert.True(doc.Applied(2, "otro-1", Put("b", 4))); // de otra persona

        Assert.Equal(7, XOf(doc.View, "a")); // lo mío sigue encima
        Assert.Equal(4, XOf(doc.View, "b")); // y lo del otro aparece
        Assert.Equal(0, XOf(doc.Confirmed, "a"));
        Assert.Same(doc.View, seen);
    }

    [Fact]
    public void ARejectedBatchIsDroppedAndReported()
    {
        var doc = new LiveDocument();
        doc.Welcome(Model("a"), null, 1, 1);
        string? reason = null;
        doc.Rejected += r => reason = r;
        var batch = doc.Edit(WithWall(doc.View!, "a", 9))!;
        doc.Reject(batch.OpId, "muro inválido");
        Assert.Empty(doc.Pending);
        Assert.Equal(0, XOf(doc.View, "a"));
        Assert.Equal("muro inválido", reason);
    }

    [Fact]
    public void ReconnectingAppliesWhatWasMissedAndResendsTheRest()
    {
        var doc = new LiveDocument();
        doc.Welcome(Model("a", "b"), null, 1, 1);
        var mine = doc.Edit(WithWall(doc.View!, "a", 5))!;
        var lost = doc.Edit(WithWall(doc.View!, "b", 6))!;

        // al volver: el servidor ya aplicó el primero (y uno ajeno), el segundo se perdió
        var missed = new[]
        {
            new JsonObject { ["seq"] = 2, ["op_id"] = mine.OpId, ["ops"] = mine.Ops.DeepClone() },
            new JsonObject { ["seq"] = 3, ["op_id"] = "otro-9", ["ops"] = Put("c", 1) },
        };
        var resend = doc.Welcome(null, missed, 3, 1);

        Assert.Equal([lost.OpId], resend.Select(b => b.OpId));
        Assert.Equal(5, XOf(doc.View, "a"));
        Assert.Equal(6, XOf(doc.View, "b"));
        Assert.Equal(1, XOf(doc.View, "c"));
    }

    [Fact]
    public void ASnapshotReplacesWhatWasConfirmed()
    {
        var doc = new LiveDocument();
        doc.Welcome(Model("a"), null, 1, 1);
        doc.Snapshot(Model("z"), 8, 4);
        Assert.Equal(8, doc.Seq);
        Assert.Equal(4, doc.Revision);
        Assert.Equal(0, XOf(doc.View, "z"));
    }

    [Fact]
    public void APendingBatchThatNoLongerAppliesIsDiscarded()
    {
        var doc = new LiveDocument();
        doc.Welcome(Model("a"), null, 1, 1);
        // mío: un muro en un piso que otra persona borra
        var add = new JsonArray(new JsonObject { ["t"] = "put", ["k"] = "wall", ["level"] = "L1", ["id"] = "n", ["v"] = Wall("n", 1) });
        doc.Edit(ModelOps.Apply(doc.View!, add));
        doc.Applied(2, "otro", new JsonArray(new JsonObject { ["t"] = "del", ["k"] = "level", ["id"] = "L1" }));
        Assert.Empty(doc.Pending);
        Assert.Empty((JsonArray)doc.View!["levels"]!);
    }

    [Fact]
    public void ForgettingAsksForTheWholeModelNextTime()
    {
        var doc = new LiveDocument();
        doc.Welcome(Model("a"), null, 4, 1);
        doc.Forget();
        Assert.Null(doc.LastSeq);
    }
}

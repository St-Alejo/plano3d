using System.Text.Json.Nodes;
using Plano3D.Core.Ops;
using Plano3D.Infrastructure.Api;
using Plano3D.Infrastructure.Collab;
using Xunit;

namespace Plano3D.Infrastructure.Tests;

/// <summary>
/// Prueba contra una API de verdad (uvicorn en modo memoria con la demo). Se activa con
/// <c>PLANO3D_TEST_API=http://127.0.0.1:8010</c>; sin la variable se omite.
/// </summary>
public sealed class LiveApiFactAttribute : FactAttribute
{
    public LiveApiFactAttribute()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("PLANO3D_TEST_API")))
            Skip = "sin PLANO3D_TEST_API (API local en modo memoria)";
    }
}

public class LiveApiTests
{
    private static Uri Api => new(Environment.GetEnvironmentVariable("PLANO3D_TEST_API")!);

    private static async Task<T> Within<T>(Task<T> task, string what)
    {
        var done = await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(15)));
        if (done != task) throw new TimeoutException($"No llegó a tiempo: {what}");
        return await task;
    }

    [LiveApiFact]
    public async Task TheDemoAccountOpensTheThreeStoreyHouse()
    {
        using var api = new ApiClient(Api, new MemoryTokenStore());
        var cfg = await api.ConfigAsync();
        Assert.True(cfg.DemoEnabled);
        await api.DemoAsync();
        Assert.True(api.User!.IsDemo);

        var house = (await api.ProjectsAsync()).Single(p => p.Id == "prj_demo_casa3");
        var project = await api.ProjectAsync(house.Id);
        var model = Core.Model.BuildingModel.From((JsonObject)project["model"]!);
        Assert.Equal(3, model.Levels.Count);
    }

    [LiveApiFact]
    public async Task AnEditFromOneDesktopReachesTheOther()
    {
        using var api = new ApiClient(Api, new MemoryTokenStore());
        await api.DemoAsync();
        var house = await api.ProjectAsync("prj_demo_casa3");
        var pid = (string)house["id"]!;

        await using var a = new CollabClient(api, pid);
        await using var b = new CollabClient(api, pid, "web");
        var aLive = Signal(a, LiveStatus.Live);
        var bLive = Signal(b, LiveStatus.Live);
        a.Start();
        await Within(aLive, "A en vivo");
        b.Start();
        await Within(bLive, "B en vivo");
        Assert.Contains(a.Peers, p => p.Client == "web"); // A ve llegar a B

        var remote = new TaskCompletionSource<Peer?>(TaskCreationOptions.RunContinuationsAsynchronously);
        b.RemoteEdit += p => remote.TrySetResult(p);

        // A agrega un muro en el primer piso
        var edited = (JsonObject)a.Document.View!.DeepClone();
        var level = (JsonObject)((JsonArray)edited["levels"]!)[0]!;
        var wallId = $"w_escritorio_{Guid.NewGuid():N}"[..20];
        ((JsonArray)level["walls"]!).Add(new JsonObject
        {
            ["id"] = wallId,
            ["start"] = new JsonObject { ["x"] = 0.5, ["y"] = 0.5 },
            ["end"] = new JsonObject { ["x"] = 2.5, ["y"] = 0.5 },
            ["thickness"] = 0.1,
            ["height"] = 2.4,
            ["material"] = "plaster",
            ["openings"] = new JsonArray(),
            ["confidence"] = 1,
        });
        await a.EditAsync(edited);

        var author = await Within(remote.Task, "el cambio en B");
        Assert.Equal("desktop", author?.Client);
        Assert.Contains(((JsonArray)b.Document.View!["levels"]![0]!["walls"]!), w => (string?)w!["id"] == wallId);

        // y se deshace: el mismo camino al revés
        var back = (JsonObject)a.Document.View!.DeepClone();
        var walls = (JsonArray)back["levels"]![0]!["walls"]!;
        walls.Remove(walls.First(w => (string?)w!["id"] == wallId));
        var undone = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        b.RemoteEdit += _ => undone.TrySetResult();
        await a.EditAsync(back);
        await Within(undone.Task.ContinueWith(_ => true), "deshacer en B");
        Assert.Empty(ModelOps.Diff(a.Document.View!, b.Document.View!));
    }

    private static Task<bool> Signal(CollabClient c, LiveStatus wanted)
    {
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        c.StatusChanged += (s, _) =>
        {
            if (s == wanted) tcs.TrySetResult(true);
        };
        return tcs.Task;
    }
}

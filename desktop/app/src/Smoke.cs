using System.Diagnostics;
using System.Text.Json.Nodes;
using Godot;
using Plano3D.App.Screens;
using Plano3D.Infrastructure.Api;
using Plano3D.Infrastructure.Collab;

namespace Plano3D.App;

/// <summary>
/// Prueba de humo de punta a punta (sin manos):
/// <c>godot --path app -- --smoke salida.png [--api URL]</c>.
/// Entra con la demo, abre la casa de 3 pisos, la fotografía; luego otra persona «desde la
/// web» agrega un muro y se mide cuánto tarda en aparecer aquí. Sale con código 0 si todo va bien.
/// </summary>
public static class Smoke
{
    public static async Task RunAsync(Main main)
    {
        var tree = main.GetTree();
        var output = main.Launch.Smoke!;
        try
        {
            main.ShowBusy("Prueba de humo…");
            await main.Api.DemoAsync();
            var projectId = main.Launch.Project ?? "prj_demo_casa3";
            var editor = main.ShowEditor(projectId, "Casa demo");
            await editor.LoadAsync();
            await Until(main, () => editor.Ready3D && editor.Collab?.Status == LiveStatus.Live, 60, "la casa en vivo");
            await Frames(tree, 90);
            var kinds = editor.Sync.Entities.GroupBy(e => e.Kind).OrderBy(g => g.Key).Select(g => $"{g.Key}={g.Count()}");
            GD.Print($"[humo] entidades: {string.Join(" ", kinds)}");
            Shot(main, output);

            // otra persona, como si fuera la web, agrega un muro en el primer piso
            using var webApi = new ApiClient(main.Api.BaseUrl, new MemoryTokenStore());
            await webApi.DemoAsync();
            await using var web = new CollabClient(webApi, projectId, "web");
            var live = new TaskCompletionSource();
            web.StatusChanged += (s, _) =>
            {
                if (s == LiveStatus.Live) live.TrySetResult();
            };
            web.Start();
            await live.Task.WaitAsync(TimeSpan.FromSeconds(20));
            await Until(main, () => editor.Collab!.Peers.Any(p => p.Client == "web"), 10, "ver a la web en la sala");

            var model = (JsonObject)web.Document.View!.DeepClone();
            var level = (JsonObject)((JsonArray)model["levels"]!)[0]!;
            var wallId = $"w_humo_{Guid.NewGuid():N}"[..14];
            ((JsonArray)level["walls"]!).Add(new JsonObject
            {
                ["id"] = wallId,
                ["start"] = new JsonObject { ["x"] = -3.0, ["y"] = -3.0 },
                ["end"] = new JsonObject { ["x"] = 3.0, ["y"] = -3.0 },
                ["thickness"] = 0.2,
                ["height"] = 2.4,
                ["material"] = "brick",
                ["openings"] = new JsonArray(),
                ["confidence"] = 1,
            });
            var sw = Stopwatch.StartNew();
            await web.EditAsync(model);
            await Until(main, () => editor.Sync.Find(wallId).Any(), 10, "el muro de la web en el escritorio");
            GD.Print($"[humo] el muro de la web apareció en {sw.ElapsedMilliseconds} ms (rehechas {editor.Sync.LastRebuilt} entidades)");
            await Frames(tree, 30);
            Shot(main, output.Replace(".png", "-vivo.png"));

            // se deja la casa como estaba
            var back = (JsonObject)web.Document.View!.DeepClone();
            var walls = (JsonArray)back["levels"]![0]!["walls"]!;
            walls.Remove(walls.First(w => (string?)w!["id"] == wallId));
            await web.EditAsync(back);
            await Until(main, () => !editor.Sync.Find(wallId).Any(), 10, "deshacer el muro");
            GD.Print("[humo] OK");
            main.ShowProjects();
            await Frames(tree, 5);
            tree.Quit(0);
        }
        catch (Exception e)
        {
            GD.PrintErr($"[humo] FALLÓ: {e.Message}");
            tree.Quit(1);
        }
    }

    private static void Shot(Main main, string path)
    {
        var img = main.GetViewport().GetTexture().GetImage();
        img.SavePng(path);
        GD.Print($"[humo] captura {path} ({img.GetWidth()}x{img.GetHeight()})");
    }

    private static async Task Frames(SceneTree tree, int n)
    {
        for (var i = 0; i < n; i++) await tree.ToSignal(tree, SceneTree.SignalName.ProcessFrame);
    }

    private static async Task Until(Main main, Func<bool> ok, double seconds, string what)
    {
        var tree = main.GetTree();
        var sw = Stopwatch.StartNew();
        while (!ok())
        {
            if (sw.Elapsed.TotalSeconds > seconds) throw new TimeoutException($"no se logró {what} en {seconds} s");
            await tree.ToSignal(tree, SceneTree.SignalName.ProcessFrame);
        }
    }
}

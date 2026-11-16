using System.Diagnostics;
using System.Text.Json.Nodes;
using Godot;
using Plano3D.App.Scene;
using Plano3D.App.Screens;
using Plano3D.Core.Rendering;
using Plano3D.Infrastructure.Blender;
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

            // gráficos: atardecer, noche con lámparas y una captura 4K del modo foto
            editor.SetHour(17.0);
            await Frames(tree, 40);
            Shot(main, output.Replace(".png", "-atardecer.png"));
            editor.SetHour(20.5);
            await Frames(tree, 40);
            if (!editor.Atmosphere.IsNight) throw new InvalidOperationException("a las 8:30 p. m. debería ser de noche");
            Shot(main, output.Replace(".png", "-noche.png"));
            editor.SetHour(10.5);
            editor.SetPhotoMode(true);
            await Frames(tree, 20);
            var sw4k = Stopwatch.StartNew();
            var big = await editor.CaptureAsync(0, output.Replace(".png", "-4k.png"));
            var img4k = big is null ? null : Image.LoadFromFile(big);
            if (img4k is null || img4k.GetWidth() != 3840) throw new InvalidOperationException("la captura 4K no salió");
            GD.Print($"[humo] captura 4K en {sw4k.ElapsedMilliseconds} ms");
            editor.SetPhotoMode(false);
            await Frames(tree, 5);

            // simulación y recorrido: personas caminando, caminar 3 s grabando y armar el mp4
            editor.SetPeople(true);
            await Frames(tree, 10);
            if (editor.People.Count == 0) throw new InvalidOperationException("no aparecieron personas");
            GD.Print($"[humo] {editor.People.Count} personas caminando; sin camino: {string.Join(", ", editor.People.Unreachable)}");
            await Seconds(tree, 3);
            Shot(main, output.Replace(".png", "-personas.png"));
            if (!editor.StartWalk()) throw new InvalidOperationException("no se pudo entrar al recorrido");
            await Frames(tree, 20);
            var walker = editor.Walker!;
            var from = walker.GlobalPosition;
            editor.StartRecording();
            walker.Push = new Vector2(0, 1);
            await Seconds(tree, 1.5);
            walker.Push = new Vector2(0.7f, 0.7f);
            await Seconds(tree, 1.5);
            walker.Push = Vector2.Zero;
            var moved = new Vector2(walker.GlobalPosition.X - from.X, walker.GlobalPosition.Z - from.Z).Length();
            GD.Print($"[humo] el recorrido avanzó {moved:0.00} m (altura {from.Y:0.00} → {walker.GlobalPosition.Y:0.00})");
            if (moved < 0.5 || walker.GlobalPosition.Y < from.Y - 0.5) throw new InvalidOperationException("el recorrido no camina o se cae");
            Shot(main, output.Replace(".png", "-recorrido.png"));
            var video = await editor.StopRecordingAsync(output.Replace(".png", "-recorrido.mp4"));
            if (video is null || !System.IO.File.Exists(video)) throw new InvalidOperationException("no salió el video del recorrido");
            GD.Print($"[humo] video {new System.IO.FileInfo(video).Length / 1024} KB");
            editor.StopWalk();
            editor.SetPeople(false);
            await Frames(tree, 5);

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

            // y al revés: se dibuja un muro en la planta con el ratón y la web lo recibe
            editor.SetMode(EditorScreen.ViewMode.Split);
            editor.SetTool("wall");
            await Frames(tree, 10);
            var plan = editor.PlanView.GetGlobalRect();
            var a = plan.Position + plan.Size * new Vector2(0.3f, 0.45f);
            var b = plan.Position + plan.Size * new Vector2(0.75f, 0.45f);
            Click(main, a);
            await Frames(tree, 2);
            sw.Restart();
            Click(main, b);
            await Frames(tree, 2);
            var drawn = editor.Selection.FirstOrDefault();
            if (drawn is null || editor.History.UndoLabel != "Agregar muro") throw new InvalidOperationException("la herramienta de muro no creó nada");
            PressKey(main, Godot.Key.Escape);
            await Until(main, () => HasEntity(web.Document.View, drawn), 10, "el muro del escritorio en la web");
            GD.Print($"[humo] el muro dibujado en el escritorio llegó a la web en {sw.ElapsedMilliseconds} ms");
            await Frames(tree, 30);
            Shot(main, output.Replace(".png", "-planta.png"));

            // deshacer también viaja
            editor.Undo();
            await Until(main, () => !HasEntity(web.Document.View, drawn), 10, "deshacer en la web");
            GD.Print("[humo] deshacer llegó a la web");
            editor.SetTool("select");

            // Blender: el paquete lleva cada malla marcada y los nombres de material de la web
            var pack = BlenderPackage.Write(editor.Sync, System.IO.Path.Combine(OS.GetUserDataDir(), "blender", "humo"), "Humo", null, []);
            var (glbJson, _) = GlbExtras.Read(System.IO.File.ReadAllBytes(System.IO.Path.Combine(pack.Folder, "casa.glb")));
            var mats = ((JsonArray?)glbJson["materials"] ?? []).Select(m => (string?)m!["name"] ?? "").ToHashSet();
            GD.Print($"[humo] paquete Blender: {pack.Meshes} mallas, {pack.Tagged} marcadas, materiales {string.Join(", ", mats.Take(8))}…");
            if (pack.Meshes == 0 || pack.Tagged != pack.Meshes || !mats.Any(m => m.StartsWith("wall:", StringComparison.Ordinal)))
                throw new InvalidOperationException("el paquete para Blender salió sin marcas o sin materiales de muro");
            if (editor.BlenderExe is null) GD.Print("[humo] sin Blender en esta PC: no se renderiza");
            else
            {
                sw.Restart();
                if (!editor.EnqueueRender(new EditorScreen.RenderJob(RenderQuality.Borrador, RenderHour.Dia, "Fachada principal", true)))
                    throw new InvalidOperationException("no arrancó el render");
                await editor.WaitRendersAsync();
                GD.Print($"[humo] Blender: {editor.RenderStatus}");
                await Until(main, () => editor.UploadedRenders.Count > 0, 30, "el render subido a la galería");
                var listed = await main.Api.RendersAsync(projectId);
                if (!listed.Contains(editor.UploadedRenders[0])) throw new InvalidOperationException("la galería no tiene el render");
                GD.Print($"[humo] render de Blender en {sw.Elapsed.TotalSeconds:0} s → {editor.Renders[0]} (galería: {listed.Count})");
            }
            GD.Print("[humo] OK");
            main.ShowProjects();
            await Frames(tree, 5);
            tree.Quit(0);
        }
        catch (Exception e)
        {
            GD.PrintErr($"[humo] FALLÓ: {e}");
            tree.Quit(1);
        }
    }

    private static bool HasEntity(JsonObject? model, string id) =>
        model?.ToJsonString().Contains($"\"id\":\"{id}\"", StringComparison.Ordinal) == true;

    private static void Click(Main main, Vector2 at)
    {
        var vp = main.GetViewport();
        vp.PushInput(new InputEventMouseMotion { Position = at, GlobalPosition = at });
        vp.PushInput(new InputEventMouseButton { ButtonIndex = MouseButton.Left, Pressed = true, Position = at, GlobalPosition = at });
        vp.PushInput(new InputEventMouseButton { ButtonIndex = MouseButton.Left, Pressed = false, Position = at, GlobalPosition = at });
    }

    private static void PressKey(Main main, Key key)
    {
        var vp = main.GetViewport();
        vp.PushInput(new InputEventKey { Keycode = key, PhysicalKeycode = key, Pressed = true });
        vp.PushInput(new InputEventKey { Keycode = key, PhysicalKeycode = key, Pressed = false });
    }

    private static void Shot(Main main, string path)
    {
        var img = main.GetViewport().GetTexture().GetImage();
        img.SavePng(path);
        GD.Print($"[humo] captura {path} ({img.GetWidth()}x{img.GetHeight()})");
    }

    private static async Task Seconds(SceneTree tree, double s)
    {
        var sw = Stopwatch.StartNew();
        while (sw.Elapsed.TotalSeconds < s) await tree.ToSignal(tree, SceneTree.SignalName.ProcessFrame);
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

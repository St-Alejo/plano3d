using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using Plano3D.Core.Lighting;
using Plano3D.Core.Rendering;

namespace Plano3D.App.Scene;

/// <summary>
/// Arma el paquete para Blender en una carpeta, igual al .zip de la web: <c>casa.glb</c> (la
/// casa dibujada, con cada malla marcada por tipo, piso y categoría, y materiales con los
/// nombres del visor), <c>proyecto.json</c> (cámaras, sol, lámparas, calle) y
/// <c>blender/arquitectura.py</c>. Así el mismo script sirve a los dos clientes.
/// </summary>
public static class BlenderPackage
{
    public const string ScriptResource = "res://blender/arquitectura.py";

    public sealed record Result(string Folder, int Meshes, int Tagged, JsonObject Project);

    /// <param name="extraCameras">vistas del editor (la actual y los marcadores), primero en la lista</param>
    public static Result Write(SceneSync sync, string folder, string name, SunPosition? sun, IEnumerable<(string Name, Camera3D Camera)> extraCameras)
    {
        var model = sync.Model ?? throw new InvalidOperationException("No hay modelo para exportar");
        System.IO.Directory.CreateDirectory(System.IO.Path.Combine(folder, "blender"));
        System.IO.Directory.CreateDirectory(System.IO.Path.Combine(folder, "renders"));

        // ---------------------------------------------------------------- casa.glb
        var floors = BlenderProject.Floors(model).ToDictionary(f => f.Id, f => f.Collection);
        var root = new Node3D { Name = "Casa" };
        var materials = new Dictionary<string, StandardMaterial3D>();
        var meshes = 0;
        foreach (var drawn in sync.Entities)
        {
            if (!GodotObject.IsInstanceValid(drawn.Node)) continue;
            foreach (var mi in Meshes(drawn.Node))
            {
                var key = (mi.MaterialOverride ?? mi.GetActiveMaterial(0))?.ResourceName ?? "";
                if (BlenderNaming.Material(key) is not { } export) continue;
                var kind = BlenderNaming.Kind(drawn.Kind, key);
                var level = floors.GetValueOrDefault(drawn.LevelId, "General");
                var copy = new MeshInstance3D
                {
                    Name = BlenderNaming.EncodeNode($"{kind}_{drawn.Id}_{meshes}", kind, level, drawn.LevelId),
                    Mesh = mi.Mesh,
                    Transform = mi.GlobalTransform,
                    MaterialOverride = Flat(materials, export),
                };
                root.AddChild(copy);
                meshes++;
            }
        }
        var glbPath = System.IO.Path.Combine(folder, "casa.glb");
        var doc = new GltfDocument();
        var state = new GltfState();
        var err = doc.AppendFromScene(root, state);
        if (err == Error.Ok) err = doc.WriteToFilesystem(state, glbPath);
        root.Free();
        if (err != Error.Ok) throw new InvalidOperationException($"No se pudo exportar el GLB ({err})");
        // fichas «m0, m1…» → nombres reales («wall:plaster:solid»), que Godot no deja pasar tal cual
        var names = materials.Values.ToDictionary(m => m.ResourceName, m => (string)m.GetMeta("real"));
        var (glb, tagged) = GlbExtras.Apply(System.IO.File.ReadAllBytes(glbPath), names);
        System.IO.File.WriteAllBytes(glbPath, glb);

        // ---------------------------------------------------------------- proyecto.json
        var project = BlenderProject.Build(model, name, sun);
        foreach (var (camName, cam) in extraCameras.Reverse())
        {
            var t = cam.GlobalTransform;
            var eye = t.Origin;
            var target = eye - t.Basis.Z * 10;
            var aspect = cam.GetViewport() is { } vp && vp.GetVisibleRect().Size.Y > 0 ? vp.GetVisibleRect().Size.X / vp.GetVisibleRect().Size.Y : 16f / 9;
            BlenderProject.AddViewCamera(project, camName, (eye.X, eye.Y, eye.Z), (target.X, target.Y, target.Z), cam.Fov, Math.Clamp(aspect, 1, 3));
        }
        System.IO.File.WriteAllText(System.IO.Path.Combine(folder, "proyecto.json"), project.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));

        // ---------------------------------------------------------------- script
        var script = Godot.FileAccess.GetFileAsString(ScriptResource);
        if (string.IsNullOrEmpty(script)) throw new InvalidOperationException("Falta blender/arquitectura.py en la app");
        System.IO.File.WriteAllText(System.IO.Path.Combine(folder, "blender", "arquitectura.py"), script);
        return new Result(folder, meshes, tagged, project);
    }

    private static IEnumerable<MeshInstance3D> Meshes(Node node)
    {
        if (node is MeshInstance3D { Mesh: not null } mi) yield return mi;
        foreach (var child in node.GetChildren())
            foreach (var m in Meshes(child))
                yield return m;
    }

    private static StandardMaterial3D Flat(Dictionary<string, StandardMaterial3D> cache, ExportMaterial e)
    {
        var key = $"{e.Name}|{e.Hex}|{e.Alpha}";
        if (!cache.TryGetValue(key, out var m))
        {
            var c = new Color(e.Hex) { A = e.Alpha };
            m = new StandardMaterial3D { ResourceName = $"m{cache.Count}", AlbedoColor = c, Roughness = 0.8f };
            m.SetMeta("real", e.Name);
            if (e.Alpha < 1) m.Transparency = BaseMaterial3D.TransparencyEnum.Alpha;
            cache[key] = m;
        }
        return m;
    }
}

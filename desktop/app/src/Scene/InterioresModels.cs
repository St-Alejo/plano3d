using System.Net.Http;
using Godot;
using Plano3D.Core.Geometry;

namespace Plano3D.App.Scene;

/// <summary>
/// Modelos reales de los muebles diseñados en Interiores 3D. La caja del mueble se ve al
/// instante; cuando llega el GLB (una descarga por pieza, en caché) se dibuja encajado en esa
/// caja y la caja se oculta (sigue sirviendo para elegirlo con el ratón y para Blender).
/// Sin Interiores encendido, el mueble se queda como caja.
/// </summary>
public static class InterioresModels
{
    private static readonly System.Net.Http.HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private static readonly Dictionary<string, Task<byte[]?>> Cache = [];

    /// <summary><c>PLANO3D_INTERIORES_URL</c>; en local, el Docker de Interiores.</summary>
    public static string BaseUrl =>
        System.Environment.GetEnvironmentVariable("PLANO3D_INTERIORES_URL") is { Length: > 0 } url ? url : "http://localhost:8088";

    private static Task<byte[]?> Download(string catalogId)
    {
        if (!Cache.TryGetValue(catalogId, out var task))
        {
            Cache[catalogId] = task = Fetch(ExternalModels.ModelUrl(BaseUrl, catalogId));
        }
        return task;
    }

    private static async Task<byte[]?> Fetch(string url)
    {
        try
        {
            return await Http.GetByteArrayAsync(url);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            GD.Print($"Interiores no respondió ({url}): el mueble queda como caja");
            return null;
        }
    }

    /// <summary>Pone el modelo de la pieza junto a su caja (en el mismo nodo del mueble).</summary>
    public static async void Attach(Node3D holder, MeshInstance3D box, Vec3 size, string catalogId)
    {
        var bytes = await Download(catalogId);
        // el await vuelve al hilo principal de Godot; el mueble pudo borrarse mientras tanto
        if (bytes is null || !GodotObject.IsInstanceValid(holder) || !GodotObject.IsInstanceValid(box)) return;
        var doc = new GltfDocument();
        var state = new GltfState();
        if (doc.AppendFromBuffer(bytes, "", state) != Error.Ok || doc.GenerateScene(state) is not Node3D scene) return;

        var bounds = Bounds(scene, Transform3D.Identity);
        if (bounds is not { } aabb)
        {
            scene.Free();
            return;
        }
        var (s, t) = ExternalModels.Fit(
            new Vec3(aabb.Position.X, aabb.Position.Y, aabb.Position.Z),
            new Vec3(aabb.Size.X, aabb.Size.Y, aabb.Size.Z),
            size);
        var fitted = new Node3D
        {
            Name = "Modelo",
            Scale = new Vector3((float)s.X, (float)s.Y, (float)s.Z),
            Position = new Vector3((float)t.X, (float)t.Y, (float)t.Z),
        };
        fitted.AddChild(scene);
        var frame = new Node3D { Name = "Interiores", Transform = box.Transform };
        frame.AddChild(fitted);
        holder.AddChild(frame);
        box.Visible = false;
    }

    /// <summary>Caja envolvente de todas las mallas, en el marco de la raíz del modelo.</summary>
    private static Aabb? Bounds(Node node, Transform3D parent)
    {
        Aabb? total = null;
        var here = node is Node3D n ? parent * n.Transform : parent;
        if (node is MeshInstance3D { Mesh: not null } mi) total = here * mi.Mesh.GetAabb();
        foreach (var child in node.GetChildren())
        {
            if (Bounds(child, here) is not { } b) continue;
            total = total is { } t ? t.Merge(b) : b;
        }
        return total;
    }
}

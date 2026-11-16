using Godot;
using Plano3D.Core.Geometry;
using Plano3D.Core.Model;

namespace Plano3D.App.Scene;

/// <summary>Convierte la geometría del núcleo (cajas y polígonos en metros) en nodos de Godot.</summary>
public static class MeshFactory
{
    private static readonly Dictionary<(float, float, float), BoxMesh> Boxes = [];

    public static Vector3 V(Vec3 v) => new((float)v.X, (float)v.Y, (float)v.Z);

    /// <summary>Malla de caja con su cuerpo de colisión (para elegir con el mouse).</summary>
    public static MeshInstance3D Box(Box b, Material material, string entityId, bool pickable = true)
    {
        var size = V(b.Size);
        var key = (MathF.Round(size.X, 3), MathF.Round(size.Y, 3), MathF.Round(size.Z, 3));
        if (!Boxes.TryGetValue(key, out var mesh)) Boxes[key] = mesh = new BoxMesh { Size = size };
        var mi = new MeshInstance3D
        {
            Mesh = mesh,
            MaterialOverride = material,
            Position = V(b.Center),
            Rotation = new Vector3(0, (float)b.Yaw, 0),
        };
        if (pickable)
        {
            var body = new StaticBody3D();
            body.SetMeta("entity", entityId);
            body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = size } });
            mi.AddChild(body);
        }
        return mi;
    }

    /// <summary>Piso de un ambiente: el polígono triangulado a la altura del nivel.</summary>
    public static MeshInstance3D? Floor(IReadOnlyList<Point2> polygon, float y, Material material, string entityId)
    {
        var tri = BuildingGeometry.Triangulate(polygon);
        if (tri.Count < 3) return null;
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        foreach (var i in tri)
        {
            var p = polygon[i];
            st.SetNormal(Vector3.Up);
            st.SetUV(new Vector2((float)p.X, (float)p.Y));
            st.AddVertex(new Vector3((float)p.X, y, (float)p.Y));
        }
        var mesh = st.Commit();
        var mi = new MeshInstance3D { Mesh = mesh, MaterialOverride = material, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
        var body = new StaticBody3D();
        body.SetMeta("entity", entityId);
        body.AddChild(new CollisionShape3D { Shape = mesh.CreateTrimeshShape() });
        mi.AddChild(body);
        return mi;
    }
}

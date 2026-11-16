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
    /// <summary>Capa física de lo macizo: se elige con el ratón y choca al caminar.</summary>
    public const uint SolidLayer = 1;
    /// <summary>Capa de lo que solo se elige (hojas de puerta, peldaños): al caminar no estorba.</summary>
    public const uint PickLayer = 4;
    /// <summary>Capa del terreno y las rampas invisibles para caminar.</summary>
    public const uint WalkLayer = 8;

    public static MeshInstance3D Box(Box b, Material material, string entityId, bool pickable = true, uint layer = SolidLayer)
    {
        var size = V(b.Size);
        var key = (MathF.Round(size.X, 3), MathF.Round(size.Y, 3), MathF.Round(size.Z, 3));
        if (!Boxes.TryGetValue(key, out var mesh)) Boxes[key] = mesh = new BoxMesh { Size = size };
        var mi = new MeshInstance3D
        {
            Mesh = mesh,
            MaterialOverride = material,
            Position = V(b.Center),
            Rotation = new Vector3(0, (float)b.Yaw, (float)b.Pitch),
        };
        if (pickable)
        {
            var body = new StaticBody3D { CollisionLayer = layer, CollisionMask = 0 };
            body.SetMeta("entity", entityId);
            body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = size } });
            mi.AddChild(body);
        }
        return mi;
    }

    /// <summary>
    /// Losa bajo el piso de un ambiente (prisma del polígono, de <paramref name="top"/> hacia
    /// abajo): desde afuera los pisos de arriba se ven apoyados, no flotando.
    /// </summary>
    public static MeshInstance3D? Slab(IReadOnlyList<Point2> polygon, float top, float thickness, Material material)
    {
        var tri = BuildingGeometry.Triangulate(polygon);
        if (tri.Count < 3) return null;
        var bottom = top - thickness;
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        Vector3 At(Point2 p, float y) => new((float)p.X, y, (float)p.Y);
        // cara de abajo (mirando hacia abajo: orden invertido)
        for (var i = 0; i < tri.Count; i += 3)
        {
            foreach (var k in new[] { tri[i], tri[i + 2], tri[i + 1] })
            {
                st.SetNormal(Vector3.Down);
                st.AddVertex(At(polygon[k], bottom));
            }
        }
        // cantos
        var ccw = BuildingGeometry.SignedArea(polygon) > 0;
        for (var i = 0; i < polygon.Count; i++)
        {
            var a = polygon[i];
            var b = polygon[(i + 1) % polygon.Count];
            if (!ccw) (a, b) = (b, a);
            var edge = new Vector3((float)(b.X - a.X), 0, (float)(b.Y - a.Y));
            var n = new Vector3(edge.Z, 0, -edge.X).Normalized();
            Vector3[] quad = [At(a, top), At(b, top), At(b, bottom), At(a, top), At(b, bottom), At(a, bottom)];
            foreach (var v in quad)
            {
                st.SetNormal(n);
                st.AddVertex(v);
            }
        }
        return new MeshInstance3D { Mesh = st.Commit(), MaterialOverride = material };
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

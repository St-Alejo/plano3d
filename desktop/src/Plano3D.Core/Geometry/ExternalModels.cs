namespace Plano3D.Core.Geometry;

/// <summary>
/// Muebles diseñados en Interiores 3D (ADR-024): su <c>catalog_id</c> es <c>int_&lt;id&gt;</c> y
/// su modelo real (GLB) lo sirve Interiores. Aquí, sin motor gráfico, la dirección del modelo y
/// cómo encajarlo en la caja del mueble; el escritorio lo descarga y lo dibuja.
/// </summary>
public static class ExternalModels
{
    public const string InterioresPrefix = "int_";

    public static bool IsInteriores(string catalogId) =>
        catalogId.StartsWith(InterioresPrefix, StringComparison.Ordinal) && catalogId.Length > InterioresPrefix.Length;

    /// <summary>Dirección del GLB de la pieza en Interiores.</summary>
    public static string ModelUrl(string baseUrl, string catalogId) =>
        $"{baseUrl.TrimEnd('/')}/api/catalog/{Uri.EscapeDataString(catalogId[InterioresPrefix.Length..])}/model.glb";

    /// <summary>
    /// Escala por eje y traslado para que un modelo de caja envolvente (<paramref name="min"/>,
    /// <paramref name="size"/>) ocupe exactamente la caja del mueble (<paramref name="target"/>),
    /// centrado en x/z y apoyado en su base. El resultado queda en el marco de la caja, cuyo
    /// origen es su centro: punto final = punto × escala + traslado.
    /// </summary>
    public static (Vec3 Scale, Vec3 Offset) Fit(Vec3 min, Vec3 size, Vec3 target)
    {
        static double Ratio(double want, double have) => have > 1e-6 ? want / have : 1;
        var s = new Vec3(Ratio(target.X, size.X), Ratio(target.Y, size.Y), Ratio(target.Z, size.Z));
        var t = new Vec3(
            -(min.X + size.X / 2) * s.X,
            -min.Y * s.Y - target.Y / 2,
            -(min.Z + size.Z / 2) * s.Z);
        return (s, t);
    }
}

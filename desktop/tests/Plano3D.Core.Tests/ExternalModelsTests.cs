using Plano3D.Core.Geometry;
using Xunit;

namespace Plano3D.Core.Tests;

public class ExternalModelsTests
{
    [Fact]
    public void RecognizesInterioresFurnitureOnly()
    {
        Assert.True(ExternalModels.IsInteriores("int_p-sofa-2p-gris"));
        Assert.False(ExternalModels.IsInteriores("sofa_3p"));
        Assert.False(ExternalModels.IsInteriores("int_"));
    }

    [Fact]
    public void ModelUrlPointsToTheInterioresCatalog()
    {
        Assert.Equal(
            "http://localhost:8088/api/catalog/p-sofa-2p-gris/model.glb",
            ExternalModels.ModelUrl("http://localhost:8088/", "int_p-sofa-2p-gris"));
    }

    [Fact]
    public void FitFillsTheFurnitureBoxCenteredAndOnTheFloor()
    {
        // modelo de 1 × 0.5 × 2 con la esquina en (1, 0.2, -1); caja del mueble 2 × 0.8 × 1
        var min = new Vec3(1, 0.2, -1);
        var size = new Vec3(1, 0.5, 2);
        var target = new Vec3(2, 0.8, 1);
        var (s, t) = ExternalModels.Fit(min, size, target);

        Vec3 Map(Vec3 p) => new(p.X * s.X + t.X, p.Y * s.Y + t.Y, p.Z * s.Z + t.Z);
        var lo = Map(min);
        var hi = Map(new Vec3(min.X + size.X, min.Y + size.Y, min.Z + size.Z));
        Assert.Equal(-1, lo.X, 9);
        Assert.Equal(1, hi.X, 9);
        Assert.Equal(-0.4, lo.Y, 9); // base del mueble (la caja tiene su origen en el centro)
        Assert.Equal(0.4, hi.Y, 9);
        Assert.Equal(-0.5, lo.Z, 9);
        Assert.Equal(0.5, hi.Z, 9);
    }

    [Fact]
    public void FlatModelsKeepTheirScaleOnTheEmptyAxis()
    {
        var (s, _) = ExternalModels.Fit(new Vec3(0, 0, 0), new Vec3(1, 0, 1), new Vec3(2, 0.1, 2));
        Assert.Equal(1, s.Y, 9);
    }
}

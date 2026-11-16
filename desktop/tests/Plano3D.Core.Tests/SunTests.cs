using Plano3D.Core.Lighting;
using Xunit;

namespace Plano3D.Core.Tests;

/// <summary>Los mismos casos que <c>frontend/src/domain/sun.test.ts</c>.</summary>
public class SunTests
{
    private static readonly DateOnly Equinox = new(2026, 3, 20);

    [Fact]
    public void EquinoccioAMediodiaSolarCasiVertical()
    {
        var s = Sun.Position(Equinox, 11.95);
        Assert.InRange(s.Altitude, 84, 86.5);
    }

    [Fact]
    public void SalePorElOrienteYSePonePorElOccidente()
    {
        var morning = Sun.Position(Equinox, 7);
        var evening = Sun.Position(Equinox, 17);
        Assert.True(morning.IsDay);
        Assert.InRange(morning.Azimuth, 80, 100);
        Assert.InRange(evening.Azimuth, 260, 280);
        Assert.False(Sun.Position(Equinox, 0).IsDay);
    }

    [Fact]
    public void EnJunioVaAlNorteYEnDiciembreAlSur()
    {
        var june = Sun.Position(new DateOnly(2026, 6, 21), 12);
        var dec = Sun.Position(new DateOnly(2026, 12, 21), 12);
        Assert.True(Math.Cos(june.Azimuth * Math.PI / 180) > 0);
        Assert.True(Math.Cos(dec.Azimuth * Math.PI / 180) < 0);
        Assert.Equal(90 - (23.44 - Place.Bogota.Lat), june.Altitude, 0);
    }

    [Fact]
    public void LaDireccionEsUnitariaYApuntaArribaDeDia()
    {
        var (x, y, z) = Sun.Direction(new SunPosition(30, 90));
        Assert.Equal(1, Math.Sqrt(x * x + y * y + z * z), 6);
        Assert.True(x > 0.8);
        Assert.Equal(0.5, y, 6);
    }

    [Fact]
    public void LaLuzSeApagaDeNocheYSeEntibiaAlAtardecer()
    {
        Assert.Equal(0, Sun.Light(new SunPosition(-20, 0)).Energy);
        var low = Sun.Light(new SunPosition(5, 270));
        var high = Sun.Light(new SunPosition(60, 180));
        Assert.True(low.Kelvin < high.Kelvin);
        Assert.True(low.Energy < high.Energy);
    }
}

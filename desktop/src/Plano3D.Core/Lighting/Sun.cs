namespace Plano3D.Core.Lighting;

/// <summary>Un lugar de la Tierra con su huso horario (horas respecto a UTC).</summary>
public sealed record Place(double Lat, double Lon, double UtcOffset)
{
    public static readonly Place Bogota = new(4.711, -74.072, -5);
}

/// <summary>Altitud en grados sobre el horizonte (negativa de noche) y azimut desde el norte, horario (90 = este).</summary>
public readonly record struct SunPosition(double Altitude, double Azimuth)
{
    public bool IsDay => Altitude > 0;
}

/// <summary>
/// Posición del sol (aproximación de la NOAA, error &lt; 1°), igual que <c>domain/sun.ts</c> de la
/// web: suficiente para estudiar asoleamiento y sombras en un modelo arquitectónico.
/// </summary>
public static class Sun
{
    private static double Rad(double d) => d * Math.PI / 180;
    private static double Deg(double r) => r * 180 / Math.PI;

    /// <param name="hour">hora local en decimal (14.5 = 2:30 p. m.) en el huso del lugar</param>
    public static SunPosition Position(DateOnly date, double hour, Place? place = null)
    {
        var p = place ?? Place.Bogota;
        var n = date.DayOfYear;
        var g = 2 * Math.PI / 365 * (n - 1 + (hour - 12) / 24);
        var eqTime = 229.18 * (0.000075 + 0.001868 * Math.Cos(g) - 0.032077 * Math.Sin(g) - 0.014615 * Math.Cos(2 * g) - 0.040849 * Math.Sin(2 * g));
        var decl = 0.006918 - 0.399912 * Math.Cos(g) + 0.070257 * Math.Sin(g) - 0.006758 * Math.Cos(2 * g)
                   + 0.000907 * Math.Sin(2 * g) - 0.002697 * Math.Cos(3 * g) + 0.00148 * Math.Sin(3 * g);
        var trueSolarMin = hour * 60 + eqTime + 4 * p.Lon - 60 * p.UtcOffset;
        var hourAngle = Rad(trueSolarMin / 4 - 180);
        var lat = Rad(p.Lat);
        var cosZen = Math.Sin(lat) * Math.Sin(decl) + Math.Cos(lat) * Math.Cos(decl) * Math.Cos(hourAngle);
        var zenith = Math.Acos(Math.Clamp(cosZen, -1, 1));
        var az = Math.Atan2(Math.Sin(hourAngle), Math.Cos(hourAngle) * Math.Sin(lat) - Math.Tan(decl) * Math.Cos(lat));
        return new SunPosition(90 - Deg(zenith), (Deg(az) + 180 + 360) % 360);
    }

    /// <summary>
    /// Dirección hacia el sol en la escena (x = este, y = arriba, z = sur): el norte del plano
    /// está arriba de la hoja (−y del plano = −z de la escena). <paramref name="northDeg"/> lo gira.
    /// </summary>
    public static (double X, double Y, double Z) Direction(SunPosition sun, double northDeg = 0)
    {
        var alt = Rad(sun.Altitude);
        var az = Rad(sun.Azimuth - northDeg);
        return (Math.Cos(alt) * Math.Sin(az), Math.Sin(alt), -Math.Cos(alt) * Math.Cos(az));
    }

    /// <summary>
    /// Luz del sol para la escena según su altura: intensidad (0 de noche), temperatura de
    /// color en kelvin (cálida al amanecer y al atardecer) y cuánto aporta el cielo.
    /// </summary>
    public static (double Energy, double Kelvin, double Sky) Light(SunPosition sun)
    {
        var alt = sun.Altitude;
        if (alt <= -6) return (0, 4000, 0.06); // noche cerrada
        if (alt <= 0) return (0, 2600, 0.06 + 0.3 * (alt + 6) / 6); // crepúsculo: solo cielo
        var t = Math.Clamp(alt / 25, 0, 1); // bajo 25° la luz se enrojece y se debilita
        return (0.35 + 0.85 * t, 2700 + (5600 - 2700) * t, 0.36 + 0.64 * t);
    }
}

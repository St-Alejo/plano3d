using Godot;
using Plano3D.Core.Lighting;

namespace Plano3D.App.Scene;

/// <summary>Niveles de calidad gráfica (de lo que corre en un portátil sin GPU a lo de presentar).</summary>
public enum Quality { Bajo, Medio, Alto, Ultra, Presentacion }

/// <summary>
/// La luz y el aire de la escena: cielo, sol según fecha, hora y lugar (el mismo cálculo de la
/// NOAA que la web), lámparas de noche, exposición y los efectos de cada nivel de calidad
/// (SSAO, SSIL, SDFGI, SSR, niebla volumétrica, sombras suaves, TAA/FSR). Patrón Facade:
/// el editor solo dice «calidad Alta» o «las 6 de la tarde».
/// </summary>
public partial class Atmosphere : Node3D
{
    private readonly Godot.Environment _env;
    private readonly ProceduralSkyMaterial _sky;
    private readonly DirectionalLight3D _sun;
    private readonly CameraAttributesPractical _camera = new() { AutoExposureEnabled = false, ExposureMultiplier = 1 };

    public Quality Quality { get; private set; } = Quality.Alto;
    public DateOnly Date { get; private set; } = DateOnly.FromDateTime(DateTime.Today);
    public double Hour { get; private set; } = 10.5;
    public Place Place { get; set; } = Place.Bogota;
    public SunPosition SunNow { get; private set; }

    /// <summary>Se prende o apaga la luz de los ambientes (la escena decide qué lámparas).</summary>
    public event Action<bool>? NightChanged;
    private bool _night;

    public CameraAttributesPractical CameraAttributes => _camera;

    public Atmosphere()
    {
        Name = "Ambiente";
        _sky = new ProceduralSkyMaterial { SunAngleMax = 20, SunCurve = 0.08f };
        _env = new Godot.Environment
        {
            BackgroundMode = Godot.Environment.BGMode.Sky,
            Sky = new Sky { SkyMaterial = _sky, RadianceSize = Sky.RadianceSizeEnum.Size256 },
            AmbientLightSource = Godot.Environment.AmbientSource.Sky,
            ReflectedLightSource = Godot.Environment.ReflectionSource.Sky,
            TonemapMode = Godot.Environment.ToneMapper.Agx,
            TonemapExposure = 1.0f,
            SsaoRadius = 0.8f,
            SsaoIntensity = 1.6f,
            SsilRadius = 3,
            SsilIntensity = 0.8f,
            SsrMaxSteps = 64,
            SdfgiUseOcclusion = true,
            SdfgiEnergy = 0.9f,
            GlowIntensity = 0.35f,
            GlowBloom = 0.04f,
            GlowHdrThreshold = 1.2f,
            VolumetricFogDensity = 0.004f,
            VolumetricFogAlbedo = new Color("e8e4dc"),
            VolumetricFogLength = 80,
        };
        AddChild(new WorldEnvironment { Environment = _env, CameraAttributes = _camera });
        _sun = new DirectionalLight3D
        {
            Name = "Sol",
            ShadowEnabled = true,
            DirectionalShadowMaxDistance = 90,
            DirectionalShadowMode = DirectionalLight3D.ShadowMode.Parallel4Splits,
            ShadowBlur = 1.2f,
            LightAngularDistance = 0.5f,
        };
        AddChild(_sun);
        UpdateSun();
    }

    public void SetTime(DateOnly date, double hour)
    {
        Date = date;
        Hour = Math.Clamp(hour, 0, 24);
        UpdateSun();
    }

    public void SetExposure(float ev) => _camera.ExposureMultiplier = Mathf.Pow(2, ev);

    private void UpdateSun()
    {
        SunNow = Sun.Position(Date, Hour, Place);
        var (energy, kelvin, skyEnergy) = Sun.Light(SunNow);
        var night = SunNow.Altitude < 2;
        if (SunNow.Altitude > -6)
        {
            var (x, y, z) = Sun.Direction(new SunPosition(Math.Max(SunNow.Altitude, 1), SunNow.Azimuth));
            Aim(new Vector3((float)x, (float)y, (float)z));
            _sun.LightColor = SceneSync.Kelvin(kelvin);
            _sun.LightEnergy = (float)energy;
        }
        else
        {
            // de noche, una luna fría y tenue para que la casa no desaparezca
            Aim(new Vector3(-0.3f, 0.75f, 0.4f).Normalized());
            _sun.LightColor = new Color("9fb4d8");
            _sun.LightEnergy = 0.08f;
        }
        _sun.ShadowEnabled = _sun.LightEnergy > 0.05f;

        // el cielo se tiñe: día, atardecer, noche
        var day = (float)Math.Clamp((SunNow.Altitude + 4) / 24, 0, 1);
        var dusk = (float)Math.Clamp(1 - Math.Abs(SunNow.Altitude - 2) / 10, 0, 1);
        Color Mix(string night, string noon, string sunset) => new Color(night).Lerp(new Color(noon), day).Lerp(new Color(sunset), dusk * 0.7f);
        _sky.SkyTopColor = Mix("0b1324", "6f9fd6", "56679a");
        _sky.SkyHorizonColor = Mix("1b2436", "e3e6e4", "f1b07a");
        _sky.GroundHorizonColor = Mix("1b2436", "e3e1d9", "d9a27a");
        _sky.GroundBottomColor = Mix("0e1118", "b9b2a4", "6b5a4c");
        _sky.SunAngleMax = 20 + 25 * dusk;
        _env.AmbientLightEnergy = (float)Math.Max(skyEnergy, 0.12);
        _env.AmbientLightSkyContribution = 1;
        _env.TonemapExposure = night ? 1.25f : 1.0f;

        if (night != _night)
        {
            _night = night;
            NightChanged?.Invoke(night);
        }
    }

    private void Aim(Vector3 towardSun)
    {
        var up = Mathf.Abs(towardSun.Y) > 0.98f ? Vector3.Forward : Vector3.Up;
        _sun.Basis = Basis.LookingAt(-towardSun, up);
    }

    public bool IsNight => _night;

    /// <summary>Aplica un nivel de calidad: efectos del entorno, sombras, antialias y escala.</summary>
    public void SetQuality(Quality q, Viewport viewport)
    {
        Quality = q;
        var high = q >= Quality.Alto;
        var ultra = q >= Quality.Ultra;
        _env.SsaoEnabled = q >= Quality.Medio;
        _env.SsilEnabled = high;
        _env.SsrEnabled = high;
        _env.SsrMaxSteps = ultra ? 96 : 48;
        _env.SdfgiEnabled = high;
        _env.SdfgiCascades = ultra ? 6 : 4;
        _env.SdfgiMinCellSize = ultra ? 0.15f : 0.25f;
        _env.GlowEnabled = q >= Quality.Medio;
        _env.VolumetricFogEnabled = ultra;
        _sun.ShadowBlur = ultra ? 1.6f : 1.0f;
        _sun.LightAngularDistance = ultra ? 0.5f : 0;

        RenderingServer.DirectionalShadowAtlasSetSize(q switch { Quality.Bajo => 2048, Quality.Medio => 4096, _ => 8192 }, true);
        RenderingServer.DirectionalSoftShadowFilterSetQuality(q switch
        {
            Quality.Bajo => RenderingServer.ShadowQuality.Hard,
            Quality.Medio => RenderingServer.ShadowQuality.SoftLow,
            Quality.Alto => RenderingServer.ShadowQuality.SoftMedium,
            Quality.Ultra => RenderingServer.ShadowQuality.SoftHigh,
            _ => RenderingServer.ShadowQuality.SoftUltra,
        });
        RenderingServer.EnvironmentSetSsaoQuality(ultra ? RenderingServer.EnvironmentSsaoQuality.Ultra : high ? RenderingServer.EnvironmentSsaoQuality.High : RenderingServer.EnvironmentSsaoQuality.Medium, true, 0.5f, 2, 50, 300);
        RenderingServer.EnvironmentSetSdfgiRayCount(ultra ? RenderingServer.EnvironmentSdfgiRayCount.Count64 : RenderingServer.EnvironmentSdfgiRayCount.Count32);
        RenderingServer.EnvironmentSetVolumetricFogVolumeSize(ultra ? 128 : 64, 64);

        viewport.Msaa3D = q switch { Quality.Bajo => Viewport.Msaa.Disabled, Quality.Presentacion => Viewport.Msaa.Msaa4X, _ => Viewport.Msaa.Msaa2X };
        viewport.UseTaa = ultra;
        viewport.ScreenSpaceAA = q == Quality.Bajo ? Viewport.ScreenSpaceAAEnum.Fxaa : Viewport.ScreenSpaceAAEnum.Disabled;
        // Presentación: FSR 2 a resolución completa funciona como un antialias temporal de alta calidad
        viewport.Scaling3DMode = q == Quality.Presentacion ? Viewport.Scaling3DModeEnum.Fsr2 : Viewport.Scaling3DModeEnum.Bilinear;
        viewport.Scaling3DScale = q == Quality.Bajo ? 0.85f : 1f;
        viewport.MeshLodThreshold = q == Quality.Bajo ? 4 : 1;
    }

    public static string Label(Quality q) => q switch
    {
        Quality.Bajo => "Baja",
        Quality.Medio => "Media",
        Quality.Alto => "Alta",
        Quality.Ultra => "Ultra",
        _ => "Presentación",
    };
}

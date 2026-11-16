using System.Globalization;
using Godot;
using Plano3D.App.Scene;

namespace Plano3D.App.Screens;

/// <summary>
/// La parte «de presentación» del editor: panel de luz (hora, fecha, calidad, exposición),
/// modo foto (focal, desenfoque, retícula, capturas hasta 4K) y contador de FPS.
/// </summary>
public partial class EditorScreen
{
    private PanelContainer _lightPanel = null!;
    private Label _sunLabel = null!;
    private HSlider _hourSlider = null!;
    private Label _fps = null!;
    private Control _photo = null!;
    private Label _photoInfo = null!;
    private readonly List<(Control Node, bool Visible)> _hiddenForPhoto = [];
    private float _focal = 28;
    private bool _dof;
    private bool _grid = true;
    private double _fpsTimer;

    public Atmosphere Atmosphere => _atmosphere;
    public bool PhotoMode => _photo.Visible;

    private void BuildScenePanels()
    {
        var settings = _main.Settings;
        _atmosphere.SetQuality((Quality)settings.Quality, _main.GetViewport());

        var light = Ui.Flat("☀ Luz");
        light.TooltipText = "Hora, fecha, calidad gráfica y modo foto (L)";
        light.Pressed += () => ToggleLightPanel();
        _topRow.AddChild(light);
        _topRow.MoveChild(light, _commandButton.GetIndex());

        // ---------------------------------------------------------------- panel de luz
        _lightPanel = new PanelContainer { Visible = false };
        _lightPanel.AddThemeStyleboxOverride("panel", Ui.Box(new Color(Ui.Surface, 0.97f), 14, Ui.Line, 14));
        _lightPanel.SetAnchorsPreset(LayoutPreset.TopRight);
        _lightPanel.OffsetLeft = -330;
        _lightPanel.OffsetRight = -16;
        _lightPanel.OffsetTop = 84;
        AddChild(_lightPanel);
        var col = new VBoxContainer { CustomMinimumSize = new Vector2(290, 0) };
        col.AddThemeConstantOverride("separation", 8);
        _lightPanel.AddChild(col);
        col.AddChild(Ui.Text("Luz y presentación", 16));
        _sunLabel = Ui.Text("", 12, Ui.Muted, wrap: true);
        col.AddChild(_sunLabel);

        col.AddChild(Ui.Text("Hora", 13, Ui.Muted));
        var hour = _hourSlider = new HSlider { MinValue = 0, MaxValue = 24, Step = 0.25, Value = _atmosphere.Hour, TooltipText = "Hora local (Bogotá)" };
        hour.ValueChanged += v =>
        {
            _atmosphere.SetTime(_atmosphere.Date, v);
            UpdateSunLabel();
        };
        col.AddChild(hour);
        var presets = new HBoxContainer();
        presets.AddThemeConstantOverride("separation", 4);
        foreach (var (label, h) in new[] { ("Mañana", 8.0), ("Mediodía", 12.0), ("Tarde", 16.5), ("Atardecer", 17.0), ("Noche", 20.5) })
        {
            var b = Ui.Flat(label);
            b.AddThemeFontSizeOverride("font_size", 12);
            b.Pressed += () => hour.Value = h;
            presets.AddChild(b);
        }
        col.AddChild(presets);

        col.AddChild(Ui.Text("Fecha", 13, Ui.Muted));
        var day = new HSlider { MinValue = 1, MaxValue = 365, Step = 1, Value = _atmosphere.Date.DayOfYear, TooltipText = "Día del año: cambia la altura del sol" };
        day.ValueChanged += v =>
        {
            _atmosphere.SetTime(new DateOnly(_atmosphere.Date.Year, 1, 1).AddDays((int)v - 1), _atmosphere.Hour);
            UpdateSunLabel();
        };
        col.AddChild(day);

        col.AddChild(Ui.Text("Exposición", 13, Ui.Muted));
        var exposure = new HSlider { MinValue = -2, MaxValue = 2, Step = 0.1, Value = 0, TooltipText = "Pasos de exposición (EV)" };
        exposure.ValueChanged += v => _atmosphere.SetExposure((float)v);
        col.AddChild(exposure);

        col.AddChild(Ui.Text("Calidad gráfica", 13, Ui.Muted));
        var quality = new OptionButton();
        foreach (var q in Enum.GetValues<Quality>()) quality.AddItem(Atmosphere.Label(q), (int)q);
        quality.Selected = settings.Quality;
        quality.ItemSelected += i =>
        {
            SetQuality((Quality)(int)i);
        };
        col.AddChild(quality);
        col.AddChild(Ui.Text("Alta: luz global en tiempo real, reflejos y oclusión. Ultra y Presentación suman niebla volumétrica, sombras más suaves y antialias temporal.", 11, Ui.Muted, wrap: true));

        var fps = new CheckButton { Text = "Mostrar FPS", ButtonPressed = settings.ShowFps };
        fps.Toggled += on =>
        {
            settings.ShowFps = on;
            settings.Save();
            _fps.Visible = on;
        };
        col.AddChild(fps);
        var people = new CheckButton { Text = "Personas caminando", TooltipText = "Simulación: van de un ambiente a otro por las puertas" };
        people.Toggled += SetPeople;
        col.AddChild(people);
        var photo = Ui.Primary("Modo foto");
        photo.TooltipText = "Encuadre limpio, focal, desenfoque y capturas en 4K";
        photo.Pressed += () => SetPhotoMode(true);
        col.AddChild(photo);
        UpdateSunLabel();

        // ---------------------------------------------------------------- FPS
        _fps = Ui.Text("", 12, Ui.Muted);
        _fps.SetAnchorsPreset(LayoutPreset.BottomRight);
        _fps.OffsetLeft = -150;
        _fps.OffsetTop = -52;
        _fps.OffsetRight = -16;
        _fps.HorizontalAlignment = HorizontalAlignment.Right;
        _fps.Visible = settings.ShowFps;
        AddChild(_fps);

        BuildPhotoOverlay();
    }

    public void SetQuality(Quality q)
    {
        _atmosphere.SetQuality(q, _main.GetViewport());
        _main.Settings.Quality = (int)q;
        _main.Settings.Save();
        Toast($"Calidad {Atmosphere.Label(q)}");
    }

    public void SetHour(double hour)
    {
        _atmosphere.SetTime(_atmosphere.Date, hour);
        UpdateSunLabel();
        _hourSlider.SetValueNoSignal(hour);
    }

    private void ToggleLightPanel() => _lightPanel.Visible = !_lightPanel.Visible;

    private void UpdateSunLabel()
    {
        var s = _atmosphere.SunNow;
        var date = _atmosphere.Date.ToString("d 'de' MMMM", Es);
        var time = TimeSpan.FromHours(_atmosphere.Hour % 24).ToString(@"hh\:mm", CultureInfo.InvariantCulture);
        _sunLabel.Text = s.IsDay
            ? $"Bogotá, {date}, {time}: sol a {s.Altitude:0}° sobre el horizonte, rumbo {s.Azimuth:0}° ({Rumbo(s.Azimuth)})."
            : $"Bogotá, {date}, {time}: de noche; se encienden las lámparas de los ambientes.";
    }

    private static string Rumbo(double az) => ((int)Math.Round(az / 45) % 8) switch
    {
        0 => "norte",
        1 => "noreste",
        2 => "este",
        3 => "sureste",
        4 => "sur",
        5 => "suroeste",
        6 => "oeste",
        _ => "noroeste",
    };

    private void UpdateFps(double delta)
    {
        if (!_fps.Visible || (_fpsTimer -= delta) > 0) return;
        _fpsTimer = 0.5;
        var ms = Performance.GetMonitor(Performance.Monitor.TimeProcess) * 1000;
        var draws = Performance.GetMonitor(Performance.Monitor.RenderTotalDrawCallsInFrame);
        _fps.Text = $"{Engine.GetFramesPerSecond():0} FPS · {ms:0.0} ms · {draws:0} llamadas";
    }

    // ------------------------------------------------------------------ modo foto
    private void BuildPhotoOverlay()
    {
        _photo = new Control { Name = "ModoFoto", Visible = false, MouseFilter = MouseFilterEnum.Ignore };
        _photo.SetAnchorsPreset(LayoutPreset.FullRect);
        AddChild(_photo);
        var grid = new PhotoGrid { MouseFilter = MouseFilterEnum.Ignore };
        grid.SetAnchorsPreset(LayoutPreset.FullRect);
        _photo.AddChild(grid);

        var bar = new PanelContainer();
        bar.AddThemeStyleboxOverride("panel", Ui.Box(new Color(Ui.Ink, 0.82f), 14, null, 10));
        bar.SetAnchorsPreset(LayoutPreset.CenterBottom);
        bar.GrowHorizontal = GrowDirection.Both;
        bar.OffsetTop = -78;
        bar.OffsetBottom = -18;
        _photo.AddChild(bar);
        var row = new HBoxContainer();
        row.AddThemeConstantOverride("separation", 10);
        bar.AddChild(row);
        Label Light(string t) => Ui.Text(t, 13, Ui.Paper);
        row.AddChild(Light("Focal"));
        var focal = new HSlider { MinValue = 14, MaxValue = 85, Step = 1, Value = _focal, CustomMinimumSize = new Vector2(140, 0), TooltipText = "Distancia focal equivalente (mm)" };
        focal.ValueChanged += v =>
        {
            _focal = (float)v;
            ApplyLens();
        };
        row.AddChild(focal);
        var dof = new CheckButton { Text = "Desenfoque", ButtonPressed = _dof };
        dof.AddThemeColorOverride("font_color", Ui.Paper);
        dof.Toggled += on =>
        {
            _dof = on;
            ApplyLens();
        };
        row.AddChild(dof);
        var gridToggle = new CheckButton { Text = "Retícula", ButtonPressed = _grid };
        gridToggle.AddThemeColorOverride("font_color", Ui.Paper);
        gridToggle.Toggled += on => grid.Visible = _grid = on;
        row.AddChild(gridToggle);
        var shot = Ui.Secondary("Capturar");
        shot.Pressed += () => _ = CaptureAsync(1);
        row.AddChild(shot);
        var shot4k = Ui.Primary("Capturar 4K");
        shot4k.Pressed += () => _ = CaptureAsync(0);
        row.AddChild(shot4k);
        var exit = Ui.Secondary("Salir (Esc)");
        exit.Pressed += () => SetPhotoMode(false);
        row.AddChild(exit);
        _photoInfo = Ui.Text("", 12, Ui.Paper);
        _photoInfo.SetAnchorsPreset(LayoutPreset.TopLeft);
        _photoInfo.Position = new Vector2(20, 16);
        _photo.AddChild(_photoInfo);
    }

    public void SetPhotoMode(bool on)
    {
        if (on == _photo.Visible) return;
        if (on)
        {
            SetMode(ViewMode.Model3D);
            _lightPanel.Visible = false;
            _hiddenForPhoto.Clear();
            foreach (var c in GetChildren().OfType<Control>().Where(c => c != _photo && c.Visible))
            {
                _hiddenForPhoto.Add((c, true));
                c.Visible = false;
            }
            _photo.Visible = true;
            Reselect();
            ApplyLens();
        }
        else
        {
            _photo.Visible = false;
            foreach (var (c, v) in _hiddenForPhoto) c.Visible = v;
            _hiddenForPhoto.Clear();
            _camera.Fov = 50;
            _atmosphere.CameraAttributes.DofBlurFarEnabled = false;
            _atmosphere.CameraAttributes.DofBlurNearEnabled = false;
            Reselect();
        }
    }

    /// <summary>Focal en mm (equivalente 35 mm: sensor de 24 mm de alto) y desenfoque al punto mirado.</summary>
    private void ApplyLens()
    {
        _camera.Fov = Mathf.RadToDeg(2 * Mathf.Atan(12f / _focal));
        var attrs = _atmosphere.CameraAttributes;
        var focus = _camera.OrbitDistance;
        attrs.DofBlurFarEnabled = _dof;
        attrs.DofBlurFarDistance = focus + 2;
        attrs.DofBlurFarTransition = Math.Max(4, focus * 0.6f);
        attrs.DofBlurNearEnabled = _dof;
        attrs.DofBlurNearDistance = Math.Max(0.5f, focus * 0.35f);
        attrs.DofBlurNearTransition = 1.5f;
        attrs.DofBlurAmount = 0.08f;
        _photoInfo.Text = $"{_focal:0} mm · foco a {focus:0.0} m · calidad {Atmosphere.Label(_atmosphere.Quality)}";
    }

    /// <summary>
    /// Captura la vista: <paramref name="scale"/> 1 = tamaño de la ventana; 0 = 3840×2160 en un
    /// SubViewport que comparte el mundo (mismo cielo, luz y casa) con su propia cámara.
    /// Se guarda en Imágenes\Plano 3D.
    /// </summary>
    public async Task<string?> CaptureAsync(int scale, string? path = null)
    {
        var tree = GetTree();
        path ??= System.IO.Path.Combine(OS.GetSystemDir(OS.SystemDir.Pictures), "Plano 3D", $"plano3d-{DateTime.Now:yyyyMMdd-HHmmss}.png");
        System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!);
        Image img;
        if (scale == 1)
        {
            var hide = _photo.Visible;
            if (hide) _photo.Visible = false;
            await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            img = GetViewport().GetTexture().GetImage();
            if (hide) _photo.Visible = true;
        }
        else
        {
            var main = GetViewport();
            var sub = new SubViewport
            {
                Size = new Vector2I(3840, 2160),
                World3D = main.FindWorld3D(),
                Msaa3D = Viewport.Msaa.Msaa4X,
                UseTaa = main.UseTaa,
                Scaling3DMode = main.Scaling3DMode == Viewport.Scaling3DModeEnum.Fsr2 ? Viewport.Scaling3DModeEnum.Fsr2 : Viewport.Scaling3DModeEnum.Bilinear,
                RenderTargetUpdateMode = SubViewport.UpdateMode.Always,
                PositionalShadowAtlasSize = 4096,
            };
            var cam = new Camera3D
            {
                Fov = _camera.Fov,
                Near = _camera.Near,
                Far = _camera.Far,
                Attributes = _camera.Attributes,
            };
            sub.AddChild(cam);
            AddChild(sub);
            cam.GlobalTransform = _camera.GlobalTransform;
            cam.Current = true;
            Toast("Renderizando 3840×2160…");
            // varios cuadros: la luz global, el TAA y las sombras se asientan
            for (var i = 0; i < 12; i++) await ToSignal(tree, SceneTree.SignalName.ProcessFrame);
            await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            img = sub.GetTexture().GetImage();
            sub.QueueFree();
        }
        var err = img.SavePng(path);
        if (err != Error.Ok)
        {
            Toast($"No se pudo guardar la captura ({err}).");
            return null;
        }
        Toast($"Captura guardada: {path}");
        return path;
    }
}

/// <summary>Retícula de tercios del modo foto.</summary>
public partial class PhotoGrid : Control
{
    public override void _Draw()
    {
        var c = new Color(1, 1, 1, 0.35f);
        var s = Size;
        for (var i = 1; i < 3; i++)
        {
            DrawLine(new Vector2(s.X * i / 3, 0), new Vector2(s.X * i / 3, s.Y), c, 1);
            DrawLine(new Vector2(0, s.Y * i / 3), new Vector2(s.X, s.Y * i / 3), c, 1);
        }
    }

    public override void _Notification(int what)
    {
        if (what == NotificationResized) QueueRedraw();
    }
}

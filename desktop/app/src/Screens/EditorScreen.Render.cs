using Godot;
using Plano3D.App.Scene;
using Plano3D.Infrastructure.Blender;

namespace Plano3D.App.Screens;

/// <summary>
/// Render fotorrealista con Blender sin salir de la app: arma el paquete (el mismo de la web),
/// corre Cycles en la GPU, muestra el avance por cámara y muestra, deja cada imagen en
/// Imágenes\Plano 3D\Renders y la sube a la galería del proyecto (la web la ve al instante).
/// Los pedidos hacen fila: se renderizan uno tras otro.
/// </summary>
public partial class EditorScreen
{
    public sealed record RenderJob(RenderQuality Quality, RenderHour Hour, string? Camera, bool Upload);

    private PanelContainer _renderPanel = null!;
    private Label _blenderLabel = null!;
    private OptionButton _renderQuality = null!;
    private OptionButton _renderHour = null!;
    private OptionButton _renderCamera = null!;
    private CheckButton _renderUpload = null!;
    private ProgressBar _renderBar = null!;
    private Label _renderStatus = null!;
    private Button _renderCancel = null!;
    private HFlowContainer _renderGallery = null!;
    private readonly Queue<RenderJob> _renderQueue = [];
    private CancellationTokenSource? _renderCts;
    private Task? _renderLoop;
    private string? _blender;

    /// <summary>Imágenes terminadas en esta sesión (rutas en Imágenes\Plano 3D\Renders).</summary>
    public List<string> Renders { get; } = [];
    /// <summary>Ids que dio el servidor a lo subido.</summary>
    public List<string> UploadedRenders { get; } = [];
    public bool Rendering => _renderLoop is { IsCompleted: false };
    public string? BlenderExe => _blender;
    public string RenderStatus => _renderStatus.Text;

    private static readonly (string Label, string? Filter)[] CameraChoices =
    [
        ("Vista actual", "Vista actual"),
        ("Fachada principal", "Fachada principal"),
        ("Calle (altura de ojos)", "Calle"),
        ("Aérea 3/4", "Aérea"),
        ("Interiores", "Interior"),
        ("Plantas (dibujo)", "Planta"),
        ("Alzado frontal", "Alzado"),
        ("Todas las cámaras", null),
    ];

    private void BuildRenderPanel()
    {
        var open = Ui.Flat("🎬 Render");
        open.TooltipText = "Imagen fotorrealista con Blender (Cycles en la tarjeta de video)";
        open.Pressed += () => ToggleRenderPanel();
        _topRow.AddChild(open);
        _topRow.MoveChild(open, _commandButton.GetIndex());

        _renderPanel = new PanelContainer { Visible = false };
        _renderPanel.AddThemeStyleboxOverride("panel", Ui.Box(new Color(Ui.Surface, 0.97f), 14, Ui.Line, 14));
        _renderPanel.SetAnchorsPreset(LayoutPreset.TopRight);
        _renderPanel.OffsetLeft = -366;
        _renderPanel.OffsetRight = -16;
        _renderPanel.OffsetTop = 84;
        AddChild(_renderPanel);
        var col = new VBoxContainer { CustomMinimumSize = new Vector2(326, 0) };
        col.AddThemeConstantOverride("separation", 8);
        _renderPanel.AddChild(col);
        col.AddChild(Ui.Text("Render con Blender", 16));
        _blenderLabel = Ui.Text("", 12, Ui.Muted, wrap: true);
        col.AddChild(_blenderLabel);
        var tools = new HBoxContainer();
        tools.AddThemeConstantOverride("separation", 6);
        var pick = Ui.Flat("Elegir blender.exe…");
        pick.Pressed += PickBlender;
        tools.AddChild(pick);
        var get = Ui.Flat("Descargar Blender");
        get.TooltipText = "blender.org: gratis y libre";
        get.Pressed += () => OS.ShellOpen("https://www.blender.org/download/");
        tools.AddChild(get);
        col.AddChild(tools);

        col.AddChild(Ui.Text("Calidad", 13, Ui.Muted));
        _renderQuality = new OptionButton();
        _renderQuality.AddItem("Borrador · 1280×720, rápido", (int)RenderQuality.Borrador);
        _renderQuality.AddItem("Final · 1920×1080", (int)RenderQuality.Final);
        _renderQuality.AddItem("Alta · 4K, para imprimir", (int)RenderQuality.Alta);
        _renderQuality.Selected = 0;
        col.AddChild(_renderQuality);

        col.AddChild(Ui.Text("Hora", 13, Ui.Muted));
        _renderHour = new OptionButton();
        _renderHour.AddItem("Día (el sol de la hora elegida)", (int)RenderHour.Dia);
        _renderHour.AddItem("Atardecer, con las luces prendidas", (int)RenderHour.Atardecer);
        _renderHour.AddItem("Noche: solo las luces de la casa", (int)RenderHour.Noche);
        col.AddChild(_renderHour);

        col.AddChild(Ui.Text("Cámara", 13, Ui.Muted));
        _renderCamera = new OptionButton();
        foreach (var (label, _) in CameraChoices) _renderCamera.AddItem(label);
        col.AddChild(_renderCamera);
        col.AddChild(Ui.Text("Los marcadores de vista (Ctrl+1…9) también van como cámaras «Marcador N».", 11, Ui.Muted, wrap: true));

        _renderUpload = new CheckButton { Text = "Subir a la galería del proyecto", ButtonPressed = true, TooltipText = "La web la muestra al instante en «Renders»" };
        col.AddChild(_renderUpload);

        var go = Ui.Primary("Renderizar");
        go.Pressed += () => EnqueueRender(new RenderJob(
            (RenderQuality)_renderQuality.GetSelectedId(),
            (RenderHour)_renderHour.GetSelectedId(),
            CameraChoices[_renderCamera.Selected].Filter,
            _renderUpload.ButtonPressed));
        col.AddChild(go);

        _renderBar = new ProgressBar { MinValue = 0, MaxValue = 1, Step = 0.001, Visible = false, ShowPercentage = false, CustomMinimumSize = new Vector2(0, 8) };
        col.AddChild(_renderBar);
        var statusRow = new HBoxContainer();
        _renderStatus = Ui.Text("", 12, Ui.Muted, wrap: true);
        _renderStatus.SizeFlagsHorizontal = SizeFlags.ExpandFill;
        statusRow.AddChild(_renderStatus);
        _renderCancel = Ui.Flat("Cancelar");
        _renderCancel.Visible = false;
        _renderCancel.Pressed += CancelRenders;
        statusRow.AddChild(_renderCancel);
        col.AddChild(statusRow);

        _renderGallery = new HFlowContainer();
        _renderGallery.AddThemeConstantOverride("h_separation", 6);
        _renderGallery.AddThemeConstantOverride("v_separation", 6);
        col.AddChild(_renderGallery);

        FindBlender();
    }

    private void ToggleRenderPanel(bool? on = null)
    {
        var show = on ?? !_renderPanel.Visible;
        _renderPanel.Visible = show;
        if (show)
        {
            _lightPanel.Visible = false;
            FindBlender();
            _renderHour.Selected = _atmosphere.IsNight ? 2 : _atmosphere.SunNow.Altitude < 12 ? 1 : 0;
        }
    }

    private void FindBlender()
    {
        _blender = BlenderLocator.Find(_main.Settings.BlenderPath);
        _blenderLabel.Text = _blender is null
            ? "No encontré Blender. Instálalo (gratis) o elige blender.exe."
            : $"Blender {BlenderLocator.VersionOf(_blender)} · renderiza en la tarjeta de video (OptiX/CUDA) si la hay.";
    }

    private void PickBlender()
    {
        var dialog = new FileDialog
        {
            FileMode = FileDialog.FileModeEnum.OpenFile,
            Access = FileDialog.AccessEnum.Filesystem,
            UseNativeDialog = true,
            Filters = ["blender.exe ; Blender"],
            Title = "Elige blender.exe",
        };
        dialog.FileSelected += path =>
        {
            _main.Settings.BlenderPath = path;
            _main.Settings.Save();
            FindBlender();
            dialog.QueueFree();
        };
        dialog.Canceled += dialog.QueueFree;
        AddChild(dialog);
        dialog.PopupCentered();
    }

    // ------------------------------------------------------------------ fila de renders
    /// <summary>Agrega un render a la fila (y la arranca si estaba quieta). false si no hay Blender o casa.</summary>
    public bool EnqueueRender(RenderJob job)
    {
        if (_blender is null)
        {
            Toast("Falta Blender: instálalo o elige blender.exe en el panel Render");
            return false;
        }
        if (_sync.Model is null) return false;
        _renderQueue.Enqueue(job);
        if (!Rendering)
        {
            _renderCts = new CancellationTokenSource();
            _renderLoop = RunRendersAsync(_renderCts.Token);
        }
        else Toast($"En fila: {_renderQueue.Count} render{(_renderQueue.Count == 1 ? "" : "s")} después del actual");
        return true;
    }

    /// <summary>Espera a que la fila termine (lo usa la prueba de humo).</summary>
    public Task WaitRendersAsync() => _renderLoop ?? Task.CompletedTask;

    private void CancelRenders()
    {
        _renderQueue.Clear();
        _renderCts?.Cancel();
    }

    private async Task RunRendersAsync(CancellationToken ct)
    {
        _renderBar.Visible = true;
        _renderCancel.Visible = true;
        try
        {
            while (_renderQueue.TryDequeue(out var job) && !ct.IsCancellationRequested)
                await RenderOneAsync(job, ct);
        }
        catch (OperationCanceledException)
        {
            _renderStatus.Text = "Render cancelado.";
        }
        catch (Exception e)
        {
            _renderStatus.Text = $"Blender falló: {e.Message}";
            Toast($"Blender falló: {e.Message}");
        }
        finally
        {
            _renderBar.Visible = false;
            _renderCancel.Visible = false;
        }
    }

    private async Task RenderOneAsync(RenderJob job, CancellationToken ct)
    {
        var folder = System.IO.Path.Combine(OS.GetUserDataDir(), "blender", _projectId);
        _renderStatus.Text = "Armando el paquete para Blender…";
        _renderBar.Value = 0;
        var cameras = new List<(string, Camera3D)>();
        if (_main.GetViewport().GetCamera3D() is { } current) cameras.Add(("Vista actual", current));
        // los marcadores: una cámara temporal en cada uno
        var temps = new List<Camera3D>();
        foreach (var (n, view) in _bookmarks.OrderBy(b => b.Key))
        {
            var cam = new Camera3D { Fov = _camera.Fov };
            _world.AddChild(cam);
            var dir = new Vector3(MathF.Cos(view.Pitch) * MathF.Sin(view.Yaw), MathF.Sin(view.Pitch), MathF.Cos(view.Pitch) * MathF.Cos(view.Yaw));
            cam.GlobalPosition = view.Target + dir * view.Distance;
            cam.LookAt(view.Target, Vector3.Up);
            cameras.Add(($"Marcador {n}", cam));
            temps.Add(cam);
        }
        BlenderPackage.Result package;
        try
        {
            package = BlenderPackage.Write(_sync, folder, _title.Text, _atmosphere.IsNight ? null : _atmosphere.SunNow, cameras);
        }
        finally
        {
            foreach (var t in temps) t.QueueFree();
        }

        var quality = RenderRequest.Arg(job.Quality);
        var hour = RenderRequest.Arg(job.Hour);
        var runner = new BlenderRunner(_blender!);
        var progress = new Progress<RenderProgress>(p => OnMain(() => ShowRenderProgress(p)));
        await Task.Run(() => runner.RenderAsync(
            new RenderRequest(package.Folder, job.Quality, job.Hour, job.Camera),
            progress,
            (path, camera) => OnMain(() => OnRenderedAsync(path, camera, quality, hour, job.Upload).ContinueWith(
                t => OnMain(() => Toast($"El render salió pero no se pudo guardar: {t.Exception?.GetBaseException().Message}")),
                TaskContinuationOptions.OnlyOnFaulted)),
            ct), ct);
        _renderStatus.Text = "Listo.";
    }

    private void ShowRenderProgress(RenderProgress p)
    {
        _renderBar.Value = p.Fraction;
        _renderStatus.Text = p.Cameras == 0
            ? $"{p.Stage}: materiales, cielo, luces y cámaras…"
            : $"Cámara {p.Camera}/{p.Cameras} · {p.CameraName}" + (p.Samples > 0 ? $" · muestra {p.Sample}/{p.Samples}" : "");
    }

    private async Task OnRenderedAsync(string png, string camera, string quality, string hour, bool upload)
    {
        if (!System.IO.File.Exists(png))
        {
            GD.PrintErr($"[render] Blender dijo {png} pero no está");
            return;
        }
        var dir = System.IO.Path.Combine(OS.GetSystemDir(OS.SystemDir.Pictures), "Plano 3D", "Renders");
        System.IO.Directory.CreateDirectory(dir);
        var safe = string.Concat((camera.Length > 0 ? camera : System.IO.Path.GetFileNameWithoutExtension(png)).Select(c => char.IsLetterOrDigit(c) ? c : '_'));
        var keep = System.IO.Path.Combine(dir, $"{string.Concat(_title.Text.Select(c => char.IsLetterOrDigit(c) ? c : '_'))}-{safe}-{DateTime.Now:yyyyMMdd-HHmmss}.png");
        System.IO.File.Copy(png, keep, overwrite: true);
        Renders.Add(keep);

        var img = Image.LoadFromFile(keep);
        if (img is null || img.IsEmpty()) return;
        AddThumbnail(img, keep);
        Toast($"Render listo: {camera}");
        if (!upload) return;
        try
        {
            var jpg = img.SaveJpgToBuffer(0.9f);
            var id = await _main.Api.UploadRenderAsync(_projectId, jpg, $"{safe}.jpg", camera, camera, quality, hour);
            UploadedRenders.Add(id);
            Toast("Render subido a la galería del proyecto");
        }
        catch (Exception e)
        {
            GD.PrintErr($"[render] no se pudo subir: {e}");
            Toast($"No se pudo subir el render: {_main.Friendly(e)}");
        }
    }

    private void AddThumbnail(Image img, string path)
    {
        var thumb = (Image)img.Duplicate();
        thumb.Resize(96, Math.Max(1, 96 * img.GetHeight() / Math.Max(1, img.GetWidth())), Image.Interpolation.Bilinear);
        var button = new TextureButton
        {
            TextureNormal = ImageTexture.CreateFromImage(thumb),
            TooltipText = $"{System.IO.Path.GetFileName(path)}\nClic: abrir",
            MouseDefaultCursorShape = CursorShape.PointingHand,
        };
        button.Pressed += () => OS.ShellOpen(path);
        _renderGallery.AddChild(button);
        _renderGallery.MoveChild(button, 0);
    }
}

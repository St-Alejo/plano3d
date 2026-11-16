using System.Globalization;
using System.Text.Json.Nodes;
using Godot;
using Plano3D.App.Scene;
using Plano3D.Core.Geometry;
using Plano3D.Core.Json;
using Plano3D.Core.Model;
using Plano3D.Infrastructure.Api;
using Plano3D.Infrastructure.Collab;

namespace Plano3D.App.Screens;

/// <summary>
/// El proyecto en 3D y en vivo: lo que se edita en la web llega aquí al instante (y lo que
/// se selecciona aquí se ve resaltado allá).
/// </summary>
public partial class EditorScreen : Control
{
    private static readonly CultureInfo Es = CultureInfo.GetCultureInfo("es-CO");

    private Main _main = null!;
    private string _projectId = "";
    private Node3D _world = null!;
    private SceneSync _sync = null!;
    private OrbitCamera _camera = null!;
    private CollabClient? _collab;
    private bool _framed;
    private bool _closed;

    private Label _title = null!;
    private Label _status = null!;
    private HBoxContainer _peers = null!;
    private OptionButton _levelPick = null!;
    private Label _toast = null!;
    private PanelContainer _infoPanel = null!;
    private Label _info = null!;
    private Label _loading = null!;

    private string? _selected;
    private readonly List<GeometryInstance3D> _overlays = [];
    private readonly Dictionary<string, Node3D> _ghosts = [];
    private IReadOnlyList<Peer> _peerList = [];
    private double _toastLeft;

    /// <summary>Estado para pruebas y diagnóstico.</summary>
    public SceneSync Sync => _sync;
    public CollabClient? Collab => _collab;
    public bool Ready3D { get; private set; }

    public void Build(Main main, Node3D worldHost, string projectId, string name)
    {
        _main = main;
        _projectId = projectId;
        MouseFilter = MouseFilterEnum.Ignore;

        // ---------------------------------------------------------------- mundo 3D
        _world = new Node3D { Name = "Escena" };
        worldHost.AddChild(_world);
        _world.AddChild(new WorldEnvironment { Environment = MakeEnvironment() });
        var sun = new DirectionalLight3D
        {
            ShadowEnabled = true,
            LightEnergy = 1.15f,
            RotationDegrees = new Vector3(-52, -38, 0),
            DirectionalShadowMaxDistance = 90,
        };
        _world.AddChild(sun);
        var ground = new MeshInstance3D
        {
            Mesh = new PlaneMesh { Size = new Vector2(400, 400) },
            MaterialOverride = Materials.Ground,
            Position = new Vector3(0, -0.02f, 0),
        };
        _world.AddChild(ground);
        _sync = new SceneSync { Name = "Casa" };
        _world.AddChild(_sync);
        _camera = new OrbitCamera { Name = "Camara" };
        _world.AddChild(_camera);
        _camera.MakeCurrent();
        _camera.Clicked += Pick;

        // ---------------------------------------------------------------- interfaz
        var bar = new PanelContainer();
        bar.AddThemeStyleboxOverride("panel", Ui.Box(new Color(Ui.Surface, 0.94f), 14, Ui.Line, 10));
        bar.SetAnchorsPreset(LayoutPreset.TopWide);
        bar.OffsetLeft = 16;
        bar.OffsetRight = -16;
        bar.OffsetTop = 14;
        AddChild(bar);
        var row = new HBoxContainer();
        bar.AddChild(row);
        var back = Ui.Flat("←  Proyectos");
        back.Pressed += () => _main.ShowProjects();
        row.AddChild(back);
        _title = Ui.Text(name, 18);
        _title.SizeFlagsHorizontal = SizeFlags.ExpandFill;
        _title.VerticalAlignment = VerticalAlignment.Center;
        row.AddChild(_title);
        _levelPick = new OptionButton { TooltipText = "Qué pisos se ven" };
        _levelPick.ItemSelected += _ => ApplyLevelFilter();
        row.AddChild(_levelPick);
        var frame = Ui.Secondary("Encuadrar");
        frame.TooltipText = "Encuadrar la casa (F)";
        frame.Pressed += () => FrameHouse(false);
        row.AddChild(frame);
        _peers = new HBoxContainer();
        _peers.AddThemeConstantOverride("separation", 6);
        row.AddChild(_peers);
        _status = Ui.Text("conectando…", 13, Ui.Muted);
        _status.VerticalAlignment = VerticalAlignment.Center;
        row.AddChild(_status);

        _toast = Ui.Text("", 14, Ui.Paper);
        var toastBox = new PanelContainer { Visible = false };
        toastBox.AddThemeStyleboxOverride("panel", Ui.Box(new Color(Ui.Ink, 0.88f), 999, null, 10));
        toastBox.AddChild(_toast);
        toastBox.SetAnchorsPreset(LayoutPreset.CenterBottom);
        toastBox.GrowHorizontal = GrowDirection.Both;
        toastBox.GrowVertical = GrowDirection.Begin;
        toastBox.OffsetBottom = -28;
        toastBox.Name = "Aviso";
        AddChild(toastBox);

        _infoPanel = new PanelContainer { Visible = false, CustomMinimumSize = new Vector2(260, 0) };
        _infoPanel.SetAnchorsPreset(LayoutPreset.BottomLeft);
        _infoPanel.GrowVertical = GrowDirection.Begin;
        _infoPanel.OffsetLeft = 16;
        _infoPanel.OffsetBottom = -16;
        _info = Ui.Text("", 14, wrap: true);
        _infoPanel.AddChild(_info);
        AddChild(_infoPanel);

        var help = Ui.Text("Arrastra para girar · clic derecho para mover · rueda para acercar · clic para elegir", 12, Ui.Muted);
        help.SetAnchorsPreset(LayoutPreset.BottomRight);
        help.GrowHorizontal = GrowDirection.Begin;
        help.GrowVertical = GrowDirection.Begin;
        help.OffsetRight = -16;
        help.OffsetBottom = -12;
        AddChild(help);

        _loading = Ui.Text("Abriendo el proyecto…", 18, Ui.Muted);
        _loading.SetAnchorsPreset(LayoutPreset.Center);
        _loading.GrowHorizontal = GrowDirection.Both;
        _loading.GrowVertical = GrowDirection.Both;
        AddChild(_loading);
    }

    private static Godot.Environment MakeEnvironment()
    {
        var sky = new ProceduralSkyMaterial
        {
            SkyTopColor = new Color("8fb3d9"),
            SkyHorizonColor = new Color("e9e4da"),
            GroundHorizonColor = new Color("e9e4da"),
            GroundBottomColor = new Color("cfc8ba"),
        };
        return new Godot.Environment
        {
            BackgroundMode = Godot.Environment.BGMode.Sky,
            Sky = new Sky { SkyMaterial = sky },
            AmbientLightSource = Godot.Environment.AmbientSource.Sky,
            AmbientLightEnergy = 0.9f,
            TonemapMode = Godot.Environment.ToneMapper.Agx,
            SsaoEnabled = true,
            SsaoRadius = 0.8f,
            SsaoIntensity = 1.6f,
        };
    }

    // ------------------------------------------------------------------ carga y sala en vivo
    public async Task LoadAsync()
    {
        try
        {
            var project = await _main.Api.ProjectAsync(_projectId);
            _title.Text = project.Str("name") ?? _title.Text;
            if (project["model"] is JsonObject model) Show(model);
        }
        catch (Exception e) when (e is ApiException or HttpRequestException or TaskCanceledException)
        {
            _loading.Text = _main.Friendly(e);
            return;
        }
        StartLive();
    }

    private void StartLive()
    {
        var collab = new CollabClient(_main.Api, _projectId);
        _collab = collab;
        // todo llega desde un hilo de red: se copia ahí y se dibuja en el principal
        collab.Document.ViewChanged += view => OnMain(() => Show(view));
        collab.StatusChanged += (s, detail) => OnMain(() => ShowStatus(s, detail));
        collab.PeersChanged += () =>
        {
            var list = collab.Peers;
            OnMain(() => ShowPeers(list));
        };
        collab.RemoteEdit += peer => OnMain(() => Toast(peer is null ? "Cambios de otra persona" : peer.Client == "desktop" ? $"Cambios desde el escritorio ({peer.Name})" : $"Cambios de {peer.Name} en la web"));
        collab.Preview += (peer, entity) => OnMain(() => ShowGhost(peer, entity));
        collab.Error += msg => OnMain(() => Toast(msg));
        collab.Start();
    }

    /// <summary>Al hilo principal, salvo que la pantalla ya se haya cerrado.</summary>
    private void OnMain(Action action) => Main.Post(() =>
    {
        if (!_closed && IsInstanceValid(this)) action();
    });

    public void Close()
    {
        _closed = true;
        if (_collab is { } c)
        {
            _collab = null;
            _ = c.DisposeAsync().AsTask();
        }
        _world.QueueFree();
    }

    private void Show(JsonObject model)
    {
        _sync.Apply(model);
        _loading.Visible = false;
        Ready3D = true;
        RefreshLevels();
        if (!_framed)
        {
            FrameHouse(true);
            _framed = true;
        }
        Reselect();
    }

    private void FrameHouse(bool instant)
    {
        if (_sync.Model is not { } m) return;
        var (min, max) = BuildingGeometry.Bounds(m);
        var top = m.Levels.Count == 0 ? 3 : m.Levels.Max(l => l.Elevation + BuildingGeometry.StoreyHeight(m, l));
        var center = new Vector3((float)(min.X + max.X) / 2, (float)top / 3, (float)(min.Y + max.Y) / 2);
        // media diagonal de la caja de la casa: así entra entera con el campo de visión de la cámara
        var radius = (float)Math.Sqrt(Math.Pow(max.X - min.X, 2) + Math.Pow(max.Y - min.Y, 2) + top * top) / 2;
        _camera.Frame(center, radius, instant);
    }

    // ------------------------------------------------------------------ pisos
    private void RefreshLevels()
    {
        if (_sync.Model is not { } m) return;
        var wanted = new List<string> { "Todos los pisos" };
        wanted.AddRange(m.Levels.Select(l => $"Hasta {l.Name}"));
        var current = _levelPick.ItemCount == 0 ? 0 : _levelPick.Selected;
        if (_levelPick.ItemCount != wanted.Count || Enumerable.Range(0, wanted.Count).Any(i => _levelPick.GetItemText(i) != wanted[i]))
        {
            _levelPick.Clear();
            foreach (var w in wanted) _levelPick.AddItem(w);
            _levelPick.Select(Math.Min(current, wanted.Count - 1));
        }
        ApplyLevelFilter();
    }

    private void ApplyLevelFilter()
    {
        if (_sync.Model is not { } m) return;
        var idx = _levelPick.Selected;
        if (idx <= 0)
        {
            _sync.ShowLevels(_ => true);
            return;
        }
        var top = m.Levels[idx - 1];
        _sync.ShowLevels(l => l.Elevation <= top.Elevation + 0.01);
        SendPresence();
    }

    private string? FocusLevel()
    {
        if (_sync.Model is not { } m) return null;
        if (_levelPick.Selected > 0) return m.Levels[_levelPick.Selected - 1].Id;
        if (_selected is { } id) return _sync.Find(id).FirstOrDefault()?.LevelId;
        return m.Levels.FirstOrDefault()?.Id;
    }

    // ------------------------------------------------------------------ elegir
    private void Pick(Vector2 screen)
    {
        var from = _camera.ProjectRayOrigin(screen);
        var to = from + _camera.ProjectRayNormal(screen) * 500;
        var hit = _camera.GetWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(from, to));
        _selected = hit.Count > 0 && hit["collider"].As<Node>() is { } body && body.HasMeta("entity") ? body.GetMeta("entity").AsString() : null;
        Reselect();
        SendPresence();
    }

    private void SendPresence()
    {
        if (_collab is not { Status: LiveStatus.Live } c || FocusLevel() is not { } level) return;
        _ = c.PresenceAsync(level, _selected);
    }

    /// <summary>Resalta lo propio y lo que miran las demás personas (con su color).</summary>
    private void Reselect()
    {
        foreach (var o in _overlays.Where(GodotObject.IsInstanceValid)) o.MaterialOverlay = null;
        _overlays.Clear();
        void Mark(string id, Color color)
        {
            foreach (var d in _sync.Find(id))
                foreach (var mi in d.Node.FindChildren("*", "MeshInstance3D", true, false).OfType<MeshInstance3D>())
                {
                    mi.MaterialOverlay = Materials.Highlight(color);
                    _overlays.Add(mi);
                }
        }
        foreach (var p in _peerList.Where(p => p.Selection is not null)) Mark(p.Selection!, Ui.PeerColor(p.Id));
        if (_selected is { } sel) Mark(sel, Ui.Accent);
        ShowInfo();
    }

    private void ShowInfo()
    {
        if (_selected is null || _sync.Model is not { } m)
        {
            _infoPanel.Visible = false;
            return;
        }
        string? text = null;
        foreach (var level in m.Levels)
        {
            if (level.Walls.FirstOrDefault(w => w.Id == _selected) is { } w)
                text = $"Muro · {level.Name}\n{w.Length.ToString("0.00", Es)} m de largo · {w.Thickness.ToString("0.00", Es)} m de grueso\n{w.OpeningsOrEmpty.Count} abertura(s)";
            else if (level.Walls.SelectMany(x => x.OpeningsOrEmpty).FirstOrDefault(o => o.Id == _selected) is { } o)
                text = $"{(o.IsDoor ? "Puerta" : "Ventana")} · {level.Name}\n{o.Width.ToString("0.00", Es)} × {o.Height.ToString("0.00", Es)} m";
            else if (level.Rooms.FirstOrDefault(r => r.Id == _selected) is { } r)
                text = $"{(string.IsNullOrWhiteSpace(r.Label) ? "Ambiente" : r.Label)} · {level.Name}\n{Math.Abs(BuildingGeometry.SignedArea(r.Polygon)).ToString("0.0", Es)} m²";
            else if (level.Furniture.FirstOrDefault(f => f.Id == _selected) is { } f)
                text = $"Mueble ({f.CatalogId}) · {level.Name}\n{f.Width.ToString("0.00", Es)} × {f.Depth.ToString("0.00", Es)} m";
            else if (level.Columns.Any(c => c.Id == _selected)) text = $"Columna · {level.Name}";
            else if (level.Stairs.Any(s => s.Id == _selected)) text = $"Escalera · {level.Name}";
            if (text is not null) break;
        }
        _info.Text = text ?? _selected;
        _infoPanel.Visible = true;
    }

    // ------------------------------------------------------------------ presencia y avisos
    private void ShowStatus(LiveStatus s, string? detail)
    {
        (_status.Text, var color) = s switch
        {
            LiveStatus.Live => ("● en vivo", Ui.Live),
            LiveStatus.Connecting => ("conectando…", Ui.Muted),
            LiveStatus.Offline => ("sin conexión · reintentando…", Ui.Danger),
            LiveStatus.Closed => (detail ?? "la sala se cerró", Ui.Danger),
            _ => ("", Ui.Muted),
        };
        _status.AddThemeColorOverride("font_color", color);
        if (s == LiveStatus.Live) SendPresence();
    }

    private void ShowPeers(IReadOnlyList<Peer> peers)
    {
        _peerList = peers;
        foreach (var c in _peers.GetChildren()) c.QueueFree();
        foreach (var p in peers)
        {
            var chip = new PanelContainer { TooltipText = $"{p.Name} · {(p.Client == "desktop" ? "escritorio" : "web")}" };
            chip.AddThemeStyleboxOverride("panel", Ui.Box(Ui.PeerColor(p.Id), 999, null, 6));
            var initials = string.Concat(p.Name.Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(2).Select(w => char.ToUpperInvariant(w[0])));
            chip.AddChild(Ui.Text($"{initials} {(p.Client == "desktop" ? "▣" : "◍")}", 12, Ui.Paper));
            _peers.AddChild(chip);
        }
        Reselect();
    }

    private void Toast(string text)
    {
        _toast.Text = text;
        ((Control)_toast.GetParent()).Visible = true;
        _toastLeft = 4;
    }

    public override void _Process(double delta)
    {
        if (_toastLeft > 0 && (_toastLeft -= delta) <= 0) ((Control)_toast.GetParent()).Visible = false;
    }

    public override void _UnhandledKeyInput(InputEvent e)
    {
        if (e is not InputEventKey { Pressed: true } k) return;
        if (k.Keycode == Key.F) FrameHouse(false);
        if (k.Keycode == Key.Escape)
        {
            _selected = null;
            Reselect();
            SendPresence();
        }
    }

    /// <summary>Fantasma de lo que otra persona arrastra en la web (muro, mueble o abertura).</summary>
    private void ShowGhost(string peerId, JsonObject? entity)
    {
        if (_ghosts.Remove(peerId, out var old)) old.QueueFree();
        if (entity is null || _sync.Model is not { } m) return;
        var level = m.FindLevel(entity.Str("level") ?? "");
        if (level is null || entity["v"] is not JsonObject v) return;
        var color = Ui.PeerColor(peerId);
        var node = new Node3D();
        switch (entity.Str("k"))
        {
            case "wall":
                var wall = BuildingModel.ParseWall(v);
                foreach (var b in BuildingGeometry.WallPieces(wall, level.Elevation)) node.AddChild(MeshFactory.Box(b, Materials.Ghost(color), "", pickable: false));
                break;
            case "furniture":
                var f = BuildingModel.ParseFurniture(v);
                node.AddChild(MeshFactory.Box(BuildingGeometry.FurnitureBox(f, level.Elevation), Materials.Ghost(color), "", pickable: false));
                break;
            case "opening":
                var host = level.Walls.FirstOrDefault(w => w.Id == v.Str("wall"));
                if (host is null) return;
                var kind = v.Str("kind") ?? "door";
                var o = new Opening(entity.Str("id") ?? "", kind, Num(v, "offset"), Num(v, "width"), kind == "window" ? 1.2 : 2.1, kind == "window" ? 0.9 : 0);
                node.AddChild(MeshFactory.Box(BuildingGeometry.OpeningInfill(host, o, level.Elevation) with { Size = new Vec3(o.Width, o.Height, host.Thickness + 0.04) }, Materials.Ghost(color), "", pickable: false));
                break;
            default:
                return;
        }
        _world.AddChild(node);
        _ghosts[peerId] = node;
    }

    private static double Num(JsonObject o, string key) => o[key] is JsonValue v ? JsonUtil.AsDouble(v) : 0;
}
